// ---------------------------------------------------------------------------
// agent-prompts.ts — per-role system prompts + JSON parsers for the 0815
// multi-file generation pipeline.
//
// Each agent owns one slice of a multi-file skill. They run in parallel under
// generateSkill({ multiFile: true }) via Promise.allSettled; the body-agent
// runs sequentially after, with the merged filename list as input, so SKILL.md
// can link to produced files.
//
// Output shape is unified — every agent returns `{ files: [{path, content}] }`
// so the route layer can write them in a single batch. Test-agent additionally
// emits `secrets[]` and `integrationTests` (top-level manifest fields).
// ---------------------------------------------------------------------------

export interface AgentFile {
  path: string;
  content: string;
}

export interface ScriptAgentResponse {
  files: AgentFile[];
  runtime?: { python?: string; pip?: string[]; node?: string };
}

export interface GraderAgentResponse {
  files: AgentFile[];
}

export interface TestAgentResponse {
  files: AgentFile[];
  secrets?: string[];
  integrationTests?: { runner: "vitest" | "pytest" | "none"; file?: string; requires?: string[] };
}

export interface ReferenceAgentResponse {
  files: AgentFile[];
}

// ---------------------------------------------------------------------------
// System prompts. Each is a constant string consumed by createLlmClient().
// Kept terse on purpose — the user's skill description is the discriminator.
// ---------------------------------------------------------------------------

export const SCRIPT_SYSTEM_PROMPT = `You generate the deterministic helper script(s) for a skill in Skill Studio.

Given the user's skill description, produce one or more language-appropriate helper scripts the skill will shell out to (e.g. \`scripts/audit.py\`, \`scripts/format.js\`). Scripts must:
- Be self-contained and runnable from the skill directory.
- Use only the standard library plus the dependencies you declare in \`runtime\`.
- Read secrets from environment variables; never contain hardcoded API keys.
- Degrade gracefully when env vars or external services are unavailable (print a clear message and exit non-zero, never crash on import).

## Output Format
Return ONLY a JSON object:
{
  "files": [
    { "path": "scripts/<name>.<ext>", "content": "<full source>" }
  ],
  "runtime": { "python": ">=3.10", "pip": ["pkg>=1"] }
}

\`runtime\` is optional — omit if the script needs no runtime declaration.
\`path\` is always relative to the skill root, must start with \`scripts/\`, and must not contain \`..\` or absolute paths.
No code fences, no preamble.`;

export const GRADER_SYSTEM_PROMPT = `You generate a deterministic grader script for a skill in Skill Studio.

Given the user's skill description, produce a single grader script (e.g. \`scripts/grader.py\`) that takes the skill's output as input and returns a numeric score in [0, 1]. The grader must:
- Be a pure function of its input — no network calls, no env reads.
- Return a deterministic float between 0 and 1.
- Match the language of the main script when possible.

## Output Format
Return ONLY a JSON object:
{
  "files": [
    { "path": "scripts/grader.<ext>", "content": "<full source>" }
  ]
}

\`path\` must start with \`scripts/\` and must not contain \`..\` or absolute paths.
No code fences, no preamble.`;

export const TEST_SYSTEM_PROMPT = `You generate a runnable integration test for a skill in Skill Studio.

Given the user's skill description, produce ONE integration test file (e.g. \`tests/integration_test.py\` or \`tests/integration.test.ts\`) plus a top-level secrets declaration. The test must:
- Be runnable via the declared runner (\`pytest\` or \`vitest\`).
- Skip cleanly when required env vars are missing (e.g. \`pytest.skip\`).
- Never include real secret values — only test-mode placeholders or mocks.

## Output Format
Return ONLY a JSON object:
{
  "files": [
    { "path": "tests/<name>", "content": "<full source>" }
  ],
  "secrets": ["UPPER_SNAKE_NAME"],
  "integrationTests": {
    "runner": "pytest",
    "file": "tests/integration_test.py",
    "requires": ["UPPER_SNAKE_NAME"]
  }
}

\`secrets\` is the list of env-var names the skill needs; purposes/hints will be emitted into \`.env.example\` by the caller.
\`runner\` must be one of: "pytest", "vitest", "none".
\`path\` must start with \`tests/\` and must not contain \`..\` or absolute paths.
No code fences, no preamble.`;

export const REFERENCE_SYSTEM_PROMPT = `You generate reference documentation files for a skill in Skill Studio.

Given the user's skill description, produce 1-3 markdown reference files under \`references/\` that document external schemas, APIs, or domain concepts the skill needs. Files must:
- Be useful to a future maintainer reading the skill cold.
- Cite specific field names, types, and behaviors when describing external schemas.
- Stay under 300 lines each.

## Output Format
Return ONLY a JSON object:
{
  "files": [
    { "path": "references/<name>.md", "content": "<full markdown>" }
  ]
}

\`path\` must start with \`references/\` and must not contain \`..\` or absolute paths.
No code fences, no preamble.`;

// ---------------------------------------------------------------------------
// JSON parsers. Modeled on parseBodyResponse / parseEvalsResponse from
// skill-create-routes.ts — strip optional code-fence wrappers, JSON.parse,
// then validate the shape. Throw a descriptive Error on any malformed input
// so Promise.allSettled in the generator captures it as a rejection.
// ---------------------------------------------------------------------------

function stripCodeFences(text: string): string {
  // Be tolerant: some models still wrap in ```json\n...\n``` despite "no fences".
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function parseAgentJson(text: string, agent: string): unknown {
  const stripped = stripCodeFences(text);
  // Some models emit a trailing ---REASONING--- block (matches body-agent
  // pattern). Keep only the JSON portion.
  const reasoningCut = stripped.split(/\n---REASONING---/i)[0].trim();
  try {
    return JSON.parse(reasoningCut);
  } catch (err) {
    throw new Error(
      `${agent}-agent returned invalid JSON: ${(err as Error).message}. First 200 chars: ${reasoningCut.slice(0, 200)}`,
    );
  }
}

function validateFiles(raw: unknown, agent: string, pathPrefix: string): AgentFile[] {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${agent}-agent: response is not an object`);
  }
  const files = (raw as Record<string, unknown>).files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`${agent}-agent: missing or empty 'files' array`);
  }
  const out: AgentFile[] = [];
  for (const f of files) {
    if (!f || typeof f !== "object") {
      throw new Error(`${agent}-agent: file entry is not an object`);
    }
    const path = (f as Record<string, unknown>).path;
    const content = (f as Record<string, unknown>).content;
    if (typeof path !== "string" || path.length === 0) {
      throw new Error(`${agent}-agent: file.path must be a non-empty string`);
    }
    if (typeof content !== "string") {
      throw new Error(`${agent}-agent: file.content must be a string`);
    }
    if (path.includes("..") || path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) {
      throw new Error(`${agent}-agent: refused unsafe path '${path}'`);
    }
    if (!path.startsWith(pathPrefix)) {
      throw new Error(
        `${agent}-agent: path '${path}' must start with '${pathPrefix}'`,
      );
    }
    out.push({ path, content });
  }
  return out;
}

export function parseScriptResponse(text: string): ScriptAgentResponse {
  const raw = parseAgentJson(text, "script");
  const files = validateFiles(raw, "script", "scripts/");
  const r = (raw as Record<string, unknown>).runtime;
  let runtime: ScriptAgentResponse["runtime"];
  if (r && typeof r === "object") {
    const ro = r as Record<string, unknown>;
    runtime = {
      python: typeof ro.python === "string" ? ro.python : undefined,
      pip: Array.isArray(ro.pip) ? (ro.pip.filter((p) => typeof p === "string") as string[]) : undefined,
      node: typeof ro.node === "string" ? ro.node : undefined,
    };
  }
  return { files, runtime };
}

export function parseGraderResponse(text: string): GraderAgentResponse {
  const raw = parseAgentJson(text, "grader");
  const files = validateFiles(raw, "grader", "scripts/");
  return { files };
}

export function parseTestResponse(text: string): TestAgentResponse {
  const raw = parseAgentJson(text, "test");
  const files = validateFiles(raw, "test", "tests/");
  const r = raw as Record<string, unknown>;
  const secrets =
    Array.isArray(r.secrets)
      ? (r.secrets.filter((s) => typeof s === "string") as string[])
      : undefined;
  let integrationTests: TestAgentResponse["integrationTests"];
  const it = r.integrationTests;
  if (it && typeof it === "object") {
    const ito = it as Record<string, unknown>;
    const runner = ito.runner;
    if (runner === "pytest" || runner === "vitest" || runner === "none") {
      integrationTests = {
        runner,
        file: typeof ito.file === "string" ? ito.file : undefined,
        requires: Array.isArray(ito.requires)
          ? (ito.requires.filter((r2) => typeof r2 === "string") as string[])
          : undefined,
      };
    }
  }
  return { files, secrets, integrationTests };
}

export function parseReferenceResponse(text: string): ReferenceAgentResponse {
  const raw = parseAgentJson(text, "reference");
  const files = validateFiles(raw, "reference", "references/");
  return { files };
}
