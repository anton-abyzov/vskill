// ---------------------------------------------------------------------------
// sweep-routes.ts -- SSE endpoints for multi-model sweep and leaderboard
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { initSSE, sendSSE, sendSSEDone } from "./sse-helpers.js";
import { resolveSkillDir } from "./skill-resolver.js";
import { loadAndValidateEvals } from "../eval/schema.js";
import { buildEvalSystemPrompt } from "../eval/prompt-builder.js";
import { runSweep, listLeaderboard, readLeaderboardEntry } from "./sweep-runner.js";
import type { SweepOpts } from "./sweep-runner.js";

export function registerSweepRoutes(router: Router, root: string): void {
  // POST /api/skills/:plugin/:skill/sweep — run multi-model sweep (SSE)
  router.post("/api/skills/:plugin/:skill/sweep", async (req, res, params) => {
    const body = (await readBody(req)) as {
      models?: string[];
      judge?: string;
      runs?: number;
      concurrency?: number;
      baseline?: boolean;
    };

    if (!body.models || !Array.isArray(body.models) || body.models.length === 0) {
      sendJson(res, { error: "models array is required and must not be empty" }, 400, req);
      return;
    }
    if (!body.judge || typeof body.judge !== "string") {
      sendJson(res, { error: "judge model spec is required (e.g., 'anthropic/claude-sonnet-4')" }, 400, req);
      return;
    }

    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    if (!skillDir) {
      sendJson(res, { error: "Skill not found" }, 404, req);
      return;
    }

    let evalsFile;
    try {
      evalsFile = loadAndValidateEvals(skillDir);
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 400, req);
      return;
    }

    const skillMdPath = join(skillDir, "SKILL.md");
    const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
    const systemPrompt = buildEvalSystemPrompt(skillContent);
    const evalCases = evalsFile.evals;

    initSSE(res, req);

    let aborted = false;
    req.on("close", () => { aborted = true; });

    const sweepOpts: SweepOpts = {
      skillDir,
      skillName: `${params.plugin}/${params.skill}`,
      systemPrompt,
      evalCases,
      models: body.models,
      judge: body.judge,
      runs: body.runs ?? 1,
      concurrency: body.concurrency ?? 5,
      baseline: body.baseline,
    };

    try {
      for await (const event of runSweep(sweepOpts)) {
        if (aborted) break;
        sendSSE(res, event.type, event.data);
      }
    } catch (err) {
      sendSSE(res, "error", { message: (err as Error).message });
    }

    if (!aborted) {
      res.end();
    }
  });

  // GET /api/skills/:plugin/:skill/leaderboard — list sweep results
  router.get("/api/skills/:plugin/:skill/leaderboard", async (_req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    if (!skillDir) {
      sendJson(res, { entries: [] });
      return;
    }

    const entries = await listLeaderboard(skillDir);
    sendJson(res, { entries });
  });

  // GET /api/skills/:plugin/:skill/leaderboard/:timestamp — single sweep result
  router.get("/api/skills/:plugin/:skill/leaderboard/:timestamp", async (_req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    if (!skillDir) {
      sendJson(res, { error: "Skill not found" }, 404);
      return;
    }

    const entry = await readLeaderboardEntry(skillDir, params.timestamp);
    if (!entry) {
      sendJson(res, { error: "Leaderboard entry not found" }, 404);
      return;
    }
    sendJson(res, entry);
  });
}
