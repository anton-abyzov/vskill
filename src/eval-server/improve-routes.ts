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
    };

    try {
      const original = readFileSync(skillMdPath, "utf-8");

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

      const systemPrompt = `You are an expert AI skill engineer. Your task is to improve a SKILL.md file based on its current content and any benchmark failures provided. Return ONLY the improved SKILL.md content — no explanations, no code fences, no preamble. The output should be valid SKILL.md that can be written directly to disk.

After the improved content, on a new line, write "---REASONING---" followed by a brief explanation of what you changed and why.`;

      const userPrompt = `## Current SKILL.md\n${original}${failureContext}${notesSection}\n\nPlease improve this SKILL.md to address the failures and improve overall quality. Return the full improved content followed by ---REASONING--- and your explanation.`;

      const client = createLlmClient({
        provider: body.provider,
        model: body.model,
      });

      const result = await client.generate(systemPrompt, userPrompt);

      // Parse improved content and reasoning
      const parts = result.text.split("---REASONING---");
      const improved = parts[0].trim();
      const reasoning = parts.length > 1 ? parts[1].trim() : "Improvements applied.";

      sendJson(res, { original, improved, reasoning }, 200, req);
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
