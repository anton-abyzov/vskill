import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Router } from "./router.js";
import { sendJson } from "./router.js";
import { resolveSkillDir } from "./skill-resolver.js";
import { parseSkillFrontmatter } from "./api-routes.js";
import { readFrontmatterVersion } from "../utils/version.js";
import { computeSkillDir, detectProjectGitHubStatus } from "./skill-create-routes.js";
import { readAuthoringEngine } from "./skill-authoring-engine.js";

/** Load authoring fields only for a skill inside the active workspace's layouts. */
export function registerSkillAuthoringRoute(router: Router, getRoot: () => string): void {
  router.get("/api/skills/:plugin/:skill/authoring", async (req, res, params) => {
    try {
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(params.skill) ||
        !/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(params.plugin)) {
        return sendJson(res, { error: "Invalid skill or plugin name" }, 400, req);
      }
      const root = getRoot();
      const dir = resolveSkillDir(root, params.plugin, params.skill);
      const layout = ([1, 2, 3] as const).find((candidate) =>
        resolve(computeSkillDir(root, candidate, params.plugin, params.skill)) === resolve(dir));
      if (!layout) return sendJson(res, { error: "Only workspace-authored skills can be updated here" }, 403, req);
      const file = join(dir, "SKILL.md");
      if (!existsSync(file)) return sendJson(res, { error: "Skill not found" }, 404, req);
      const location = relative(realpathSync(root), realpathSync(file));
      if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) {
        return sendJson(res, { error: "Only workspace-authored skills can be updated here" }, 403, req);
      }
      const nativeSkillMd = readFileSync(file, "utf8");
      const fm = parseSkillFrontmatter(nativeSkillMd.replace(/\r\n/g, "\n"));
      const engine = readAuthoringEngine(nativeSkillMd);
      const origin = detectProjectGitHubStatus(root).githubOrigin;
      const ownerRepo = origin?.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
      sendJson(res, {
        name: params.skill, plugin: layout === 3 ? "" : params.plugin, layout,
        description: typeof fm.description === "string" ? fm.description : "",
        model: typeof fm.model === "string" ? fm.model : "",
        allowedTools: Array.isArray(fm["allowed-tools"]) ? fm["allowed-tools"].join(", ") : fm["allowed-tools"] || "",
        body: nativeSkillMd.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/, "").replace(/^\r?\n/, ""),
        version: readFrontmatterVersion(nativeSkillMd) ?? "1.0.0", engine, nativeSkillMd,
        versionsHref: ownerRepo ? `https://verified-skill.com/skills/${ownerRepo}/${encodeURIComponent(params.skill)}/versions` : undefined,
      }, 200, req);
    } catch (error) {
      sendJson(res, { error: (error as Error).message }, 400, req);
    }
  });
}
