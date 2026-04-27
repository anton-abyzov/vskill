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
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
  readdirSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { validateClaudePlugin } from "../core/plugin-validator.js";

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
  extra?: Record<string, unknown>,
): void {
  sendJson(res, { ok: false, code, error: message, ...(extra ?? {}) }, status);
}

// Exported so the CLI (`vskill plugin new`) can reuse the same kebab rule
// without duplicating the regex / error message.
export function validateKebabName(
  value: string | undefined,
  field: string,
): string | null {
  if (typeof value !== "string" || !KEBAB.test(value)) {
    return `${field} must be kebab-case (lowercase letters, digits, hyphens; 2-64 chars)`;
  }
  return null;
}

function validateKebab(value: string | undefined, field: string): string | null {
  return validateKebabName(value, field);
}

// Exported so `vskill plugin new --with-skill <name>` reuses the same stub.
// 0793 T-002.
export function skillMdScaffold(skillName: string, description: string): string {
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

// Exported so both `vskill plugin new` (CLI) and the convert-to-plugin
// endpoint can reuse the single source of truth for plugin.json content.
// 0793 T-001.
export function pluginJsonScaffold(pluginName: string, description: string): string {
  // 0703 follow-up + 0793 T-001 fix: align with
  // https://code.claude.com/docs/en/plugins-reference. `name` is the only
  // required field. `version` is intentionally omitted so Claude Code falls
  // back to the git SHA — docs explicitly warn that a fixed `version: "0.1.0"`
  // is a footgun (users stop receiving updates unless the author remembers to
  // bump it).
  //
  // `author` is OMITTED from the scaffold (was previously stubbed as
  // `{ name: "" }`, but `claude plugin validate` rejects empty author.name
  // with "Author name cannot be empty"). Claude Code falls back gracefully
  // when `author` is absent. Authors can add the field manually when ready
  // to publish.
  return (
    JSON.stringify(
      {
        name: pluginName,
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

// ---------------------------------------------------------------------------
// 0703 hotfix — GET /api/authoring/skill-exists
//
// Pre-flight probe used by CreateSkillModal before it redirects to the
// generator. Mirrors the validation + skillDir resolution from the POST
// handler but NEVER writes; just returns { exists, path }. Returns 400 on
// invalid input, 404 when existing-plugin mode targets a missing plugin.
// ---------------------------------------------------------------------------
export function makeSkillExistsHandler(root: string) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const mode = url.searchParams.get("mode");
    const skillName = url.searchParams.get("skillName") ?? undefined;
    const pluginName = url.searchParams.get("pluginName") ?? undefined;

    if (mode !== "standalone" && mode !== "existing-plugin" && mode !== "new-plugin") {
      return sendError(res, 400, "invalid-mode", "mode must be 'standalone', 'existing-plugin', or 'new-plugin'");
    }

    const skillErr = validateKebab(skillName, "skillName");
    if (skillErr) return sendError(res, 400, "invalid-skill-name", skillErr);

    let skillDir: string;
    if (mode === "standalone") {
      skillDir = join(root, "skills", skillName!);
    } else {
      // Both "existing-plugin" and "new-plugin" share pluginName validation +
      // pluginDir/skillDir derivation. The branches differ only in whether the
      // plugin manifest must already exist:
      //   - existing-plugin → manifest MUST exist (404 if missing)
      //   - new-plugin     → manifest may NOT exist yet (probe just checks
      //                       whether <pluginDir>/skills/<skillName> is taken)
      // The "new-plugin" path has no explicit branch below — it simply skips
      // the manifest-presence check and proceeds to the shared skillDir
      // derivation. Intentional, not a silent fallthrough.
      const pluginErr = validateKebab(pluginName, "pluginName");
      if (pluginErr) return sendError(res, 400, "invalid-plugin-name", pluginErr);
      const pluginDir = join(root, pluginName!);
      if (mode === "existing-plugin") {
        const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
        if (!existsSync(manifestPath)) {
          return sendError(
            res,
            404,
            "plugin-not-found",
            `Plugin '${pluginName}' not found: ${manifestPath} does not exist`,
          );
        }
      }
      skillDir = join(pluginDir, "skills", skillName!);
    }

    // TOCTOU note: this probe + the subsequent POST /create-skill is a
    // check-then-act that is technically race-prone. Acceptable for a
    // single-user local Studio process — if a concurrent writer creates the
    // dir between probe and POST, the POST handler's own collision check is
    // the authoritative gate (returns 409). No multi-tenant exposure.
    sendJson(res, { exists: existsSync(skillDir), path: skillDir }, 200);
  };
}

// ---------------------------------------------------------------------------
// 0793 T-004 — POST /api/authoring/convert-to-plugin
//
// Promotes a folder of standalone authored skills into a real plugin by
// writing `<pluginDir>/.claude-plugin/plugin.json`. Validates the manifest
// post-write via `claude plugin validate <pluginDir>`; on validator failure
// the manifest is unlinked and the validator's stderr is returned in 422.
//
// This endpoint resolves the URL/sidebar inconsistency reported in 0793: the
// hash route already nests skills under `<dir>/<skill>` but the sidebar
// flattens them because there's no manifest. After this call returns 200 the
// next /api/skills fetch flips the affected skills' scopeV2 from
// "authoring-project" to "authoring-plugin" via the existing dedupeByDir
// precedence (skill-scanner.ts ~205).
//
// body: { anchorSkillDir, pluginName, description }
//   anchorSkillDir — absolute path of any skill in the candidate group
//                    (server derives pluginDir = dirname(dirname(anchorSkillDir)))
//   pluginName     — kebab-case (1-64 chars), written as `name` in plugin.json
//   description    — free-form, written into plugin.json
// 200: { ok: true, pluginDir, manifestPath, validation: 'passed' | 'skipped' }
// 400: outside-workspace anchor | bad name | no skills/*/SKILL.md present
// 409: manifest already exists at <pluginDir>/.claude-plugin/plugin.json
// 422: claude plugin validate failed; manifest is unlinked; body has stderr
// ---------------------------------------------------------------------------

interface ConvertToPluginRequestBody {
  anchorSkillDir: string;
  pluginName: string;
  description?: string;
}

function isInsideRoot(rootDir: string, absPath: string): boolean {
  const resolvedRoot = resolve(rootDir);
  const resolvedPath = resolve(absPath);
  return (
    resolvedPath === resolvedRoot ||
    resolvedPath.startsWith(resolvedRoot + sep)
  );
}

/**
 * Returns true iff `<pluginDir>/skills/<x>/SKILL.md` exists for at least one
 * `<x>`. Distinguishes a genuinely missing/empty `skills/` (return false) from
 * an unreadable one (rethrow): a permission error must NOT silently masquerade
 * as "no skills here" because the convert-to-plugin endpoint would surface
 * that as a misleading 400 "no-skills-to-convert".
 *
 * Throws on any non-ENOENT readdir error so the caller can return a 500.
 */
function hasAnyAuthoredSkill(pluginDir: string): boolean {
  const skillsRoot = join(pluginDir, "skills");
  let entries: string[];
  try {
    entries = readdirSync(skillsRoot);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw err;
  }
  for (const entry of entries) {
    const skillMd = join(skillsRoot, entry, "SKILL.md");
    try {
      if (statSync(skillMd).isFile()) return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      // ENOENT means this child doesn't have a SKILL.md (fine — keep scanning).
      // Anything else (EACCES/EPERM/EIO) is unexpected — let it bubble up.
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
    }
  }
  return false;
}

export function makeConvertToPluginHandler(root: string) {
  return async function handler(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let body: Partial<ConvertToPluginRequestBody>;
    try {
      body = (await readBody(req)) as Partial<ConvertToPluginRequestBody>;
    } catch {
      return sendError(res, 400, "invalid-json", "Malformed JSON body");
    }

    const nameErr = validateKebab(body.pluginName, "pluginName");
    if (nameErr) return sendError(res, 400, "invalid-plugin-name", nameErr);
    const pluginName = body.pluginName!;

    if (typeof body.anchorSkillDir !== "string" || body.anchorSkillDir.length === 0) {
      return sendError(
        res,
        400,
        "invalid-anchor",
        "anchorSkillDir must be an absolute path of an existing skill directory",
      );
    }
    // First-pass: lexical check on the user-supplied path. This catches the
    // common "outside-root" case (e.g. /tmp/elsewhere/skills/x) without an FS
    // round-trip and before exposing realpath behavior to untrusted input.
    const anchorLexical = resolve(body.anchorSkillDir);
    if (!isInsideRoot(root, anchorLexical)) {
      return sendError(
        res,
        400,
        "anchor-outside-root",
        "anchorSkillDir must be inside the workspace root",
      );
    }
    // F-004 (0793 review iteration 2): resolve symlinks and re-check the
    // workspace-root invariant. `resolve()` only normalizes path strings — a
    // symlink at <root>/inside/skills/<x> pointing to /etc/foo/skills/<x>
    // passes the lexical check above but writeFileSync would then follow the
    // link and write outside the workspace. realpathSync forces the anchor
    // to its canonical on-disk path. We realpath both sides so platform-
    // specific symlinks (macOS /tmp → /private/tmp, /var → /private/var) do
    // not produce false-positive "outside root" rejections when the workspace
    // root and anchor live on the same canonical mount.
    let anchorSkillDir: string;
    try {
      anchorSkillDir = realpathSync(anchorLexical);
    } catch {
      return sendError(
        res,
        400,
        "anchor-not-found",
        `anchorSkillDir does not exist: ${anchorLexical}`,
      );
    }
    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync(root);
    } catch {
      // Fall back to the lexical root — if the workspace root itself doesn't
      // exist on disk, downstream operations will fail anyway.
      canonicalRoot = resolve(root);
    }
    if (!isInsideRoot(canonicalRoot, anchorSkillDir)) {
      return sendError(
        res,
        400,
        "anchor-outside-root",
        "anchorSkillDir resolves (via symlink) to a path outside the workspace root",
      );
    }
    try {
      if (!statSync(anchorSkillDir).isDirectory()) {
        return sendError(
          res,
          400,
          "anchor-not-found",
          `anchorSkillDir is not a directory: ${anchorSkillDir}`,
        );
      }
    } catch {
      return sendError(
        res,
        400,
        "anchor-not-found",
        `anchorSkillDir does not exist: ${anchorSkillDir}`,
      );
    }

    // Plugin root = parent of `skills/<skill>` ⇒ dirname(dirname(anchor)).
    // Works for both top-level layout (<root>/skills/<s>/) where pluginDir == root,
    // and nested (<root>/<X>/skills/<s>/) where pluginDir == <root>/<X>.
    //
    // 0793 follow-up F-002: guard against a misbehaving client sending an
    // anchorSkillDir whose parent is NOT named `skills/`. Without this guard,
    // `<root>/foo/bar/baz` would resolve to pluginDir=<root>/foo and we would
    // either 400 with the wrong reason ("no skills here") or — worse — succeed
    // against an unrelated `<root>/foo/skills/...` that happens to exist.
    const anchorParent = basename(dirname(anchorSkillDir));
    if (anchorParent !== "skills") {
      return sendError(
        res,
        400,
        "invalid-anchor-shape",
        `anchorSkillDir must live under a 'skills/' directory (parent is '${anchorParent}')`,
      );
    }
    const pluginDir = resolve(anchorSkillDir, "..", "..");
    if (!isInsideRoot(canonicalRoot, pluginDir)) {
      return sendError(
        res,
        400,
        "plugin-dir-outside-root",
        "Resolved pluginDir is outside the workspace root",
      );
    }

    let hasSkill: boolean;
    try {
      hasSkill = hasAnyAuthoredSkill(pluginDir);
    } catch (err) {
      // 0793 follow-up: hasAnyAuthoredSkill now rethrows on non-ENOENT
      // readdir/stat errors (EACCES, EPERM, EIO, …) so the user sees a real
      // 500 instead of a misleading 400 "no-skills-to-convert".
      const message = err instanceof Error ? err.message : String(err);
      return sendError(
        res,
        500,
        "skills-scan-failed",
        `Failed to scan ${pluginDir}/skills/: ${message}`,
      );
    }
    if (!hasSkill) {
      return sendError(
        res,
        400,
        "no-skills-to-convert",
        `pluginDir has no skills/*/SKILL.md to associate with the new plugin: ${pluginDir}`,
      );
    }

    const manifestDir = join(pluginDir, ".claude-plugin");
    const manifestPath = join(manifestDir, "plugin.json");
    if (existsSync(manifestPath)) {
      return sendError(
        res,
        409,
        "plugin-already-exists",
        `Plugin manifest already exists: ${manifestPath}`,
      );
    }

    const description = (body.description ?? "").trim() || `Plugin: ${pluginName}`;

    try {
      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(manifestPath, pluginJsonScaffold(pluginName, description), "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return sendError(res, 500, "write-failed", `Failed to write manifest: ${message}`);
    }

    const validation = validateClaudePlugin(pluginDir);
    if (!validation.ok) {
      try {
        unlinkSync(manifestPath);
      } catch {
        /* best-effort rollback */
      }
      return sendError(
        res,
        422,
        "validation-failed",
        "claude plugin validate rejected the generated manifest",
        { stderr: validation.stderr },
      );
    }

    sendJson(
      res,
      {
        ok: true,
        pluginDir,
        manifestPath,
        validation: validation.skipped ? "skipped" : "passed",
      },
      200,
    );
  };
}

export function registerAuthoringRoutes(router: Router, root: string): void {
  const handler = makeCreateSkillHandler(root);
  router.post("/api/authoring/create-skill", (req, res) => handler(req, res));

  const convertHandler = makeConvertToPluginHandler(root);
  router.post("/api/authoring/convert-to-plugin", (req, res) => convertHandler(req, res));

  const existsHandler = makeSkillExistsHandler(root);
  router.get("/api/authoring/skill-exists", (req, res) => existsHandler(req, res));

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
