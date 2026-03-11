// ---------------------------------------------------------------------------
// improve-routes.ts -- AI skill improvement + apply endpoints
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { resolveSkillDir } from "./skill-resolver.js";
import { readBenchmark } from "../eval/benchmark.js";
import { createLlmClient } from "../eval/llm.js";
import type { ProviderName } from "../eval/llm.js";
import { writeHistoryEntry } from "../eval/benchmark-history.js";
import { loadAndValidateEvals } from "../eval/schema.js";

export function registerImproveRoutes(router: Router, root: string): void {
  // POST /api/skills/:plugin/:skill/improve
  router.post("/api/skills/:plugin/:skill/improve", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const skillMdPath = join(skillDir, "SKILL.md");

    if (!existsSync(skillMdPath)) {
      sendJson(res, { error: "SKILL.md not found" }, 404, req);
      return;
    }

    const body = (await readBody(req)) as {
      provider?: ProviderName;
      model?: string;
      eval_id?: number;
      notes?: string;
      mode?: "auto" | "instruct";
      instruction?: string;
      content?: string;
      evals?: { skill_name: string; evals: Array<{ id: number; name: string; prompt: string; expected_output: string; files: string[]; assertions: Array<{ id: string; text: string; type: string }> }> };
    };

    const mode = body.mode || "auto";

    // Validate instruct mode
    if (mode === "instruct") {
      if (!body.instruction || !body.instruction.trim()) {
        sendJson(res, { error: "instruction is required when mode is 'instruct'" }, 400, req);
        return;
      }
      if (!body.content || !body.content.trim()) {
        sendJson(res, { error: "content is required when mode is 'instruct'" }, 400, req);
        return;
      }
    }

    try {
      let original: string;
      let systemPrompt: string;
      let userPrompt: string;

      if (mode === "instruct") {
        // ── Instruct mode: freeform user instruction ──
        original = body.content!;

        const hasEvals = body.evals && Array.isArray(body.evals.evals);
        const evalsJson = hasEvals
          ? JSON.stringify(body.evals!.evals.map((e) => ({
              id: e.id, name: e.name, prompt: e.prompt,
              expected_output: e.expected_output,
              assertions: e.assertions.map((a) => ({ id: a.id, text: a.text })),
            })), null, 2)
          : "[]";

        const evalRules = hasEvals ? `

## Test Case Analysis
The skill has existing test cases (evals). After applying the instruction, analyze whether the test cases need updating:
- If the instruction adds new behavior, suggest new test cases that cover it
- If the instruction modifies existing behavior, suggest modifications to affected test cases
- If the instruction removes behavior, suggest removing test cases that are no longer relevant
- If the instruction does not affect test coverage, return an empty eval changes array

## Eval Change Output Format
After the reasoning section, on a new line write "---EVAL_CHANGES---" followed by a JSON array of suggested changes:

\`\`\`
[
  { "action": "add", "reason": "why this test is needed", "eval": { "id": 0, "name": "test-name", "prompt": "user prompt", "expected_output": "description", "files": [], "assertions": [{ "id": "assert-1", "text": "verifiable assertion", "type": "boolean" }] } },
  { "action": "modify", "reason": "what changed and why", "evalId": 1, "eval": { "id": 1, "name": "updated-name", "prompt": "updated prompt", "expected_output": "updated description", "files": [], "assertions": [{ "id": "assert-1", "text": "updated assertion", "type": "boolean" }] } },
  { "action": "remove", "reason": "why this test is no longer relevant", "evalId": 2 }
]
\`\`\`

Only suggest eval changes that are directly related to the instruction. If the instruction does not affect test coverage, write "---EVAL_CHANGES---" followed by \`[]\`.
Each assertion must be objectively verifiable (clear yes/no). Generate 2-4 assertions per test case.` : "";

        systemPrompt = `You are an expert AI skill engineer. The user wants to modify a SKILL.md file according to their specific instruction.

## Rules
- Apply the user's instruction precisely and completely
- Preserve all content that the instruction does not address — do not remove or reorganize unrelated sections
- Maintain valid YAML frontmatter (name, description fields must remain)
- Keep markdown formatting consistent with the original document
- Do not add unsolicited improvements, refactoring, or style changes beyond what the user asked for
- If the instruction is ambiguous, make a reasonable interpretation and explain it in the reasoning

## Output Format
Return ONLY the modified SKILL.md content — no explanations, no code fences, no preamble. The output must be a complete, valid SKILL.md that can be written directly to disk.

After the modified content, on a new line, write "---REASONING---" followed by a brief explanation of what you changed and why.${evalRules}`;

        const evalsSection = hasEvals
          ? `\n\n## Current Test Cases (evals)\n\`\`\`json\n${evalsJson}\n\`\`\``
          : "";

        userPrompt = `## Current SKILL.md\n${original}${evalsSection}\n\n## Instruction\n${body.instruction!.trim()}\n\nApply this instruction to the SKILL.md above. Return the full modified content followed by ---REASONING--- and your explanation.${hasEvals ? " Then write ---EVAL_CHANGES--- followed by a JSON array of suggested test case changes (or [] if none needed)." : ""}`;
      } else {
        // ── Auto mode: existing best-practices improvement ──
        original = readFileSync(skillMdPath, "utf-8");

        // Gather recent failures from latest benchmark
        let failureContext = "";
        const benchmark = await readBenchmark(skillDir);
        if (benchmark) {
          let failedCases = benchmark.cases.filter((c) => c.status === "fail");

          // If eval_id specified, focus on that single case
          if (body.eval_id != null) {
            failedCases = failedCases.filter((c) => c.eval_id === body.eval_id);
          }
          failedCases = failedCases.slice(0, 10);

          if (failedCases.length > 0) {
            const failures = failedCases.map((c) => {
              const failedAssertions = c.assertions
                .filter((a) => !a.pass)
                .map((a) => `  - ${a.text}: ${a.reasoning}`)
                .join("\n");
              return `Case "${c.eval_name}" (eval_id=${c.eval_id}):\n  Prompt: ${benchmark.cases.find((bc) => bc.eval_id === c.eval_id)?.eval_name || ""}\n${failedAssertions}`;
            });
            const label = body.eval_id != null
              ? `Targeted Failure (eval #${body.eval_id})`
              : `Recent Benchmark Failures (${failedCases.length} cases)`;
            failureContext = `\n\n## ${label}\n${failures.join("\n\n")}`;
          }
        }

        // Optional user notes for guiding the improvement
        const notesSection = body.notes?.trim()
          ? `\n\n## User Notes\n${body.notes.trim()}`
          : "";

        systemPrompt = `You are an expert AI skill engineer following the Skill Builder methodology. Your task is to improve a SKILL.md file based on its current content, benchmark failures, and the skill-builder best practices below.

## Skill Builder Best Practices

### SKILL.md Structure
Every skill has a required SKILL.md with YAML frontmatter (name, description) and markdown body instructions, plus optional bundled resources (scripts/, references/, assets/).

### Description Quality (Frontmatter)
- Use third-person format: "This skill should be used when the user asks to..."
- Include specific trigger phrases users would say (e.g., "create X", "configure Y", "fix Z")
- Be concrete and specific, not vague or generic
- BAD: "Provides guidance for working with X" (vague, no triggers)
- GOOD: "This skill should be used when the user asks to \\"create X\\", \\"configure Y\\", or \\"troubleshoot Z\\""

### Writing Style
- Use imperative/infinitive form (verb-first instructions), NOT second person
- Use objective, instructional language: "To accomplish X, do Y" not "You should do X"
- BAD: "You should start by reading the file" / "You need to validate"
- GOOD: "Start by reading the file" / "Validate the input before processing"

### Progressive Disclosure
- Keep SKILL.md lean: 1,500-2,000 words ideal, under 3,000 max for body
- Move detailed patterns, advanced techniques, API docs to references/ files
- SKILL.md should reference these: "For detailed patterns, consult references/patterns.md"

### Content Quality
- Focus on procedural knowledge non-obvious to an AI assistant
- Include information that helps another AI instance execute tasks effectively
- Core concepts and essential procedures in SKILL.md body
- Detailed docs, edge cases, migration guides in references/

### Common Mistakes to Avoid
- Weak trigger descriptions (vague, no specific phrases)
- Too much content in SKILL.md (>3,000 words without references/)
- Second-person writing style anywhere
- Missing resource references (references/, examples/ exist but not mentioned in SKILL.md)
- Broken or incomplete examples

### Validation Checklist
- Frontmatter has name and description
- Description uses third person with specific trigger phrases
- Body uses imperative/infinitive form
- Body is lean with detailed content in references/
- All referenced files are mentioned
- Examples are complete and working

## Output Format

Return ONLY the improved SKILL.md content — no explanations, no code fences, no preamble. The output should be valid SKILL.md that can be written directly to disk.

When benchmark failures are provided, focus on fixing the skill instructions to address those specific failures. When no failures are provided (or failures are about general quality), apply the skill-builder best practices above to improve structure, writing style, description quality, and progressive disclosure.

After the improved content, on a new line, write "---REASONING---" followed by a brief explanation of what you changed and why, referencing which skill-builder rules were applied.`;

        userPrompt = `## Current SKILL.md\n${original}${failureContext}${notesSection}\n\nImprove this SKILL.md following the Skill Builder methodology. ${failureContext ? "Focus primarily on addressing the benchmark failures, but also apply skill-builder best practices where they help." : "Apply skill-builder best practices: check description quality, writing style, progressive disclosure, and content organization."} Return the full improved content followed by ---REASONING--- and your explanation.`;
      }

      const client = createLlmClient({
        provider: body.provider,
        model: body.model,
      });

      const result = await client.generate(systemPrompt, userPrompt);

      // Parse improved content, reasoning, and optional eval changes
      const parts = result.text.split("---REASONING---");
      const improved = parts[0].trim();
      let reasoning = parts.length > 1 ? parts[1].trim() : "Improvements applied.";

      // Extract eval changes from reasoning section
      let evalChanges: unknown[] = [];
      if (mode === "instruct") {
        const evalParts = reasoning.split("---EVAL_CHANGES---");
        reasoning = evalParts[0].trim();
        if (evalParts.length > 1) {
          try {
            const raw = evalParts[1].trim();
            // Handle both raw JSON and code-fenced JSON
            const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
            const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw;
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed)) evalChanges = parsed;
          } catch { /* graceful degradation: evalChanges stays [] */ }
        }
      }

      // Record to history
      let skillName = "unknown";
      try {
        const evals = loadAndValidateEvals(skillDir);
        skillName = evals.skill_name;
      } catch { /* use fallback */ }
      await writeHistoryEntry(skillDir, {
        timestamp: new Date().toISOString(),
        model: client.model,
        skill_name: skillName,
        cases: [],
        overall_pass_rate: undefined,
        type: mode === "instruct" ? "instruct" : "improve",
        provider: body.provider || "claude-cli",
        verdict: reasoning,
        improve: { original, improved, reasoning },
      });

      sendJson(res, { original, improved, reasoning, evalChanges }, 200, req);
    } catch (err) {
      sendJson(
        res,
        { error: `Improvement failed: ${(err as Error).message}` },
        500,
        req,
      );
    }
  });

  // POST /api/skills/:plugin/:skill/apply-improvement
  router.post("/api/skills/:plugin/:skill/apply-improvement", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const skillMdPath = join(skillDir, "SKILL.md");

    const body = (await readBody(req)) as { content?: string };

    if (!body.content || typeof body.content !== "string" || !body.content.trim()) {
      sendJson(res, { error: "Content is required and must be non-empty" }, 400, req);
      return;
    }

    try {
      writeFileSync(skillMdPath, body.content, "utf-8");
      sendJson(res, { ok: true }, 200, req);
    } catch (err) {
      sendJson(
        res,
        { error: `Failed to write SKILL.md: ${(err as Error).message}` },
        500,
        req,
      );
    }
  });
}
