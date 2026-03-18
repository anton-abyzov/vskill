// ---------------------------------------------------------------------------
// skill-create-routes.ts -- Skill creation & project layout detection
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { join, basename, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { AGENTS_REGISTRY } from "../agents/agents-registry.js";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { createLlmClient } from "../eval/llm.js";
import type { ProviderName } from "../eval/llm.js";
import { initSSE, sendSSE, sendSSEDone, withHeartbeat } from "./sse-helpers.js";
import { classifyError } from "./error-classifier.js";
import { writeHistoryEntry } from "../eval/benchmark-history.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DetectedLayout {
  layout: 1 | 2 | 3 | 4;
  label: string;
  pathTemplate: string;
  existingPlugins: string[];
}

interface ProjectLayoutResponse {
  root: string;
  detectedLayouts: DetectedLayout[];
  suggestedLayout: 1 | 2 | 3;
  existingSkills: Array<{ plugin: string; skill: string }>;
}

interface AiGenerationMeta {
  prompt: string;
  provider: string;
  model: string;
  reasoning: string;
}

interface CreateSkillRequest {
  name: string;
  plugin: string;
  layout: 1 | 2 | 3;
  description: string;
  model?: string;
  allowedTools?: string;
  body: string;
  evals?: Array<{
    id: number;
    name: string;
    prompt: string;
    expected_output: string;
    assertions: Array<{ id: string; text: string; type: string }>;
  }>;
  aiMeta?: AiGenerationMeta;
  draftDir?: string;
}

interface SaveDraftRequest extends CreateSkillRequest {
  aiMeta: AiGenerationMeta;
}

export interface PluginSuggestion {
  plugin: string;
  layout: 1 | 2;
  confidence: "high" | "medium" | "low";
  reason: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXCLUDE_DIRS = new Set([
  "skills", "plugins", "node_modules", ".git", ".specweave",
  "dist", "evals", ".claude", ".cursor", ".agents", "coverage",
]);

/** List subdirs of a skills/ dir that contain SKILL.md */
function listSkillDirs(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, "SKILL.md")))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** Detect project layout — mirrors scanSkills() logic from skill-scanner.ts */
function detectProjectLayout(root: string): ProjectLayoutResponse {
  const layouts: DetectedLayout[] = [];
  const allSkills: Array<{ plugin: string; skill: string }> = [];

  // Layout 4: Self — root IS the skill
  if (existsSync(join(root, "SKILL.md"))) {
    layouts.push({
      layout: 4,
      label: "Self (root is the skill)",
      pathTemplate: `${root}/SKILL.md`,
      existingPlugins: [],
    });
  }

  // Layout 3: Root skills/ directory
  const rootSkillsDir = join(root, "skills");
  if (existsSync(rootSkillsDir)) {
    const skills = listSkillDirs(rootSkillsDir);
    const pluginName = basename(root) || "default";
    layouts.push({
      layout: 3,
      label: "Root skills/",
      pathTemplate: "{root}/skills/{skill}/",
      existingPlugins: [pluginName],
    });
    for (const s of skills) allSkills.push({ plugin: pluginName, skill: s });
  }

  // Layout 1: Direct plugin dirs — {root}/{plugin}/skills/{skill}/
  const directPlugins: string[] = [];
  try {
    const entries = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !EXCLUDE_DIRS.has(d.name) && !d.name.startsWith("."));
    for (const entry of entries) {
      const skillsPath = join(root, entry.name, "skills");
      if (existsSync(skillsPath)) {
        directPlugins.push(entry.name);
        const skills = listSkillDirs(skillsPath);
        for (const s of skills) allSkills.push({ plugin: entry.name, skill: s });
      }
    }
  } catch { /* ignore */ }

  if (directPlugins.length > 0) {
    layouts.push({
      layout: 1,
      label: "Direct plugins",
      pathTemplate: "{root}/{plugin}/skills/{skill}/",
      existingPlugins: directPlugins,
    });
  }

  // Layout 2: Nested plugins/ dir — {root}/plugins/{plugin}/skills/{skill}/
  const pluginsDir = join(root, "plugins");
  if (existsSync(pluginsDir)) {
    const nestedPlugins: string[] = [];
    try {
      const entries = readdirSync(pluginsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());
      for (const entry of entries) {
        const skillsPath = join(pluginsDir, entry.name, "skills");
        if (existsSync(skillsPath)) {
          nestedPlugins.push(entry.name);
          const skills = listSkillDirs(skillsPath);
          for (const s of skills) allSkills.push({ plugin: entry.name, skill: s });
        }
      }
    } catch { /* ignore */ }

    if (nestedPlugins.length > 0) {
      layouts.push({
        layout: 2,
        label: "Nested plugins/",
        pathTemplate: "{root}/plugins/{plugin}/skills/{skill}/",
        existingPlugins: nestedPlugins,
      });
    }
  }

  // Suggestion priority: Layout 2 > Layout 1 > Layout 3
  let suggestedLayout: 1 | 2 | 3 = 3;
  if (layouts.find((l) => l.layout === 2)) suggestedLayout = 2;
  else if (layouts.find((l) => l.layout === 1)) suggestedLayout = 1;

  return { root, detectedLayouts: layouts, suggestedLayout, existingSkills: allSkills };
}

/** Build SKILL.md content from form fields */
function buildSkillMd(data: CreateSkillRequest): string {
  const lines: string[] = ["---"];
  // Description — always quote to handle special chars
  lines.push(`description: "${data.description.replace(/"/g, '\\"')}"`);
  if (data.allowedTools?.trim()) {
    lines.push(`allowed-tools: ${data.allowedTools.trim()}`);
  }
  if (data.model) {
    lines.push(`model: ${data.model}`);
  }
  lines.push("---");
  lines.push("");

  if (data.body.trim()) {
    lines.push(data.body.trim());
  } else {
    lines.push(`# /${data.name}`);
    lines.push("");
    lines.push("You are a helpful assistant. Describe what this skill does.");
  }

  return lines.join("\n") + "\n";
}

/** Compute target directory for a new skill based on layout */
function computeSkillDir(root: string, layout: 1 | 2 | 3, plugin: string, name: string): string {
  switch (layout) {
    case 1: return join(root, plugin, "skills", name);
    case 2: return join(root, "plugins", plugin, "skills", name);
    case 3: return join(root, "skills", name);
  }
}

/**
 * Check if a resolved path is strictly within a root directory.
 * Uses trailing separator to prevent prefix collision (e.g., /project vs /project-evil).
 */
export function isDraftWithinRoot(draftPath: string, root: string): boolean {
  const resolvedRoot = resolve(root) + sep;
  const resolvedDraft = resolve(draftPath);
  return resolvedDraft.startsWith(resolvedRoot) && resolvedDraft !== resolve(root);
}

/**
 * Match a newly generated skill against existing plugins by tag/keyword overlap.
 * Returns the best-matching plugin if score exceeds threshold, or null.
 */
export function matchExistingPlugin(
  skillName: string,
  skillDescription: string,
  skillTags: string[],
  root: string,
): PluginSuggestion | null {
  const layout = detectProjectLayout(root);
  const pluginSkills = new Map<string, { layout: 1 | 2; tags: Set<string>; keywords: Set<string> }>();

  // Gather existing plugin metadata from detected layouts
  for (const detected of layout.detectedLayouts) {
    if (detected.layout !== 1 && detected.layout !== 2) continue;
    for (const pluginName of detected.existingPlugins) {
      if (pluginSkills.has(pluginName)) continue;
      const tags = new Set<string>();
      const keywords = new Set<string>();

      // Read SKILL.md frontmatter from each skill in this plugin
      const skillsDirPath = detected.layout === 1
        ? join(root, pluginName, "skills")
        : join(root, "plugins", pluginName, "skills");

      const skillDirs = listSkillDirs(skillsDirPath);
      for (const skillDir of skillDirs) {
        const mdPath = join(skillsDirPath, skillDir, "SKILL.md");
        try {
          const content = readFileSync(mdPath, "utf-8");
          const tagsMatch = content.match(/^---[\s\S]*?tags:\s*(.+)[\s\S]*?---/m);
          if (tagsMatch) {
            for (const t of tagsMatch[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
              tags.add(t);
            }
          }
          const descMatch = content.match(/^---[\s\S]*?description:\s*"([^"]+)"[\s\S]*?---/);
          if (descMatch) {
            for (const w of descMatch[1].toLowerCase().split(/\s+/).filter((w) => w.length > 3)) {
              keywords.add(w);
            }
          }
        } catch { /* skip unreadable */ }
      }

      // Also add plugin name segments as keywords
      for (const seg of pluginName.split(/[-_.]/).filter(Boolean)) {
        keywords.add(seg.toLowerCase());
      }

      pluginSkills.set(pluginName, { layout: detected.layout as 1 | 2, tags, keywords });
    }
  }

  if (pluginSkills.size === 0) return null;

  const inputTags = new Set(skillTags.map((t) => t.toLowerCase()));
  const inputKeywords = new Set(
    skillDescription.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
  );
  // Add skill name segments
  for (const seg of skillName.split(/[-_.]/).filter(Boolean)) {
    inputKeywords.add(seg.toLowerCase());
  }

  let bestPlugin: string | null = null;
  let bestScore = 0;
  let bestLayout: 1 | 2 = 1;
  let bestReason = "";

  for (const [pluginName, data] of pluginSkills) {
    let score = 0;
    const matchingTags: string[] = [];
    const matchingKeywords: string[] = [];

    // Tag overlap (weighted heavily)
    for (const tag of inputTags) {
      if (data.tags.has(tag)) {
        score += 3;
        matchingTags.push(tag);
      }
    }

    // Keyword overlap
    for (const kw of inputKeywords) {
      if (data.keywords.has(kw)) {
        score += 1;
        matchingKeywords.push(kw);
      }
    }

    // Plugin name similarity: shared segments (e.g. "browser-automation" ↔ "browser-screenshot")
    const pluginSegs = new Set(pluginName.toLowerCase().split(/[-_.]/).filter(Boolean));
    const skillSegs = new Set(skillName.toLowerCase().split(/[-_.]/).filter(Boolean));
    let sharedSegs = 0;
    for (const seg of skillSegs) {
      if (pluginSegs.has(seg)) sharedSegs++;
    }
    if (sharedSegs > 0) score += sharedSegs * 2;

    if (score > bestScore) {
      bestScore = score;
      bestPlugin = pluginName;
      bestLayout = data.layout;
      const parts: string[] = [];
      if (matchingTags.length > 0) parts.push(`${matchingTags.length} matching tags: ${matchingTags.join(", ")}`);
      if (matchingKeywords.length > 0) parts.push(`${matchingKeywords.length} keyword overlaps`);
      bestReason = parts.join("; ") || "name similarity";
    }
  }

  if (!bestPlugin || bestScore < 2) return null;

  const confidence: "high" | "medium" | "low" = bestScore >= 6 ? "high" : bestScore >= 3 ? "medium" : "low";

  return {
    plugin: bestPlugin,
    layout: bestLayout,
    confidence,
    reason: bestReason,
  };
}

/** Check if skill-creator skill is installed in any agent's skill directory */
function checkSkillCreatorInstalled(): boolean {
  const home = homedir();

  // Canonical vskill path (source of truth)
  if (existsSync(join(home, ".agents", "skills", "skill-creator"))) return true;

  // Check every registered agent's global skills directory
  for (const agent of AGENTS_REGISTRY) {
    const resolved = agent.globalSkillsDir.replace("~", home);
    if (existsSync(join(resolved, "skill-creator"))) return true;

    // Also check plugin cache dir if the agent has one (e.g. Claude)
    // Plugins live at: cache/<marketplace>/<plugin-name>/<version>/
    if (agent.pluginCacheDir) {
      const cacheDir = agent.pluginCacheDir.replace("~", home);
      try {
        if (existsSync(cacheDir)) {
          const marketplaces = readdirSync(cacheDir, { withFileTypes: true });
          for (const mkt of marketplaces) {
            if (!mkt.isDirectory()) continue;
            const mktPath = join(cacheDir, mkt.name);
            const plugins = readdirSync(mktPath, { withFileTypes: true });
            for (const plugin of plugins) {
              if (plugin.isDirectory() && plugin.name.includes("skill-creator")) return true;
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// AI skill generation
// ---------------------------------------------------------------------------

// Shared best practices block used by both body and eval prompts
const SKILL_STUDIO_BEST_PRACTICES = `## Skill Studio Best Practices

### SKILL.md Anatomy
Every skill has YAML frontmatter (description required, name/model/allowed-tools optional) and a markdown body with instructions.

### Description Quality (Frontmatter) — CRITICAL
The description is the PRIMARY triggering mechanism. It must be "pushy" to combat undertriggering:
- Use third-person format: "This skill should be used when the user asks to..."
- Include specific trigger phrases users would say (e.g., "create X", "configure Y", "fix Z")
- Include explicit activation phrases: "Make sure to use this skill whenever the user mentions..."
- Be concrete and specific, not vague or generic
- BAD: "Provides guidance for working with X" (vague, no triggers)
- GOOD: "This skill should be used when the user asks to \\"create X\\", \\"configure Y\\", or \\"troubleshoot Z\\". Activate whenever the user mentions X-related tasks."

### Writing Style
- Use imperative/infinitive form (verb-first instructions), NOT second person
- Use objective, instructional language: "To accomplish X, do Y" not "You should do X"
- BAD: "You should start by reading the file" / "You need to validate"
- GOOD: "Start by reading the file" / "Validate the input before processing"
- Explain the WHY behind rules — LLMs respond better to reasoning than rigid MUST/NEVER

### Progressive Disclosure
- Keep SKILL.md lean: 500-2000 words ideal for body, under 500 lines total
- Core concepts and essential procedures in the body
- Structure with ## sections: Workflow, Rules, Output Format, Examples

### Content Quality
- Focus on procedural knowledge non-obvious to an AI assistant
- Include information that helps another AI instance execute tasks effectively
- Include concrete examples where helpful
- Include a clear Workflow section with numbered steps

### Common Mistakes to Avoid
- Weak trigger descriptions (vague, no specific phrases)
- Too much content without structure
- Second-person writing style
- Missing workflow section
- Overly generic instructions that don't add value

### Action-First Skills (Bash/tool-execution)
When a skill includes allowed-tools: Bash (or Read, Write, Edit), the skill body MUST:
- Open with an explicit execution directive: "Execute each step immediately. Run Bash commands directly — do not ask for permission or describe plans."
- Use "Step N — [action verb]. Run this immediately:" headers, not "Step N: [noun] Discovery"
- Every step must end with a concrete, complete, copy-pasteable code block — not prose describing what the code would do
- Include any variable values (paths, URLs, flags) directly in the code block, not as placeholders`;

const BODY_SYSTEM_PROMPT = `You are an expert AI skill engineer in Skill Studio. Given a user's description of what a skill should do, generate the SKILL.md body and metadata (NOT evals).

${SKILL_STUDIO_BEST_PRACTICES}

## Output Format
Return a JSON object with these fields:
{
  "name": "kebab-case-name",
  "description": "Third-person trigger description with specific activation phrases",
  "model": "",
  "allowedTools": "",
  "body": "# /skill-name\\n\\nFull system prompt with ## sections"
}

Field rules:
- name: kebab-case, concise, descriptive (e.g., "sql-formatter", "api-docs-generator")
- description: 1-3 sentences with trigger phrases. Must pass the "would Claude trigger on this?" test
- model: "" (any) unless task clearly requires opus-level reasoning or is trivially haiku-suitable
- allowedTools: comma-separated list (e.g., "Read, Write, Edit, Bash") or "" for unrestricted. Only restrict when the skill genuinely shouldn't use certain tools
- body: Complete markdown starting with # /skill-name, structured with ## sections, 500-2000 words

Return ONLY the JSON object — no code fences, no preamble.

After the JSON, on a new line, write "---REASONING---" followed by a brief explanation of your design choices (why this name, why these trigger phrases, what Skill Studio rules you applied).`;

const EVAL_SYSTEM_PROMPT = `You are an expert AI skill evaluator. Given a skill's name, description, and purpose, generate eval test cases that verify the skill works correctly.

### Eval Assertions for Action-Oriented Skills (CRITICAL)
The eval evaluates the LLM text response — it cannot run Bash or call tools. Assertions must check for code/commands present IN the response, not whether they were executed.
- BAD: "Runs a bash command to discover profiles" (implies execution — will always fail)
- GOOD: "Response includes a bash code block that lists Chrome profile directories"
- BAD: "Opens https://studio.youtube.com as the target URL"
- GOOD: "Response includes studio.youtube.com as the target URL in a code block or command"
- BAD: "Checks that the file exists before uploading"
- GOOD: "Response includes a bash command checking whether the file exists (e.g., using test -f or ls)"

## Output Format
Return a JSON object with these fields:
{
  "evals": [
    {
      "id": 1,
      "name": "test case name",
      "prompt": "realistic user prompt",
      "expected_output": "description of correct behavior",
      "assertions": [
        { "id": "a1", "text": "objectively verifiable assertion", "type": "boolean" }
      ]
    }
  ]
}

Field rules:
- evals: 2-3 realistic test cases with objectively verifiable assertions
- Prompts should be what real users would say, not abstract test inputs
- Each assertion must be independently verifiable by a judge LLM reading the response text

Return ONLY the JSON object — no code fences, no preamble.`;

// Keep the monolithic prompt for backward compatibility (used nowhere after refactor but exported for tests)
const GENERATE_SYSTEM_PROMPT = `You are an expert AI skill engineer in Skill Studio. Given a user's description of what a skill should do, generate a complete, production-quality skill definition.

${SKILL_STUDIO_BEST_PRACTICES}

### Eval Assertions for Action-Oriented Skills (CRITICAL)
The eval evaluates the LLM text response — it cannot run Bash or call tools. Assertions must check for code/commands present IN the response, not whether they were executed.
- BAD: "Runs a bash command to discover profiles" (implies execution — will always fail)
- GOOD: "Response includes a bash code block that lists Chrome profile directories"
- BAD: "Opens https://studio.youtube.com as the target URL"
- GOOD: "Response includes studio.youtube.com as the target URL in a code block or command"
- BAD: "Checks that the file exists before uploading"
- GOOD: "Response includes a bash command checking whether the file exists (e.g., using test -f or ls)"

## Output Format
Return a JSON object with these fields:
{
  "name": "kebab-case-name",
  "description": "Third-person trigger description with specific activation phrases",
  "model": "",
  "allowedTools": "",
  "body": "# /skill-name\\n\\nFull system prompt with ## sections",
  "evals": [
    {
      "id": 1,
      "name": "test case name",
      "prompt": "realistic user prompt",
      "expected_output": "description of correct behavior",
      "assertions": [
        { "id": "a1", "text": "objectively verifiable assertion", "type": "boolean" }
      ]
    }
  ]
}

Field rules:
- name: kebab-case, concise, descriptive (e.g., "sql-formatter", "api-docs-generator")
- description: 1-3 sentences with trigger phrases. Must pass the "would Claude trigger on this?" test
- model: "" (any) unless task clearly requires opus-level reasoning or is trivially haiku-suitable
- allowedTools: comma-separated list (e.g., "Read, Write, Edit, Bash") or "" for unrestricted. Only restrict when the skill genuinely shouldn't use certain tools
- body: Complete markdown starting with # /skill-name, structured with ## sections, 500-2000 words
- evals: 2-3 realistic test cases with objectively verifiable assertions. Prompts should be what real users would say, not abstract test inputs

Return ONLY the JSON object — no code fences, no preamble.

After the JSON, on a new line, write "---REASONING---" followed by a brief explanation of your design choices (why this name, why these trigger phrases, what Skill Studio rules you applied).`;

interface GenerateSkillRequest {
  prompt: string;
  provider?: ProviderName;
  model?: string;
}

interface GenerateSkillResult {
  name: string;
  description: string;
  model: string;
  allowedTools: string;
  body: string;
  evals: Array<{
    id: number;
    name: string;
    prompt: string;
    expected_output: string;
    assertions: Array<{ id: string; text: string; type: string }>;
  }>;
  reasoning: string;
  warning?: string;
}

/** Strip code fences and parse JSON from raw LLM output */
function cleanAndParseJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("AI response was not valid JSON. Try again or use manual mode.");
  }
}

interface BodyResult {
  name: string;
  description: string;
  model: string;
  allowedTools: string;
  body: string;
  reasoning: string;
}

type EvalItem = GenerateSkillResult["evals"][number];

interface EvalsResult {
  evals: EvalItem[];
}

function parseBodyResponse(raw: string): BodyResult {
  const parts = raw.split("---REASONING---");
  const jsonPart = parts[0].trim();
  const reasoning = parts.length > 1 ? parts[1].trim() : "Skill generated using Skill Studio best practices.";

  const parsed = cleanAndParseJson(jsonPart);
  const name = String(parsed.name || "").replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  if (!name) throw new Error("AI returned an invalid skill name. Try again or use manual mode.");

  return {
    name,
    description: String(parsed.description || ""),
    model: String(parsed.model || ""),
    allowedTools: String(parsed.allowedTools || ""),
    body: String(parsed.body || ""),
    reasoning,
  };
}

function parseEvalsResponse(raw: string): EvalsResult {
  const jsonPart = raw.trim();
  const parsed = cleanAndParseJson(jsonPart);
  const evals = Array.isArray(parsed.evals) ? (parsed.evals as EvalItem[]).slice(0, 10) : [];
  return { evals };
}

function mergeGenerateResults(
  bodySettled: PromiseSettledResult<BodyResult>,
  evalsSettled: PromiseSettledResult<EvalsResult>,
): GenerateSkillResult {
  // Body is required — if it failed, propagate the error
  if (bodySettled.status === "rejected") {
    throw bodySettled.reason instanceof Error
      ? bodySettled.reason
      : new Error(String(bodySettled.reason));
  }

  const bodyResult = bodySettled.value;

  // Evals are optional — if they failed, return body with empty evals and warning
  if (evalsSettled.status === "rejected") {
    const reason = evalsSettled.reason instanceof Error
      ? evalsSettled.reason.message
      : String(evalsSettled.reason);
    return {
      ...bodyResult,
      evals: [],
      warning: `eval generation failed: ${reason}`,
    };
  }

  return {
    ...bodyResult,
    evals: evalsSettled.value.evals,
  };
}

/** Legacy monolithic parser — still used as fallback */
function parseGenerateResponse(raw: string): GenerateSkillResult {
  const parts = raw.split("---REASONING---");
  const jsonPart = parts[0].trim();
  const reasoning = parts.length > 1 ? parts[1].trim() : "Skill generated using Skill Studio best practices.";

  const parsed = cleanAndParseJson(jsonPart);
  const name = String(parsed.name || "").replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  if (!name) throw new Error("AI returned an invalid skill name. Try again or use manual mode.");

  return {
    name,
    description: String(parsed.description || ""),
    model: String(parsed.model || ""),
    allowedTools: String(parsed.allowedTools || ""),
    body: String(parsed.body || ""),
    evals: Array.isArray(parsed.evals) ? (parsed.evals as GenerateSkillResult["evals"]).slice(0, 10) : [],
    reasoning,
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerSkillCreateRoutes(router: Router, root: string): void {
  // GET /api/project-layout — detect project layout and suggest placement
  router.get("/api/project-layout", async (_req, res) => {
    try {
      const layout = detectProjectLayout(root);
      sendJson(res, layout, 200, _req);
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500, _req);
    }
  });

  // POST /api/skills/create — create a new skill
  router.post("/api/skills/create", async (req, res) => {
    const body = (await readBody(req)) as CreateSkillRequest;

    // Validate name
    if (!body.name || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(body.name)) {
      sendJson(res, { error: "Name must be kebab-case (lowercase letters, numbers, hyphens)" }, 400, req);
      return;
    }
    if (!body.description?.trim()) {
      sendJson(res, { error: "Description is required" }, 400, req);
      return;
    }
    if (!body.layout || ![1, 2, 3].includes(body.layout)) {
      sendJson(res, { error: "Layout must be 1, 2, or 3" }, 400, req);
      return;
    }
    if (body.layout !== 3 && !body.plugin?.trim()) {
      sendJson(res, { error: "Plugin name is required for this layout" }, 400, req);
      return;
    }
    if (body.plugin && !/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(body.plugin)) {
      sendJson(res, { error: "Plugin name contains invalid characters" }, 400, req);
      return;
    }

    const targetDir = computeSkillDir(root, body.layout, body.plugin || "", body.name);

    // Check if already exists (allow overwriting drafts — draft.json indicates auto-saved draft)
    const isDraftFinalize = existsSync(join(targetDir, "draft.json"));
    if (existsSync(join(targetDir, "SKILL.md")) && !isDraftFinalize) {
      sendJson(res, { error: `Skill already exists at ${targetDir}` }, 409, req);
      return;
    }

    try {
      // Create directories
      mkdirSync(targetDir, { recursive: true });
      mkdirSync(join(targetDir, "evals"), { recursive: true });

      // Write SKILL.md
      const content = buildSkillMd(body);
      const skillMdPath = join(targetDir, "SKILL.md");
      writeFileSync(skillMdPath, content, "utf-8");

      // Write evals.json if provided (from AI generation)
      if (body.evals && body.evals.length > 0) {
        const evalsData = {
          skill_name: body.name,
          evals: body.evals,
        };
        writeFileSync(
          join(targetDir, "evals", "evals.json"),
          JSON.stringify(evalsData, null, 2) + "\n",
          "utf-8",
        );

        // Record history entry for AI-generated skill (skip if draft finalization — already written by save-draft)
        if (!isDraftFinalize) {
          const aiMeta = body.aiMeta;
          try {
            await writeHistoryEntry(targetDir, {
              timestamp: new Date().toISOString(),
              model: aiMeta?.model || "unknown",
              skill_name: body.name,
              cases: [],
              overall_pass_rate: undefined,
              type: "ai-generate",
              provider: aiMeta?.provider || "unknown",
              generate: { prompt: aiMeta?.prompt || body.description, result: content },
            });
          } catch { /* history write failure should not break the main response */ }
        }
      }

      // Finalize: remove draft.json if it exists (draft → final)
      const draftPath = join(targetDir, "draft.json");
      if (existsSync(draftPath)) {
        try { unlinkSync(draftPath); } catch { /* ignore */ }
      }

      // Clean up old draft directory if plugin was changed
      if (body.draftDir) {
        const resolvedDraft = resolve(root, body.draftDir);
        if (isDraftWithinRoot(resolvedDraft, root) && resolvedDraft !== resolve(targetDir)) {
          try { rmSync(resolvedDraft, { recursive: true, force: true }); } catch { /* non-blocking */ }
        }
      }

      sendJson(res, {
        ok: true,
        plugin: body.layout === 3 ? (basename(root) || "default") : body.plugin,
        skill: body.name,
        dir: targetDir,
        skillMdPath,
      }, 201, req);
    } catch (err) {
      // On failure, do NOT delete draftDir — preserve user's work
      sendJson(res, { error: `Failed to create skill: ${(err as Error).message}` }, 500, req);
    }
  });

  // POST /api/skills/save-draft — auto-save AI-generated skill as draft
  router.post("/api/skills/save-draft", async (req, res) => {
    const body = (await readBody(req)) as SaveDraftRequest;

    if (!body.name || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(body.name)) {
      sendJson(res, { error: "Name must be kebab-case" }, 400, req);
      return;
    }
    if (!body.description?.trim()) {
      sendJson(res, { error: "Description is required" }, 400, req);
      return;
    }
    if (!body.layout || ![1, 2, 3].includes(body.layout)) {
      sendJson(res, { error: "Layout must be 1, 2, or 3" }, 400, req);
      return;
    }

    const targetDir = computeSkillDir(root, body.layout, body.plugin || "", body.name);
    const files: string[] = [];

    try {
      // Create directories (overwrites allowed for re-generation)
      mkdirSync(targetDir, { recursive: true });
      mkdirSync(join(targetDir, "evals"), { recursive: true });
      mkdirSync(join(targetDir, "evals", "history"), { recursive: true });

      // Write SKILL.md
      const content = buildSkillMd(body);
      const skillMdPath = join(targetDir, "SKILL.md");
      writeFileSync(skillMdPath, content, "utf-8");
      files.push("SKILL.md");

      // Write evals.json if provided
      if (body.evals && body.evals.length > 0) {
        const evalsData = { skill_name: body.name, evals: body.evals };
        writeFileSync(
          join(targetDir, "evals", "evals.json"),
          JSON.stringify(evalsData, null, 2) + "\n",
          "utf-8",
        );
        files.push("evals/evals.json");
      }

      // Write draft.json metadata
      const draftMeta = {
        draft: true,
        createdAt: new Date().toISOString(),
        aiPrompt: body.aiMeta.prompt,
        aiProvider: body.aiMeta.provider,
        aiModel: body.aiMeta.model,
        aiReasoning: body.aiMeta.reasoning,
      };
      writeFileSync(
        join(targetDir, "draft.json"),
        JSON.stringify(draftMeta, null, 2) + "\n",
        "utf-8",
      );
      files.push("draft.json");

      // Record AI generation history
      try {
        await writeHistoryEntry(targetDir, {
          timestamp: new Date().toISOString(),
          model: body.aiMeta.model,
          skill_name: body.name,
          cases: [],
          overall_pass_rate: undefined,
          type: "ai-generate",
          provider: body.aiMeta.provider,
          generate: { prompt: body.aiMeta.prompt, result: content },
        });
      } catch { /* history write failure should not break the main response */ }

      sendJson(res, {
        ok: true,
        plugin: body.layout === 3 ? (basename(root) || "default") : body.plugin,
        skill: body.name,
        dir: targetDir,
        skillMdPath,
        files,
      }, 201, req);
    } catch (err) {
      sendJson(res, { error: `Failed to save draft: ${(err as Error).message}` }, 500, req);
    }
  });

  // GET /api/skill-creator-status — check if skill-creator is installed
  router.get("/api/skill-creator-status", async (_req, res) => {
    const installed = checkSkillCreatorInstalled();
    sendJson(res, {
      installed,
      installCommand: "npx vskill install anthropics/skills/skill-creator",
    }, 200, _req);
  });

  // POST /api/skills/generate — AI-assisted skill generation (parallel body + evals)
  router.post("/api/skills/generate", async (req, res) => {
    const body = (await readBody(req)) as GenerateSkillRequest;

    if (!body.prompt || !body.prompt.trim()) {
      sendJson(res, { error: "Describe what your skill should do" }, 400, req);
      return;
    }

    if (body.prompt.length > 50000) {
      sendJson(res, { error: "Prompt is too long (max 50,000 characters)" }, 400, req);
      return;
    }

    const wantsSSE = req.headers.accept?.includes("text/event-stream") ||
      (req.url ? new URL(req.url, "http://localhost").searchParams.has("sse") : false);

    let aborted = false;
    res.on("close", () => { aborted = true; });

    if (wantsSSE) initSSE(res, req);

    const providerName = body.provider || "claude-cli";

    try {
      if (wantsSSE && !aborted) sendSSE(res, "progress", { phase: "preparing", message: "Building prompt..." });

      // Body generation: capable model (user-specified or default)
      const bodyClient = createLlmClient({
        provider: body.provider,
        model: body.model,
      });

      // Eval generation: fast/cheap model (configurable via VSKILL_EVAL_GEN_MODEL, default haiku)
      const evalModel = process.env.VSKILL_EVAL_GEN_MODEL || "haiku";
      const evalClient = createLlmClient({
        provider: body.provider,
        model: evalModel,
      });

      // Detect existing plugins to inject into the body prompt for LLM-based category matching
      const layout = detectProjectLayout(root);
      const existingPlugins = [...new Set(layout.detectedLayouts.flatMap(d => d.existingPlugins))];
      const pluginContext = existingPlugins.length > 0
        ? `\n\nExisting plugins in this project: ${JSON.stringify(existingPlugins)}. Include a "suggestedPlugin" field in your JSON response with the best-matching plugin name from this list, or a new kebab-case name if none fit.`
        : `\n\nInclude a "suggestedPlugin" field in your JSON response with a suggested kebab-case plugin/category name for this skill.`;

      const bodyPrompt = `Generate a skill definition (body and metadata only, NO evals) for:\n\n${body.prompt.trim()}\n\nApply Skill Studio best practices. Return the JSON object followed by ---REASONING--- and your explanation.${pluginContext}`;
      const evalPrompt = `Generate eval test cases for this skill:\n\n${body.prompt.trim()}\n\nReturn only the JSON object with an "evals" array.`;

      // Emit SSE events for both parallel phases
      if (wantsSSE && !aborted) {
        sendSSE(res, "progress", { phase: "generating-body", message: "Generating skill body..." });
        sendSSE(res, "progress", { phase: "generating-evals", message: "Generating evals..." });
      }

      // Launch both calls in parallel
      const bodyCall = wantsSSE
        ? withHeartbeat(res, undefined, "generating-body", "Generating body", () => bodyClient.generate(BODY_SYSTEM_PROMPT, bodyPrompt))
        : bodyClient.generate(BODY_SYSTEM_PROMPT, bodyPrompt);

      const evalCall = wantsSSE
        ? withHeartbeat(res, undefined, "generating-evals", "Generating evals", () => evalClient.generate(EVAL_SYSTEM_PROMPT, evalPrompt))
        : evalClient.generate(EVAL_SYSTEM_PROMPT, evalPrompt);

      const [bodySettled, evalsSettled] = await Promise.allSettled([
        bodyCall.then((r) => parseBodyResponse(r.text)),
        evalCall.then((r) => parseEvalsResponse(r.text)),
      ]);

      if (aborted) return;

      if (wantsSSE && !aborted) sendSSE(res, "progress", { phase: "parsing", message: "Merging results..." });

      const parsed = mergeGenerateResults(bodySettled, evalsSettled);

      // Match against existing plugins
      const tags = parsed.description
        ? parsed.description.toLowerCase().split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean)
        : [];
      const suggestedPlugin = matchExistingPlugin(
        parsed.name,
        parsed.description,
        tags,
        root,
      );

      const result = { ...parsed, suggestedPlugin };

      if (wantsSSE && !aborted) {
        sendSSEDone(res, result);
      } else {
        sendJson(res, result, 200, req);
      }
    } catch (err) {
      if (wantsSSE && !aborted) {
        sendSSE(res, "error", classifyError(err, providerName));
        res.end();
      } else {
        const msg = (err as Error).message;
        const status = msg.includes("not valid JSON") ? 422 : 500;
        sendJson(res, { error: msg }, status, req);
      }
    }
  });
}
