// ---------------------------------------------------------------------------
// skill-update-routes.ts -- installed-skill update routes, split out of
// api-routes.ts (1126) so that file stops growing.
//
//   GET  /api/skills/updates                   outdated list (502 on failure)
//   POST /api/skills/:plugin/:skill/update     SSE, one skill
//   POST /api/skills/batch-update              SSE, many skills
//
// 1126 fixes:
//   P0-1  `done` carries status done|skipped|error, the new version, and the
//         error text is sent in the preceding `error` event.
//   P0-2  batch emits skill:start / skill:done / skill:skipped / skill:error
//         and real updated/failed/skipped counts.
//   P1-4  pinned skills are reported as skipped, not "Updated".
//   P1-5  the bundled CLI runs asynchronously (vskill-cli-runner.ts).
//   P1-6  the outdated list returns 502 with a message instead of [].
//   P2-7  the outdated list reads the Studio root's lock, not process.cwd().
//
// Registered from registerRoutes() at the same position as before, ahead of
// the /api/skills/:plugin/:skill catch-all.
// ---------------------------------------------------------------------------

import type * as http from "node:http";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { initSSE, sendSSE, sendSSEDone } from "./sse-helpers.js";
import { AGENTS_REGISTRY } from "../agents/agents-registry.js";
import { pickHighestPrecedenceLocation } from "./utils/scan-install-locations.js";
import { runVskill, classifyUpdateRun, type UpdateRunOutcome } from "./vskill-cli-runner.js";
import { findSkillLockEntry } from "./skill-lock-lookup.js";

const SKILL_SLUG_RE = /^[a-zA-Z0-9._/-]+$/;

/** Accepts leaf or owner/repo/skill names; rejects anything Commander could read as a flag. */
export function isSafeSkillName(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.length > 0 &&
    s.length <= 200 &&
    !s.startsWith("-") &&
    !s.includes("..") &&
    SKILL_SLUG_RE.test(s)
  );
}

export interface SkillUpdateResult extends UpdateRunOutcome {
  skill: string;
  fromVersion?: string;
  version?: string;
}

/**
 * Update one installed skill with the bundled CLI and report what really
 * happened. A pinned lock entry is skipped without running the CLI.
 */
export async function updateOneSkill(
  root: string,
  name: string,
  agentId: string | null,
): Promise<SkillUpdateResult> {
  const before = findSkillLockEntry(root, name);
  if (before?.entry.pinnedVersion) {
    return {
      skill: name,
      status: "skipped",
      reason: "pinned",
      pinnedVersion: before.entry.pinnedVersion,
      message: `Pinned at ${before.entry.pinnedVersion}; unpin it to update.`,
      fromVersion: before.entry.version,
      version: before.entry.version,
    };
  }
  // Use the lock key the CLI knows (bare leaf), and --global when the entry
  // only exists in the user-level lock: from a project with its own (even
  // empty) vskill.lock the CLI would otherwise look there and do nothing.
  const args = ["update", before?.lockName ?? name];
  if (before?.scope === "global") args.push("--global");
  if (agentId) args.push("--agent", agentId);
  // 0765: cwd is the Studio root so the CLI's lock lookup and its SKILL.md
  // sync land in the tree Studio shows.
  const run = await runVskill(args, { cwd: root, timeoutMs: 120_000 });
  const outcome = classifyUpdateRun(run);
  const after = findSkillLockEntry(root, name);
  return {
    skill: name,
    ...outcome,
    ...(before ? { fromVersion: before.entry.version } : {}),
    ...(after?.entry.version || outcome.toVersion
      ? { version: after?.entry.version ?? outcome.toVersion }
      : {}),
  };
}

function parseAgentParam(req: http.IncomingMessage): { agentId: string | null; error?: string } {
  try {
    const url = new URL((req as { url?: string }).url ?? "", "http://localhost");
    const raw = url.searchParams.get("agent");
    if (raw === null) return { agentId: null };
    if (!AGENTS_REGISTRY.some((a) => a.id === raw)) return { agentId: null, error: `Unknown agent id: ${raw}` };
    return { agentId: raw };
  } catch {
    return { agentId: null };
  }
}

export function registerSkillUpdateRoutes(router: Router, getRoot: () => string): void {
  // 0740: the outdated helper runs in-process (no PATH vskill). 0747 adds
  // installLocations / localPlugin / localSkill per row.
  router.get("/api/skills/updates", async (req, res) => {
    const root = getRoot();
    try {
      const { getOutdatedJson } = await import("../commands/outdated.js");
      const { scanSkillInstallLocations } = await import("./utils/scan-install-locations.js");
      const programmatic = await getOutdatedJson({ root });
      if (!programmatic) {
        sendJson(res, [], 200, req);
        return;
      }
      // 0747 F-004: scan each unique name once per request.
      const scanCache = new Map<string, ReturnType<typeof scanSkillInstallLocations>>();
      const scanOnce = (name: string) => {
        const hit = scanCache.get(name);
        if (hit !== undefined) return hit;
        const fresh = scanSkillInstallLocations(name, root);
        scanCache.set(name, fresh);
        return fresh;
      };
      const enriched = programmatic.results.map((r) => {
        const locations = scanOnce(r.name);
        const localSkill = r.name.split("/").pop();
        const winner = pickHighestPrecedenceLocation(locations);
        return {
          ...r,
          ...(programmatic.pinMap.has(r.name)
            ? { pinned: true, pinnedVersion: programmatic.pinMap.get(r.name) }
            : {}),
          installLocations: locations,
          localSkill,
          ...(winner?.pluginSlug ? { localPlugin: winner.pluginSlug } : {}),
        };
      });
      sendJson(res, enriched, 200, req);
    } catch (err) {
      // 1126 P1-6: a registry outage or rate limit is not "no updates".
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: `Couldn't check for updates: ${message}` }, 502, req);
    }
  });

  router.post("/api/skills/:plugin/:skill/update", async (req, res, params) => {
    const root = getRoot();
    initSSE(res, req);
    const skillName = params.skill;

    // 0747 F-002: never let a malformed slug reach Commander as a flag.
    if (!isSafeSkillName(skillName)) {
      sendSSE(res, "error", { error: `Invalid skill name: ${skillName}`, skill: skillName });
      sendSSEDone(res, { status: "error", skill: skillName, error: `Invalid skill name: ${skillName}` });
      return;
    }
    const { agentId, error: agentError } = parseAgentParam(req);
    if (agentError) {
      sendSSE(res, "error", { error: agentError, skill: skillName });
      sendSSEDone(res, { status: "error", skill: skillName, error: agentError });
      return;
    }
    const agentField = agentId ? { agent: agentId } : {};

    sendSSE(res, "progress", { status: "updating", skill: skillName, ...agentField });
    let result: SkillUpdateResult;
    try {
      result = await updateOneSkill(root, skillName, agentId);
    } catch (err) {
      result = { skill: skillName, status: "error", message: (err as Error).message };
    }
    const doneFields = {
      status: result.status,
      skill: skillName,
      ...agentField,
      ...(result.version ? { version: result.version } : {}),
      ...(result.fromVersion ? { fromVersion: result.fromVersion } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.pinnedVersion ? { pinnedVersion: result.pinnedVersion } : {}),
      ...(result.message ? { message: result.message } : {}),
    };
    if (result.status === "error") {
      const error = result.message ?? "Update failed";
      sendSSE(res, "error", { error, skill: skillName, ...agentField });
      sendSSEDone(res, { ...doneFields, error });
      return;
    }
    sendSSE(res, "progress", { ...doneFields });
    sendSSEDone(res, doneFields);
  });

  // T-012: batch update over SSE, one at a time, 409 while one is running.
  let batchUpdateInProgress = false;

  router.post("/api/skills/batch-update", async (req, res) => {
    const root = getRoot();
    if (batchUpdateInProgress) {
      sendJson(res, { error: "Update already in progress" }, 409, req);
      return;
    }
    batchUpdateInProgress = true;

    try {
      const body = ((await readBody(req)) ?? {}) as { skills?: unknown };
      const skills = Array.isArray(body.skills) ? body.skills : [];

      initSSE(res, req);
      let updated = 0;
      let failed = 0;
      let skipped = 0;

      for (const raw of skills) {
        const skill = typeof raw === "string" ? raw : String(raw);
        sendSSE(res, "skill:start", { skill });
        if (!isSafeSkillName(skill)) {
          sendSSE(res, "skill:error", { skill, error: `Invalid skill name: ${skill}` });
          failed++;
          continue;
        }
        let result: SkillUpdateResult;
        try {
          result = await updateOneSkill(root, skill, null);
        } catch (err) {
          result = { skill, status: "error", message: (err as Error).message };
        }
        if (result.status === "done") {
          sendSSE(res, "skill:done", {
            skill,
            ...(result.version ? { version: result.version } : {}),
            ...(result.fromVersion ? { fromVersion: result.fromVersion } : {}),
            ...(result.reason ? { reason: result.reason } : {}),
          });
          updated++;
        } else if (result.status === "skipped") {
          sendSSE(res, "skill:skipped", {
            skill,
            reason: result.reason,
            ...(result.pinnedVersion ? { pinnedVersion: result.pinnedVersion } : {}),
            message: result.message,
          });
          skipped++;
        } else {
          sendSSE(res, "skill:error", { skill, error: result.message ?? "Update failed" });
          failed++;
        }
      }
      sendSSEDone(res, { updated, failed, skipped });
    } finally {
      batchUpdateInProgress = false;
    }
  });
}
