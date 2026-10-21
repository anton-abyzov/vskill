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
import { lstatSync, readdirSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { isLocalhost } from "./install-jobs.js";
import { getAgent, getInstallableAgents, type AgentDefinition } from "../agents/agents-registry.js";
import {
  isSatisfiedByCanonical,
  resolveCanonicalSkillsDir,
  type InstallOptions,
} from "../installer/canonical.js";
import {
  readLockfile,
  removeSkillFromLock,
  writeLockfile,
} from "../lockfile/lockfile.js";
import {
  assertSafeRemovalParents, convertedSkillPaths, effectiveSkillDirs, effectiveSkillFiles,
  extraSkillDirs, hasSkillFiles, isSkillFile, ownedSkillDirs, ownedSkillPaths,
  pathWithin, skillReadEntries, removalAffects,
} from "./skill-install-paths.js";

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
      removePlanned(slug, installOpts, canonicalTarget, requested, all,
        readLockfile(lockDir)?.agents ?? [], removed, skipped, errors);

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
function removeEntry(p: string, opts: InstallOptions): void {
  assertSafeRemovalParents(p, opts);
  if (lstatSync(p).isSymbolicLink()) unlinkSync(p);
  else rmSync(p, { recursive: true, force: true });
}

/** Preflight all of this agent's copies before touching any of them. */
function prepareNativeRemoval(paths: string[], opts: InstallOptions): string[] {
  const present = paths.filter(lexists);
  for (const path of present) assertSafeRemovalParents(path, opts);
  return present;
}

function filesystemAgents(): AgentDefinition[] {
  return getInstallableAgents().filter((a) => (a.installMode ?? "filesystem") === "filesystem");
}

/** Additional reader directories belong to another tool; never erase them
 * just to make this tool's Installed badge disappear. Return a visible error. */
function extraSourceRefusal(agent: AgentDefinition, slug: string, opts: InstallOptions): string | null {
  const canonicalReal = isSatisfiedByCanonical(agent, opts)
    ? safeRealpath(join(resolveCanonicalSkillsDir(opts), slug)) : null;
  const dir = extraSkillDirs(agent, opts).find((d) =>
    isSkillFile(join(d, slug, "SKILL.md"))
    // Aliases of canonical are checked by the entry-level removal plan.
    && (!canonicalReal || safeRealpath(join(d, slug)) !== canonicalReal));
  if (!dir) return null;
  const readers = filesystemAgents().filter((a) => effectiveSkillDirs(a, opts).includes(dir)).map((a) => a.id);
  const owners = filesystemAgents().filter((a) => ownedSkillDirs(a, opts).includes(dir)).map((a) => a.id);
  return `Cannot remove a shared source at ${join(dir, slug)} (read by ${readers.join(", ")}). Remove it from ${owners.length ? owners.join(", ") : "its owning tool"} instead.`;
}

/** A named converted file may be unlinked, but never through a linked parent
 * or by recursively deleting a directory masquerading as a rule file. */
function prepareConvertedRemoval(agent: AgentDefinition, slug: string, opts: InstallOptions): string[] {
  const paths = convertedSkillPaths(agent, slug, opts);
  const present = paths.owned.filter(lexists);
  if (!present.length) return [];
  const config = paths.sharedConfig.find(lexists);
  if (config) throw new Error(`Cannot safely remove ${slug}: shared configuration at ${config} must be updated by its owning tool. Skill files and receipt were preserved.`);
  for (const path of present) {
    assertSafeRemovalParents(path, opts);
    const stat = lstatSync(path);
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`Refusing to remove non-file converted output: ${path}`);
  }
  return present;
}

interface SkillReader {
  agentId: string;
  global: boolean;
  path: string;
  entries: string[] | null;
}

/** Enumerate both scopes, so all never authorizes deleting the other scope's
 * readers. Receipts identify readers of shared registry-owned paths; native,
 * converted and otherwise unowned extra sources are independent file evidence. */
function skillReaders(slug: string, opts: InstallOptions): SkillReader[] {
  const readers: SkillReader[] = [];
  for (const global of [opts.global, !opts.global]) {
    const scopeOpts = { ...opts, global };
    const lockAgents = readLockfile(global ? userLockDir() : opts.projectRoot)?.agents ?? [];
    const canonicalFile = join(resolveCanonicalSkillsDir(scopeOpts), slug, "SKILL.md");
    const agents = filesystemAgents();
    const filesByOwner = new Map(agents.map((agent) => [agent.id, new Set([
      ...ownedSkillPaths(agent, slug, scopeOpts).map((path) => join(path, "SKILL.md")),
      ...convertedSkillPaths(agent, slug, scopeOpts).owned,
    ])]));
    const registryOwned = new Set([...filesByOwner.values()].flatMap((files) => [...files]));
    for (const agent of agents) {
      for (const path of effectiveSkillFiles(agent, slug, scopeOpts)) {
        const shared = path === canonicalFile || (!filesByOwner.get(agent.id)!.has(path) && registryOwned.has(path));
        if (shared && !lockAgents.includes(agent.id)) continue;
        try {
          const entries = skillReadEntries(path);
          if (entries) readers.push({ agentId: agent.id, global, path, entries });
        } catch {
          // An unreadable or cyclic observed path cannot authorize deletion.
          readers.push({ agentId: agent.id, global, path, entries: null });
        }
      }
    }
  }
  return readers;
}

/** All removals use one plan and one entry-level dependency graph. Planning
 * discounts only validated, selected read paths. Execution then requires each
 * dependent alias to be removed successfully before its physical owner.
 * A refused or failed agent immediately becomes a protecting reader again. */
function removePlanned(
  slug: string,
  opts: InstallOptions,
  canonicalTarget: string,
  requested: ReadonlySet<string>,
  all: boolean,
  lockAgents: readonly string[],
  removed: RemovedRow[],
  skipped: SkippedRow[],
  errors: ErrorRow[],
): void {
  const plans = new Map<string, string[]>();
  const actions = new Map<string, Set<string>>();
  const convertedPaths = new Set<string>();
  const agents = all ? filesystemAgents() : [...requested].map((id) => getAgent(id)!);
  for (const agent of agents) {
    if ((agent.installMode ?? "filesystem") !== "filesystem" || agent.isRemoteOnly === true) {
      skipped.push({ agentId: agent.id, reason: "cloud agent — nothing to remove on disk" });
      continue;
    }
    try {
      if (!all) {
        const refusal = extraSourceRefusal(agent, slug, opts);
        if (refusal) throw new Error(refusal);
      }
      const converted = prepareConvertedRemoval(agent, slug, opts);
      const owned = ownedSkillPaths(agent, slug, opts);
      const native = prepareNativeRemoval(owned, opts);
      if (isSatisfiedByCanonical(agent, opts) && lexists(canonicalTarget) && !native.includes(canonicalTarget)) {
        assertSafeRemovalParents(canonicalTarget, opts);
        native.push(canonicalTarget);
      }
      const paths = [...new Set([...native, ...converted])];
      plans.set(agent.id, paths);
      for (const path of paths) {
        const owners = actions.get(path) ?? new Set<string>();
        owners.add(agent.id);
        actions.set(path, owners);
      }
      for (const path of converted) convertedPaths.add(path);
      if (!all && paths.length === 0) skipped.push({ agentId: agent.id, reason: `not installed at ${owned.join(", ")}` });
    } catch (error) {
      errors.push({ agentId: agent.id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  function authorized(reader: SkillReader, paths: readonly string[]): boolean {
    return reader.global === opts.global && plans.has(reader.agentId)
      && paths.some((path) => pathWithin(reader.path, path));
  }
  function protecting(path: string, planning: boolean): string[] {
    const readers = skillReaders(slug, opts);
    return [...new Set(readers.filter((reader) => {
      if (reader.entries !== null && !removalAffects(path, reader.entries)) return false;
      const allowedPaths = planning
        ? (all ? [...plans.values()].flat() : plans.get(reader.agentId) ?? [])
        : ((all || actions.get(path)?.has(reader.agentId)) ? [path] : []);
      return reader.entries === null || !authorized(reader, allowedPaths);
    }).map((reader) => reader.agentId))];
  }
  function refuse(agentId: string, path: string, users: string[]): void {
    const reason = `shared: ${path} is still used by ${users.join(", ")}`;
    if (all) errors.push({ agentId, message: reason });
    else skipped.push({ agentId, reason, sharedWith: users });
    plans.delete(agentId);
  }

  // Refusal propagates before any mutation. This keeps all copies belonging
  // to an agent intact when one of its actions is already known to be unsafe.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [agentId, paths] of plans) {
      for (const path of paths) {
        const users = protecting(path, true);
        if (!users.length) continue;
        refuse(agentId, path, users);
        changed = true;
        break;
      }
    }
  }

  // Prefer owned aliases before canonical, but dependency checks decide the
  // actual order (canonical itself can be a link to a native physical owner).
  const pending = [...actions.keys()].sort((a, b) => Number(a === canonicalTarget) - Number(b === canonicalTarget));
  while (pending.length > 0) {
    let progressed = false;
    for (const path of [...pending]) {
      const owners = [...actions.get(path)!].filter((id) => plans.has(id));
      if (owners.length === 0 || !lexists(path)) {
        pending.splice(pending.indexOf(path), 1);
        progressed = true;
        continue;
      }
      if (protecting(path, false).length > 0) continue;
      let credited = owners;
      if (all && path === canonicalTarget) {
        credited = [...new Set([...requested, ...lockAgents])].filter((id) => owners.includes(id));
        if (!credited.length) credited = ["all"];
      }
      try {
        if (convertedPaths.has(path)) { assertSafeRemovalParents(path, opts); unlinkSync(path); }
        else removeEntry(path, opts);
        for (const agentId of credited) removed.push({ agentId, path });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const agentId of credited) errors.push({ agentId, message });
        for (const id of owners) plans.delete(id);
      }
      pending.splice(pending.indexOf(path), 1);
      progressed = true;
    }
    if (progressed) continue;
    // A surviving failed alias or a dependency cycle cannot be bypassed.
    for (const path of pending) {
      const users = protecting(path, false);
      for (const agentId of actions.get(path)!) {
        if (plans.has(agentId)) refuse(agentId, path, users);
      }
    }
    break;
  }
  if (all) {
    for (const agent of filesystemAgents()) {
      const refusal = extraSourceRefusal(agent, slug, opts);
      if (refusal) errors.push({ agentId: agent.id, message: refusal });
    }
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
  const keep = lock.agents.filter((id) => {
    if (!candidates.has(id)) return true;
    const agent = getAgent(id);
    if (!agent) return true;
    try {
      return effectiveSkillDirs(agent, opts).some(hasAnyEntry)
        || Object.keys(lock.skills).some((name) => hasSkillFiles(agent, lastSegment(name), opts));
    } catch {
      return true;
    }
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

/** Keep the receipt while any effective native, shared, or converted file remains. */
function installedAnywhere(slug: string, opts: InstallOptions): boolean {
  if (isSkillFile(join(resolveCanonicalSkillsDir(opts), slug, "SKILL.md"))) return true;
  for (const agent of filesystemAgents()) {
    try {
      if (hasSkillFiles(agent, slug, opts)) return true;
    } catch {
      // a crafted localSkillsDir that escapes the root is never an install
    }
  }
  return false;
}

export const __test__ = {
  SAFE_NAME,
  SAFE_AGENT_ID,
  VALID_SCOPES,
  validateAgentIds,
  lastSegment,
};
