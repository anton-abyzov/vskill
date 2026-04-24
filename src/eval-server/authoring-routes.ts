// ---------------------------------------------------------------------------
// 0698 — authoring routes: file-scaffolding endpoint for the Create Skill modal.
//
// POST /api/authoring/create-skill
//   body: {
//     mode: "standalone" | "existing-plugin" | "new-plugin",
//     skillName: string,          // kebab-case
//     description?: string,
//     pluginName?: string,        // required for "existing-plugin" + "new-plugin"
//   }
//
// Writes the minimum viable layout:
//   standalone     → <root>/skills/<skill>/SKILL.md
//   existing-plugin→ <root>/<plugin>/skills/<skill>/SKILL.md  (plugin.json must exist)
//   new-plugin     → <root>/<plugin>/.claude-plugin/plugin.json + skills/<skill>/SKILL.md
//
// Does NOT call the LLM — that's /api/skills/generate. This is the "empty
// scaffold" path. UI can chain to generate after create.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";

export type CreateSkillMode = "standalone" | "existing-plugin" | "new-plugin";

export interface CreateSkillRequestBody {
  mode: CreateSkillMode;
  skillName: string;
  description?: string;
  pluginName?: string;
}

export interface CreateSkillResponse {
  ok: true;
  mode: CreateSkillMode;
  skillName: string;
  pluginName: string | null;
  skillPath: string;
  skillMdPath: string;
  manifestPath: string | null;
}

const KEBAB = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(res, { ok: false, code, error: message }, status);
}

function validateKebab(value: string | undefined, field: string): string | null {
  if (typeof value !== "string" || !KEBAB.test(value)) {
    return `${field} must be kebab-case (lowercase letters, digits, hyphens; 2-64 chars)`;
  }
  return null;
}

function skillMdScaffold(skillName: string, description: string): string {
  return [
    "---",
    `description: ${description}`,
    "---",
    "",
    `# ${skillName}`,
    "",
    "[Describe when Claude should invoke this skill and what it does.]",
    "",
  ].join("\n");
}

function pluginJsonScaffold(pluginName: string, description: string): string {
  return (
    JSON.stringify(
      {
        name: pluginName,
        version: "0.1.0",
        description,
      },
      null,
      2,
    ) + "\n"
  );
}

export function makeCreateSkillHandler(root: string) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Partial<CreateSkillRequestBody>;
    try {
      body = (await readBody(req)) as Partial<CreateSkillRequestBody>;
    } catch {
      return sendError(res, 400, "invalid-json", "Malformed JSON body");
    }

    const mode = body.mode;
    if (mode !== "standalone" && mode !== "existing-plugin" && mode !== "new-plugin") {
      return sendError(res, 400, "invalid-mode", "mode must be 'standalone', 'existing-plugin', or 'new-plugin'");
    }

    const skillNameErr = validateKebab(body.skillName, "skillName");
    if (skillNameErr) return sendError(res, 400, "invalid-skill-name", skillNameErr);
    const skillName = body.skillName!;
    const description = (body.description ?? "").trim() || `Skill: ${skillName}`;

    let pluginName: string | null = null;
    if (mode === "existing-plugin" || mode === "new-plugin") {
      const pluginNameErr = validateKebab(body.pluginName, "pluginName");
      if (pluginNameErr) return sendError(res, 400, "invalid-plugin-name", pluginNameErr);
      pluginName = body.pluginName!;
    }

    // Resolve destination + preflight checks
    let skillDir: string;
    let manifestPath: string | null = null;

    if (mode === "standalone") {
      skillDir = join(root, "skills", skillName);
    } else {
      // plugin-scoped
      const pluginDir = join(root, pluginName!);
      manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
      skillDir = join(pluginDir, "skills", skillName);

      if (mode === "existing-plugin") {
        if (!existsSync(manifestPath)) {
          return sendError(
            res,
            404,
            "plugin-not-found",
            `Plugin '${pluginName}' not found: ${manifestPath} does not exist`,
          );
        }
      } else {
        // new-plugin: must NOT already exist
        if (existsSync(pluginDir)) {
          return sendError(
            res,
            409,
            "plugin-exists",
            `Plugin directory already exists: ${pluginDir}`,
          );
        }
      }
    }

    if (existsSync(skillDir)) {
      return sendError(
        res,
        409,
        "skill-exists",
        `Skill directory already exists: ${skillDir}`,
      );
    }

    // Write files
    try {
      mkdirSync(skillDir, { recursive: true });
      const skillMdPath = join(skillDir, "SKILL.md");
      writeFileSync(skillMdPath, skillMdScaffold(skillName, description), "utf8");

      if (mode === "new-plugin" && manifestPath) {
        mkdirSync(join(root, pluginName!, ".claude-plugin"), { recursive: true });
        writeFileSync(manifestPath, pluginJsonScaffold(pluginName!, description), "utf8");
      }

      const response: CreateSkillResponse = {
        ok: true,
        mode,
        skillName,
        pluginName,
        skillPath: skillDir,
        skillMdPath,
        manifestPath: mode === "new-plugin" ? manifestPath : null,
      };
      sendJson(res, response, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(res, 500, "write-failed", `Failed to create skill: ${message}`);
    }
  };
}

export function registerAuthoringRoutes(router: Router, root: string): void {
  const handler = makeCreateSkillHandler(root);
  router.post("/api/authoring/create-skill", (req, res) => handler(req, res));

  // Helper endpoint: list authored plugins in the current root so the modal
  // can populate the "existing plugin" dropdown.
  router.get("/api/authoring/plugins", (_req, res) => {
    const found: Array<{ name: string; path: string; manifestPath: string }> = [];
    try {
      // Shallow walk — depth 4 matches scanAuthoredPluginSkills default.
      const MAX_DEPTH = 4;
      const EXCLUDE = new Set([
        "node_modules",
        ".git",
        "dist",
        "build",
        ".next",
        ".turbo",
        ".vercel",
        "coverage",
        ".specweave",
      ]);

      function walk(dir: string, depth: number): void {
        const manifest = join(dir, ".claude-plugin", "plugin.json");
        if (existsSync(manifest)) {
          const parts = dir.split(/[\\/]/);
          found.push({
            name: parts[parts.length - 1] ?? dir,
            path: dir,
            manifestPath: manifest,
          });
          return; // don't descend into plugin sources
        }
        if (depth >= MAX_DEPTH) return;
        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          return;
        }
        for (const name of entries) {
          if (EXCLUDE.has(name)) continue;
          if (name.startsWith(".") && name !== ".claude-plugin") continue;
          const child = join(dir, name);
          try {
            if (!statSync(child).isDirectory()) continue;
          } catch {
            continue;
          }
          walk(child, depth + 1);
        }
      }

      walk(root, 0);
    } catch {
      /* return whatever we have */
    }
    sendJson(res, { plugins: found }, 200);
  });
}
