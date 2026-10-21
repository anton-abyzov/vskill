import { readFileSync } from "node:fs";
import type { Router } from "./router.js";
import { sendJson } from "./router.js";
import { AuthoringPathError, resolveAuthoringSkillPath } from "./skill-authoring-path.js";
import { parseSkillFrontmatter } from "./api-routes.js";
import { readFrontmatterVersion } from "../utils/version.js";
import { detectProjectGitHubStatus } from "./skill-create-routes.js";
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
      const { file, layout } = resolveAuthoringSkillPath(root, params.plugin, params.skill);
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
      sendJson(res, { error: (error as Error).message }, error instanceof AuthoringPathError ? error.status : 400, req);
    }
  });
}
