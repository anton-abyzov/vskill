// ---------------------------------------------------------------------------
// Eval generation prompt assembly + response parsing
// ---------------------------------------------------------------------------

import type { EvalsFile } from "./schema.js";
import type { McpDependency } from "./mcp-detector.js";
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

7. **Functional over formatting: assert on WHAT, not HOW it looks**. Do not assert on formatting details like blank lines, paragraph count, whitespace structure, exact heading levels, bullet formatting, or sentence count. These are stylistic choices that vary between LLM runs and do not indicate skill quality.
   - BAD: "The greeting is a single short sentence (not multiple paragraphs)" (formatting-rigid)
   - GOOD: "The response starts with a greeting that includes the user's name" (semantic/functional)
   - BAD: "The response uses exactly 3 bullet points" (formatting-rigid)
   - GOOD: "The response lists at least 3 distinct benefits" (content-focused)

8. **Unit-test granularity**: Each assertion should check exactly ONE observable behavior. Avoid compound assertions that test multiple things at once. This makes failures easier to diagnose and reduces false negatives.
   - BAD: "The response greets the user, lists benefits, and ends with a farewell" (tests 3 things)
   - GOOD: Three separate assertions, one for greeting, one for benefits, one for farewell
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

// ---------------------------------------------------------------------------
// Browser & platform detection (pure functions for integration test gen)
// ---------------------------------------------------------------------------

export interface BrowserRequirements {
  hasBrowser: boolean;
  suggestedProfile?: string;
}

export function detectBrowserRequirements(skillContent: string): BrowserRequirements {
  const hasBash = detectBashTools(skillContent);
  if (!hasBash) return { hasBrowser: false };

  const body = skillContent.replace(/^---\s*\n[\s\S]*?\n---/, "");
  const browserPattern = /\b(browser|chrome|chromium|playwright|puppeteer|selenium|chrome[\s-]?profile)\b/i;
  if (browserPattern.test(body)) {
    return { hasBrowser: true, suggestedProfile: "Default" };
  }
  return { hasBrowser: false };
}

const PLATFORM_KEYWORDS: Record<string, string> = {
  twitter: "Twitter",
  "x.com": "Twitter",
  "\\bx\\b": "Twitter",
  linkedin: "LinkedIn",
  slack: "Slack",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  reddit: "Reddit",
  facebook: "Facebook",
  discord: "Discord",
  telegram: "Telegram",
  threads: "Threads",
  "dev.to": "dev.to",
};

export function detectPlatformTargets(skillContent: string): string[] {
  const body = skillContent.replace(/^---\s*\n[\s\S]*?\n---/, "");
  const detected = new Set<string>();
  for (const [keyword, platform] of Object.entries(PLATFORM_KEYWORDS)) {
    const regex = new RegExp(keyword, "i");
    if (regex.test(body)) {
      detected.add(platform);
    }
  }
  return Array.from(detected);
}

// ---------------------------------------------------------------------------
// Credential hints (MCP server → env var names)
// ---------------------------------------------------------------------------

export const CREDENTIAL_HINTS: Record<string, string[]> = {
  Slack: ["SLACK_BOT_TOKEN", "SLACK_USER_TOKEN"],
  GitHub: ["GITHUB_TOKEN"],
  Linear: ["LINEAR_API_KEY"],
  "Google Workspace": ["GOOGLE_APPLICATION_CREDENTIALS"],
  Notion: ["NOTION_API_KEY"],
  Jira: ["JIRA_API_TOKEN", "JIRA_EMAIL"],
  Confluence: ["CONFLUENCE_API_TOKEN"],
  Figma: ["FIGMA_ACCESS_TOKEN"],
  Sentry: ["SENTRY_AUTH_TOKEN"],
};

// ---------------------------------------------------------------------------
// Integration eval prompt builder
// ---------------------------------------------------------------------------

const INTEGRATION_SCHEMA_REFERENCE = `
## Integration evals.json Schema Extension

Integration test cases extend the base schema with these additional fields:

{
  "id": <number>,
  "name": "<string>",
  "prompt": "<string>",
  "expected_output": "<string>",
  "testType": "integration",
  "requiredCredentials": ["<ENV_VAR_NAME>", ...],
  "requirements": {
    "chromeProfile": "<string, Chrome profile name for browser-based tests>",
    "platform": "<string, target platform name>"
  },
  "cleanup": [
    {
      "action": "delete_post" | "remove_artifact" | "custom",
      "platform": "<string>",
      "identifier": "{POSTED_ID}",
      "description": "<what this cleanup step does>"
    }
  ],
  "assertions": [...]
}

Every integration eval MUST have testType: "integration".
`;

export function buildIntegrationEvalPrompt(
  skillContent: string,
  mcpDeps: McpDependency[],
  browserReqs: BrowserRequirements,
  platforms: string[],
): string {
  let credentialSection = "";
  if (mcpDeps.length > 0) {
    const creds: string[] = [];
    for (const dep of mcpDeps) {
      const hints = CREDENTIAL_HINTS[dep.server];
      if (hints) {
        creds.push(`- **${dep.server}**: ${hints.join(", ")}`);
      }
    }
    if (creds.length > 0) {
      credentialSection = `\n## Required Credentials\n\nPopulate \`requiredCredentials\` with these environment variable names:\n${creds.join("\n")}\n`;
    }
  }

  let browserSection = "";
  if (browserReqs.hasBrowser) {
    browserSection = `\n## Browser Requirements\n\nThis skill uses browser automation. Each integration test case MUST include:\n- \`requirements.chromeProfile\`: "${browserReqs.suggestedProfile || "Default"}"\n\nThe integration test runner will launch Chrome with this profile's logged-in sessions.\n`;
  }

  let platformSection = "";
  if (platforms.length > 0) {
    const platformList = platforms.map((p) => `- ${p}`).join("\n");
    platformSection = `\n## Platform Targets\n\nDetected platforms:\n${platformList}\n\nFor each platform-targeting test case, include a \`cleanup\` block:\n- action: "delete_post" for social media posts\n- action: "remove_artifact" for created resources\n- action: "custom" for other cleanup needs\n- platform: the target platform name\n- identifier: "{POSTED_ID}" (placeholder replaced at runtime)\n- description: what the cleanup step does\n`;
  }

  return `You are an expert eval generator for AI skills. Your task is to create INTEGRATION test cases for the skill described below.

## Skill Content (SKILL.md)

${skillContent}

${INTEGRATION_SCHEMA_REFERENCE}

${BEST_PRACTICES}
${credentialSection}${browserSection}${platformSection}
## Instructions

Generate integration eval cases that test the skill against real external services. Each case must have:
- \`testType: "integration"\`
- \`requiredCredentials\` array with needed env vars
- \`requirements\` object with chromeProfile (if browser-based) and platform
- \`cleanup\` array with cleanup actions for any created artifacts
- At least 2 objectively verifiable assertions per case

Output ONLY the JSON inside a \`\`\`json code fence. The JSON should be an array of eval case objects (NOT the full evals.json wrapper — just the array of cases).`;
}

// ---------------------------------------------------------------------------
// Integration eval response parser
// ---------------------------------------------------------------------------

export function parseGeneratedIntegrationEvals(raw: string): EvalsFile["evals"] {
  const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (!match) {
    throw new Error(
      "No JSON code block found in LLM response. Expected ```json ... ``` fence.",
    );
  }

  let parsed: any;
  try {
    parsed = JSON.parse(match[1]);
  } catch (err) {
    throw new Error(
      `Invalid JSON in code block: ${(err as Error).message}`,
    );
  }

  // Accept both array and wrapped object
  const cases = Array.isArray(parsed) ? parsed : parsed.evals;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error("Expected a non-empty array of integration eval cases");
  }

  return cases.map((c: any) => ({
    id: c.id,
    name: c.name || `integration-case-${c.id}`,
    prompt: c.prompt,
    expected_output: c.expected_output || "",
    files: Array.isArray(c.files) ? c.files : [],
    assertions: Array.isArray(c.assertions)
      ? c.assertions.map((a: any) => ({
          id: a.id,
          text: a.text,
          type: a.type || "boolean",
        }))
      : [],
    testType: "integration" as const,
    requiredCredentials: Array.isArray(c.requiredCredentials) ? c.requiredCredentials : undefined,
    requirements: c.requirements || undefined,
    cleanup: Array.isArray(c.cleanup) ? c.cleanup : undefined,
  }));
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
