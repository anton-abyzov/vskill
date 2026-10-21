// 0850 — POST /api/studio/remove-skill
//
// Per-agent skill removal for the InstallTargetsModal. Mirrors the security
// posture of install-skill-routes.ts: localhost-only, SAFE_NAME validation
// on the skill identifier, SAFE_AGENT_ID validation on every agentId.
//
// Endpoint:
//   POST /api/studio/remove-skill
//   Body: { skill: string, agentIds: string[], scope: "project" | "user", all?: boolean }
//   all (0894): remove the skill for every agent in the scope — the shared
//   canonical copy, every agent's own link or copy, and the lockfile entry.
//   agentIds is optional then.
//   → 200 { removed: [{agentId, path}], skipped: [{agentId, reason}], errors: [{agentId, message}] }

import * as http from "node:http";
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { isLocalhost } from "./install-jobs.js";
import { getAgent, getInstallableAgents, type AgentDefinition } from "../agents/agents-registry.js";
import {
  isSatisfiedByCanonical,
  resolveAgentSkillsDir,
  resolveCanonicalSkillsDir,
  type InstallOptions,
} from "../installer/canonical.js";
import {
  readLockfile,
  removeSkillFromLock,
  writeLockfile,
} from "../lockfile/lockfile.js";

const SAFE_NAME = /^[a-zA-Z0-9._@/\-]+$/;

/** SAFE_NAME allows dots, so also refuse empty, `.` and `..` segments: the
 *  last segment becomes a folder name under the agent's skills dir, and
 *  `foo/..` would otherwise resolve to the skills dir's parent. */
function isSafeSkillId(skill: string): boolean {
  if (!skill || skill.startsWith("-") || !SAFE_NAME.test(skill)) return false;
  return skill.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]*$/;
const VALID_SCOPES: ReadonlySet<string> = new Set(["project", "user"]);

type RemoveScope = "project" | "user";

interface RemovedRow { agentId: string; path: string }
interface SkippedRow {
  agentId: string;
  reason: string;
  /** 0894: other agents that still load the shared copy, when the remove
   *  was refused because the skill lives in the shared `.agents/skills`. */
  sharedWith?: string[];
}
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
        all?: unknown;
      };
      const all = body?.all === true;
      const skill = typeof body?.skill === "string" ? body.skill.trim() : "";
      const scope = typeof body?.scope === "string" ? body.scope : "";
      if (!isSafeSkillId(skill)) {
        sendJson(res, { error: "invalid skill identifier" }, 400, req);
        return;
      }
      if (!VALID_SCOPES.has(scope)) {
        sendJson(res, { error: "invalid scope (must be project|user)" }, 400, req);
        return;
      }
      const v = all && (body.agentIds === undefined || (Array.isArray(body.agentIds) && body.agentIds.length === 0))
        ? ({ ok: true, ids: [] as string[] } as const)
        : validateAgentIds(body.agentIds);
      if (!v.ok) {
        sendJson(res, { error: v.error }, 400, req);
        return;
      }

      const shortName = lastSegment(skill);
      const slug = basename(shortName);
      const removed: RemovedRow[] = [];
      const skipped: SkippedRow[] = [];
      const errors:  ErrorRow[]   = [];

      const installOpts: InstallOptions = { global: scope === "user", projectRoot: root };
      const lockDir = scope === "user" ? userLockDir() : root;
      const requested = new Set(v.ids);
      const canonicalTarget = join(resolveCanonicalSkillsDir(installOpts), slug);
      // 0894: agents in this request that load the skill from the shared
      // canonical folder. That folder is deleted once, after the per-agent
      // pass, and only when no other agent still loads it.
      const canonicalAgents: string[] = [];

      if (all) {
        removeEverywhere(slug, installOpts, canonicalTarget, requested, readLockfile(lockDir)?.agents ?? [], removed, errors);
      } else {
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
            // Defense in depth: only remove a basename directory under the
            // resolved agent dir. agent.id and shortName are both validated.
            const own = join(resolveAgentSkillsDir(agent, installOpts), slug);
            const readsCanonical = isSatisfiedByCanonical(agent, installOpts) || own === canonicalTarget;
            if (readsCanonical) {
              // A shared reader stops loading the skill only when the canonical
              // copy goes; an old per-agent link of its own is cleaned up with it.
              canonicalAgents.push(agentId);
              continue;
            }
            if (!lexists(own)) {
              skipped.push({ agentId, reason: `not installed at ${own}` });
              continue;
            }
            removeEntry(own);
            removed.push({ agentId, path: own });
          } catch (err) {
            errors.push({ agentId, message: err instanceof Error ? err.message : String(err) });
          }
        }

        if (canonicalAgents.length > 0) {
          const canonicalPresent = lexists(canonicalTarget);
          const users = canonicalUsers(canonicalTarget, slug, installOpts, requested, readLockfile(lockDir)?.agents ?? []);
          for (const agentId of canonicalAgents) {
            const agent = getAgent(agentId)!;
            try {
              const own = join(resolveAgentSkillsDir(agent, installOpts), slug);
              const hasOwn = own !== canonicalTarget && lexists(own);
              if (!hasOwn && !canonicalPresent) {
                skipped.push({ agentId, reason: `not installed at ${canonicalTarget}` });
                continue;
              }
              if (users.length > 0) {
                skipped.push({
                  agentId,
                  reason: `shared: ${canonicalTarget} is still used by ${users.join(", ")}`,
                  sharedWith: users,
                });
                continue;
              }
              if (hasOwn) {
                removeEntry(own);
                removed.push({ agentId, path: own });
              }
              if (canonicalPresent) {
                if (lexists(canonicalTarget)) removeEntry(canonicalTarget);
                removed.push({ agentId, path: canonicalTarget });
              }
            } catch (err) {
              errors.push({ agentId, message: err instanceof Error ? err.message : String(err) });
            }
          }
        }
      }

      // Lockfile cleanup. The 0850 contract: drop the skills[<name>] entry
      // for this scope when at least one agent was removed OR when every
      // agent we tried was "not installed on disk" (idempotent recovery
      // from a stale lockfile that survives a manual `rm`). We do NOT
      // prune the `agents` list — it tracks any agent ever installed against
      // in this dir and other skills may still depend on it. (0894: agents
      // left with no skill at all in this scope are pruned below.)
      const isPurelyMissing =
        removed.length === 0 &&
        errors.length === 0 &&
        skipped.length > 0 &&
        skipped.every((s) => s.reason.startsWith("not installed"));
      // 0894: keep the entry while any agent in this scope still has the skill.
      if ((removed.length > 0 || isPurelyMissing) && !installedAnywhere(slug, installOpts)) {
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

      // 0894: an agent this request touched that no longer has any skill in
      // the scope leaves the lockfile's `agents` list, so a stale entry
      // does not keep counting as a user of the shared folder.
      if (removed.length > 0) {
        pruneLockAgents(lockDir, installOpts, new Set([...requested, ...removed.map((r) => r.agentId)]));
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

function lexists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/** Remove a link itself (never what it points to) or a real folder. */
function removeEntry(p: string): void {
  if (lstatSync(p).isSymbolicLink()) unlinkSync(p);
  else rmSync(p, { recursive: true, force: true });
}

function filesystemAgents(): AgentDefinition[] {
  return getInstallableAgents().filter((a) => (a.installMode ?? "filesystem") === "filesystem");
}

/**
 * 0894: agents outside the request that still load `canonicalTarget`: a link
 * of theirs resolves into it, or they read the shared folder in this scope
 * and the scope's lockfile lists them as installed.
 */
function canonicalUsers(
  canonicalTarget: string,
  slug: string,
  opts: InstallOptions,
  requested: ReadonlySet<string>,
  lockAgents: readonly string[],
): string[] {
  const canonicalReal = safeRealpath(canonicalTarget);
  const users: string[] = [];
  for (const agent of filesystemAgents()) {
    if (requested.has(agent.id)) continue;
    let own: string;
    try {
      own = join(resolveAgentSkillsDir(agent, opts), slug);
    } catch {
      continue;
    }
    let linked = false;
    if (own !== canonicalTarget && canonicalReal) {
      try {
        linked = lstatSync(own).isSymbolicLink() && safeRealpath(own) === canonicalReal;
      } catch {
        linked = false;
      }
    }
    const shared =
      (isSatisfiedByCanonical(agent, opts) || own === canonicalTarget) && lockAgents.includes(agent.id);
    if (linked || shared) users.push(agent.id);
  }
  return users;
}

/**
 * 0894: `all: true` — remove the skill for every agent in the scope: each
 * agent's own entry (link or copy) and the shared canonical copy. The
 * canonical row is credited to the requested agents plus every shared reader
 * the lockfile lists, or to "all" when there are none.
 */
function removeEverywhere(
  slug: string,
  opts: InstallOptions,
  canonicalTarget: string,
  requested: ReadonlySet<string>,
  lockAgents: readonly string[],
  removed: RemovedRow[],
  errors: ErrorRow[],
): void {
  const seen = new Set<string>([canonicalTarget]);
  for (const agent of filesystemAgents()) {
    let own: string;
    try {
      own = join(resolveAgentSkillsDir(agent, opts), slug);
    } catch {
      continue;
    }
    if (seen.has(own)) continue;
    seen.add(own);
    if (!lexists(own)) continue;
    try {
      removeEntry(own);
      removed.push({ agentId: agent.id, path: own });
    } catch (err) {
      errors.push({ agentId: agent.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  if (!lexists(canonicalTarget)) return;
  const credited = new Set(requested);
  for (const id of lockAgents) {
    const agent = getAgent(id);
    if (agent && isSatisfiedByCanonical(agent, opts)) credited.add(id);
  }
  try {
    removeEntry(canonicalTarget);
    for (const agentId of credited.size > 0 ? credited : ["all"]) {
      removed.push({ agentId, path: canonicalTarget });
    }
  } catch (err) {
    errors.push({ agentId: "all", message: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * 0894: drop agents from the scope lockfile's `agents` list once they have
 * no skill left at all in the scope: nothing in their own skills dir and,
 * for shared readers, nothing in the canonical folder. Any entry counts (so
 * plugin layouts whose folder names differ from lockfile keys keep their
 * agent). Only `candidates` — the agents this request touched — are
 * considered; agents the registry does not know are kept.
 */
function pruneLockAgents(lockDir: string, opts: InstallOptions, candidates: ReadonlySet<string>): void {
  const lock = readLockfile(lockDir);
  if (!lock || !Array.isArray(lock.agents) || lock.agents.length === 0) return;
  const canonicalDir = resolveCanonicalSkillsDir(opts);
  const keep = lock.agents.filter((id) => {
    if (!candidates.has(id)) return true;
    const agent = getAgent(id);
    if (!agent) return true;
    let ownDir: string;
    try {
      ownDir = resolveAgentSkillsDir(agent, opts);
    } catch {
      return true;
    }
    const readsCanonical = isSatisfiedByCanonical(agent, opts) || ownDir === canonicalDir;
    return hasAnyEntry(ownDir) || (readsCanonical && hasAnyEntry(canonicalDir));
  });
  if (keep.length === lock.agents.length) return;
  lock.agents = keep;
  writeLockfile(lock, lockDir);
}

function hasAnyEntry(dir: string): boolean {
  try {
    return readdirSync(dir).some((n) => !n.startsWith("."));
  } catch {
    return false;
  }
}

/** 0894: true while the skill still has a SKILL.md for any agent in the scope. */
function installedAnywhere(slug: string, opts: InstallOptions): boolean {
  const dirs = new Set<string>([join(resolveCanonicalSkillsDir(opts), slug)]);
  for (const agent of filesystemAgents()) {
    try {
      dirs.add(join(resolveAgentSkillsDir(agent, opts), slug));
    } catch {
      // a crafted localSkillsDir that escapes the root is never an install
    }
  }
  for (const d of dirs) if (existsSync(join(d, "SKILL.md"))) return true;
  return false;
}

export const __test__ = {
  SAFE_NAME,
  SAFE_AGENT_ID,
  VALID_SCOPES,
  validateAgentIds,
  lastSegment,
};
