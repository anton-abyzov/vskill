// ---------------------------------------------------------------------------
// Eval generation prompt assembly + response parsing
// ---------------------------------------------------------------------------

import type { EvalsFile } from "./schema.js";
import { detectMcpDependencies } from "./mcp-detector.js";

// ---------------------------------------------------------------------------
// Schema reference (embedded)
// ---------------------------------------------------------------------------

const SCHEMA_REFERENCE = `
## evals.json Schema

The file MUST be valid JSON with this structure:

{
  "skill_name": "<string, required - the skill identifier>",
  "evals": [
    {
      "id": <number, required - unique integer per eval case>,
      "name": "<string, required - descriptive name for this test case>",
      "prompt": "<string, required - the user prompt to send to the LLM>",
      "expected_output": "<string, required - description of what correct output looks like>",
      "files": ["<optional array of file paths relevant to this eval>"],
      "assertions": [
        {
          "id": "<string, required - unique within this eval case, e.g. 'assert-1'>",
          "text": "<string, required - the assertion to verify against the output>",
          "type": "boolean"
        }
      ]
    }
  ]
}

Every eval case MUST have at least 1 assertion. Assertion IDs must be unique within each eval case.
`;

// ---------------------------------------------------------------------------
// Example (embedded from social-media-posting)
// ---------------------------------------------------------------------------

const EXAMPLE_EVALS = `
## Example: social-media-posting evals.json

{
  "skill_name": "social-media-posting",
  "evals": [
    {
      "id": 1,
      "name": "LinkedIn announcement post",
      "prompt": "Write a LinkedIn post announcing our new AI-powered analytics dashboard. Target audience: B2B SaaS founders. Tone: professional but excited. Include a call to action to sign up for the beta at analytics.example.com/beta",
      "expected_output": "A professional LinkedIn post with product announcement, value proposition, and CTA",
      "files": [],
      "assertions": [
        { "id": "assert-1", "text": "Post mentions the AI-powered analytics dashboard by name", "type": "boolean" },
        { "id": "assert-2", "text": "Post includes the beta signup URL analytics.example.com/beta", "type": "boolean" },
        { "id": "assert-3", "text": "Post uses a professional tone appropriate for B2B SaaS audience", "type": "boolean" },
        { "id": "assert-4", "text": "Post includes a clear call to action", "type": "boolean" }
      ]
    }
  ]
}
`;

// ---------------------------------------------------------------------------
// Best practices (embedded)
// ---------------------------------------------------------------------------

const BEST_PRACTICES = `
## Best Practices for Eval Generation

1. **Realistic prompts with substantive detail**: Include specific details like file paths, column names, audience types, or configuration values. Avoid generic prompts like "do something with this skill."

2. **Objectively verifiable assertions**: Each assertion should be checkable by an LLM judge with a clear yes/no answer. "The output mentions X" is verifiable. "The output is good" is not.

3. **Descriptive assertion names/IDs**: Assertion IDs should read clearly in a benchmark viewer. Use descriptive IDs like "mentions-file-path" or "includes-cta-url".

4. **Skip assertions for purely subjective qualities**: Don't assert on tone, creativity, or style unless there's an objective proxy (e.g., "uses formal language" instead of "sounds professional").

5. **Generate 2-3 test cases**: Each representing a different realistic usage scenario for this skill. Cover the primary use case and at least one edge case or variation.

6. **Action-oriented skills (Bash/tool-execution): assert on RESPONSE CONTENT, not execution**. The eval evaluates the LLM's text response — it cannot actually run Bash commands or call tools. Assertions must check what code/commands appear IN the response, not whether they were run.
   - BAD: "Runs a bash command to discover Chrome profiles" (implies actual execution)
   - GOOD: "Response includes a bash code block that lists or reads Chrome profile directories"
   - BAD: "Checks that ~/Desktop/file.mp4 exists before uploading"
   - GOOD: "Response includes a bash command checking whether the file exists (e.g., using [ -f ... ] or ls)"
   - BAD: "Opens https://studio.youtube.com as the target URL"
   - GOOD: "Response includes studio.youtube.com as the target URL in a code block or command"
`;

// ---------------------------------------------------------------------------
// Eval execution system prompts (MCP-aware)
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for eval execution. If the skill references MCP tools
 * (Slack, GitHub, Linear, etc.), appends simulation instructions so the LLM
 * demonstrates the workflow instead of reporting "tools unavailable".
 */
function detectBashTools(skillContent: string): boolean {
  // Check frontmatter for allowed-tools containing Bash (or Read/Write/Edit)
  const frontmatterMatch = skillContent.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return false;
  const frontmatter = frontmatterMatch[1];
  const allowedToolsMatch = frontmatter.match(/allowed-tools\s*:\s*(.+)/i);
  if (!allowedToolsMatch) return false;
  const tools = allowedToolsMatch[1].toLowerCase();
  return tools.includes("bash") || tools.includes("read") || tools.includes("write") || tools.includes("edit");
}

export function buildEvalSystemPrompt(skillContent: string): string {
  if (!skillContent) return "You are a helpful AI assistant.";

  const mcpDeps = detectMcpDependencies(skillContent);
  const hasBashTools = detectBashTools(skillContent);

  if (mcpDeps.length === 0 && !hasBashTools) {
    return `You are an AI assistant enhanced with the following skill:\n\n${skillContent}`;
  }

  let executionSection = "";

  if (mcpDeps.length > 0) {
    const toolList = mcpDeps
      .map((d) => `- **${d.server}**: ${d.matchedTools.join(", ")}`)
      .join("\n");

    executionSection += `\n\n## MCP Evaluation Mode\n\nThe MCP tools referenced in this skill are not connected in this environment, but you MUST demonstrate the complete workflow as if they were available.\n\n**Tools this skill uses:**\n${toolList}\n\n**Rules:**\n1. Walk through each tool call step by step — name the tool and its parameters\n2. Show a realistic simulated response for each tool call (use realistic IDs, timestamps, content)\n3. Continue the full workflow using the simulated data\n4. Produce the final user-facing output exactly as you would with real tools\n\n**Do NOT:**\n- Say tools are unavailable or not connected\n- Offer to help set up the integration\n- Skip any workflow steps\n- Give abstract descriptions instead of demonstrating the actual workflow`;
  }

  if (hasBashTools) {
    executionSection += `\n\n## Bash/Tool Execution Mode\n\nThis skill uses Bash and file tools. In this evaluation, you cannot actually execute commands — but you MUST produce complete, ready-to-run code in your response as if you were about to execute them.\n\n**Rules:**\n1. Provide the exact bash commands, AppleScript blocks, or code you would run — complete and copy-pasteable\n2. Do NOT ask for permission before showing code. Execute the workflow immediately in your response\n3. Do NOT say "I would run..." or "I'll check..." — show the actual command in a code block\n4. Do NOT narrate a plan. Produce the executable output directly\n5. Include every concrete detail: exact file paths, exact flags, exact URLs from the skill's instructions\n\n**Do NOT:**\n- Ask "Should I proceed?" or "Do you want me to run this?"\n- Describe steps you would take without showing the code\n- Produce a checklist or planning narrative instead of executable code blocks`;
  }

  return `You are an AI assistant enhanced with the following skill:\n\n${skillContent}\n\n---${executionSection}`;
}

export function buildBaselineSystemPrompt(): string {
  return "You are a helpful AI assistant.";
}

// ---------------------------------------------------------------------------
// Eval generation prompt (for creating evals.json from SKILL.md)
// ---------------------------------------------------------------------------

export function buildEvalInitPrompt(skillContent: string): string {
  const mcpDeps = detectMcpDependencies(skillContent);

  let mcpSection = "";
  if (mcpDeps.length > 0) {
    const toolList = mcpDeps
      .map((d) => `- **${d.server}**: ${d.matchedTools.join(", ")}`)
      .join("\n");

    mcpSection = `

## MCP Simulation Context

This skill uses MCP tools that will be SIMULATED during evaluation (not connected to real services).
Tools detected:
${toolList}

When generating assertions:
- Assert that the output demonstrates the correct tool call workflow (tool name, parameters)
- Assert that simulated responses are realistic and complete
- Do NOT assert on real API artifacts (actual URLs, real IDs, live data)
- Use assertions like "demonstrates calling slack_send_message with channel and message params"
`;
  }

  return `You are an expert eval generator for AI skills. Your task is to create an evals.json file for the skill described below.

## Skill Content (SKILL.md)

${skillContent}

${SCHEMA_REFERENCE}

${EXAMPLE_EVALS}

${BEST_PRACTICES}
${mcpSection}
## Instructions

Generate a complete evals.json for this skill. Output ONLY the JSON inside a \`\`\`json code fence. Generate 2-3 eval cases with realistic, specific prompts and objectively verifiable assertions. Each case must have at least 2 assertions.`;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

export function parseGeneratedEvals(raw: string): EvalsFile {
  // Extract JSON from ```json ... ``` code fence
  const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (!match) {
    throw new Error(
      "No JSON code block found in LLM response. Expected ```json ... ``` fence.",
    );
  }

  const jsonStr = match[1];
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      `Invalid JSON in code block: ${(err as Error).message}`,
    );
  }

  // Validate against schema
  validateParsedEvals(parsed);

  // Normalize
  return {
    skill_name: parsed.skill_name,
    evals: parsed.evals.map((e: any) => ({
      id: e.id,
      name: e.name,
      prompt: e.prompt,
      expected_output: e.expected_output,
      files: Array.isArray(e.files) ? e.files : [],
      assertions: e.assertions.map((a: any) => ({
        id: a.id,
        text: a.text,
        type: a.type || "boolean",
      })),
    })),
  };
}

function validateParsedEvals(parsed: any): void {
  const errors: string[] = [];

  if (typeof parsed.skill_name !== "string" || !parsed.skill_name) {
    errors.push("missing skill_name");
  }
  if (!Array.isArray(parsed.evals) || parsed.evals.length === 0) {
    errors.push("missing or empty evals array");
  }

  if (Array.isArray(parsed.evals)) {
    for (let i = 0; i < parsed.evals.length; i++) {
      const e = parsed.evals[i];
      if (!e.prompt) errors.push(`evals[${i}] missing prompt`);
      if (!e.name) errors.push(`evals[${i}] missing name`);
      if (!Array.isArray(e.assertions) || e.assertions.length === 0) {
        errors.push(`evals[${i}] missing or empty assertions`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid evals structure: ${errors.join(", ")}`);
  }
}
