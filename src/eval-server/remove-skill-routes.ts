// 0850 — POST /api/studio/remove-skill
//
// Per-agent skill removal for the InstallTargetsModal. Mirrors the security
// posture of install-skill-routes.ts: localhost-only, SAFE_NAME validation
// on the skill identifier, SAFE_AGENT_ID validation on every agentId.
//
// Endpoint:
//   POST /api/studio/remove-skill
//   Body: { skill: string, agentIds: string[], scope: "project" | "user" }
//   → 200 { removed: [{agentId, path}], skipped: [{agentId, reason}], errors: [{agentId, message}] }

import * as http from "node:http";
import { existsSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { isLocalhost } from "./install-jobs.js";
import { getAgent } from "../agents/agents-registry.js";
import { resolveAgentSkillsDir } from "../installer/canonical.js";
import {
  readLockfile,
  removeSkillFromLock,
  writeLockfile,
} from "../lockfile/lockfile.js";

const SAFE_NAME = /^[a-zA-Z0-9._@/\-]+$/;
const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]*$/;
const VALID_SCOPES: ReadonlySet<string> = new Set(["project", "user"]);

type RemoveScope = "project" | "user";

interface RemovedRow { agentId: string; path: string }
interface SkippedRow { agentId: string; reason: string }
interface ErrorRow   { agentId: string; message: string }

interface RemoveResponse {
  skill: string;
  scope: RemoveScope;
  removed: RemovedRow[];
  skipped: SkippedRow[];
  errors:  ErrorRow[];
}

function lastSegment(name: string): string {
  const idx = name.lastIndexOf("/");
  return idx === -1 ? name : name.slice(idx + 1);
}

function userLockDir(): string {
  return join(homedir(), ".agents");
}

function validateAgentIds(ids: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(ids)) return { ok: false, error: "agentIds must be an array" };
  if (ids.length === 0) return { ok: false, error: "agentIds[] cannot be empty" };
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string") return { ok: false, error: "agentIds[] entries must be strings" };
    const id = raw.trim();
    if (!SAFE_AGENT_ID.test(id)) return { ok: false, error: `invalid agentId: ${raw}` };
    if (!getAgent(id)) return { ok: false, error: `unknown agentId: ${id}` };
    out.push(id);
  }
  return { ok: true, ids: out };
}

export function registerRemoveSkillRoutes(router: Router, rootArg: string | (() => string) = () => process.cwd()): void {
  const getRoot = typeof rootArg === "function" ? rootArg : () => rootArg;
  router.post(
    "/api/studio/remove-skill",
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const root = getRoot();
      if (!isLocalhost(req)) {
        sendJson(res, { error: "localhost-only endpoint" }, 403, req);
        return;
      }
      const body = (await readBody(req)) as {
        skill?: string;
        scope?: string;
        agentIds?: unknown;
      };
      const skill = typeof body?.skill === "string" ? body.skill.trim() : "";
      const scope = typeof body?.scope === "string" ? body.scope : "";
      if (!skill || skill.startsWith("-") || !SAFE_NAME.test(skill)) {
        sendJson(res, { error: "invalid skill identifier" }, 400, req);
        return;
      }
      if (!VALID_SCOPES.has(scope)) {
        sendJson(res, { error: "invalid scope (must be project|user)" }, 400, req);
        return;
      }
      const v = validateAgentIds(body.agentIds);
      if (!v.ok) {
        sendJson(res, { error: v.error }, 400, req);
        return;
      }

      const shortName = lastSegment(skill);
      const removed: RemovedRow[] = [];
      const skipped: SkippedRow[] = [];
      const errors:  ErrorRow[]   = [];

      for (const agentId of v.ids) {
        const agent = getAgent(agentId);
        if (!agent) {
          skipped.push({ agentId, reason: "unknown agent" });
          continue;
        }
        if (agent.installMode !== "filesystem") {
          skipped.push({ agentId, reason: "cloud agent — nothing to remove on disk" });
          continue;
        }
        try {
          const dir = resolveAgentSkillsDir(agent, { global: scope === "user", projectRoot: root });
          // Defense in depth: only remove a basename directory under the
          // resolved agent dir. agent.id and shortName are both validated.
          const target = join(dir, basename(shortName));
          if (!existsSync(target)) {
            skipped.push({ agentId, reason: `not installed at ${target}` });
            continue;
          }
          rmSync(target, { recursive: true, force: true });
          removed.push({ agentId, path: target });
        } catch (err) {
          errors.push({ agentId, message: err instanceof Error ? err.message : String(err) });
        }
      }

      // Lockfile cleanup. The 0850 contract: drop the skills[<name>] entry
      // for this scope when at least one agent was removed OR when every
      // agent we tried was "not installed on disk" (idempotent recovery
      // from a stale lockfile that survives a manual `rm`). We do NOT
      // prune the `agents` list — it tracks any agent ever installed against
      // in this dir and other skills may still depend on it.
      const isPurelyMissing =
        removed.length === 0 &&
        errors.length === 0 &&
        skipped.length > 0 &&
        skipped.every((s) => s.reason.startsWith("not installed"));
      if (removed.length > 0 || isPurelyMissing) {
        const lockDir = scope === "user" ? userLockDir() : root;
        // Match the install side: lockfile stores by skill.name which is
        // typically the last segment.
        const lock = readLockfile(lockDir);
        if (lock?.skills?.[shortName]) {
          removeSkillFromLock(shortName, lockDir);
        } else if (lock?.skills) {
          // Fall back: scan for a key that matches either full identifier
          // or the short name (defensive against earlier writers).
          const matchKey = Object.keys(lock.skills).find(
            (k) => k === shortName || k === skill || k.endsWith(`/${shortName}`),
          );
          if (matchKey) {
            delete lock.skills[matchKey];
            writeLockfile(lock, lockDir);
          }
        }
      }

      console.log("[remove-skill]", JSON.stringify({ skill, scope, removed: removed.length, skipped: skipped.length, errors: errors.length }));

      const response: RemoveResponse = {
        skill,
        scope: scope as RemoveScope,
        removed,
        skipped,
        errors,
      };
      sendJson(res, response, 200, req);
    },
  );
}

export const __test__ = {
  SAFE_NAME,
  SAFE_AGENT_ID,
  VALID_SCOPES,
  validateAgentIds,
  lastSegment,
};
