// ---------------------------------------------------------------------------
// skill-create-routes.ts -- Skill creation & project layout detection
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { createLlmClient } from "../eval/llm.js";
import type { ProviderName } from "../eval/llm.js";

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

/** Check if skill-creator skill is installed */
function checkSkillCreatorInstalled(): boolean {
  const home = homedir();
  const candidates = [
    join(home, ".claude", "skills", "skill-creator"),
    join(home, ".claude", "plugins", "cache", "skill-creator"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return true;
  }
  // Also check for plugin with nested structure
  try {
    const pluginsCache = join(home, ".claude", "plugins", "cache");
    if (existsSync(pluginsCache)) {
      const entries = readdirSync(pluginsCache, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.includes("skill-creator")) return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

// ---------------------------------------------------------------------------
// AI skill generation
// ---------------------------------------------------------------------------

const GENERATE_SYSTEM_PROMPT = `You are an expert AI skill engineer following the Skill Builder methodology. Given a user's description of what a skill should do, generate a complete, production-quality skill definition.

## Skill Builder Methodology

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

After the JSON, on a new line, write "---REASONING---" followed by a brief explanation of your design choices (why this name, why these trigger phrases, what methodology rules you applied).`;

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
}

function parseGenerateResponse(raw: string): GenerateSkillResult {
  const parts = raw.split("---REASONING---");
  const jsonPart = parts[0].trim();
  const reasoning = parts.length > 1 ? parts[1].trim() : "Skill generated using Skill Builder methodology.";

  // Strip code fences if present
  const cleaned = jsonPart.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("AI response was not valid JSON. Try again or use manual mode.");
  }

  return {
    name: String(parsed.name || "").replace(/[^a-z0-9-]/g, ""),
    description: String(parsed.description || ""),
    model: String(parsed.model || ""),
    allowedTools: String(parsed.allowedTools || ""),
    body: String(parsed.body || ""),
    evals: Array.isArray(parsed.evals) ? parsed.evals as GenerateSkillResult["evals"] : [],
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

    const targetDir = computeSkillDir(root, body.layout, body.plugin || "", body.name);

    // Check if already exists
    if (existsSync(join(targetDir, "SKILL.md"))) {
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
      }

      sendJson(res, {
        ok: true,
        plugin: body.layout === 3 ? (basename(root) || "default") : body.plugin,
        skill: body.name,
        dir: targetDir,
        skillMdPath,
      }, 201, req);
    } catch (err) {
      sendJson(res, { error: `Failed to create skill: ${(err as Error).message}` }, 500, req);
    }
  });

  // GET /api/skill-creator-status — check if skill-creator is installed
  router.get("/api/skill-creator-status", async (_req, res) => {
    const installed = checkSkillCreatorInstalled();
    sendJson(res, {
      installed,
      installCommand: "vskill install skill-creator:skill-creator",
    }, 200, _req);
  });

  // POST /api/skills/generate — AI-assisted skill generation
  router.post("/api/skills/generate", async (req, res) => {
    const body = (await readBody(req)) as GenerateSkillRequest;

    if (!body.prompt || !body.prompt.trim()) {
      sendJson(res, { error: "Describe what your skill should do" }, 400, req);
      return;
    }

    try {
      const client = createLlmClient({
        provider: body.provider,
        model: body.model,
      });

      const userPrompt = `Generate a complete skill definition for:\n\n${body.prompt.trim()}\n\nApply the Skill Builder methodology. Return the JSON object followed by ---REASONING--- and your explanation.`;

      const result = await client.generate(GENERATE_SYSTEM_PROMPT, userPrompt);
      const parsed = parseGenerateResponse(result.text);

      sendJson(res, parsed, 200, req);
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes("not valid JSON") ? 422 : 500;
      sendJson(res, { error: msg }, status, req);
    }
  });
}
