// ---------------------------------------------------------------------------
// skill-create-routes.ts -- Skill creation & project layout detection
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";

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
}
