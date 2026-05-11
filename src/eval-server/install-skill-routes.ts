// 0784 hotfix — local install of arbitrary skills via the eval-server.
//
// Mirrors the install-engine-routes pattern (localhost-only, SSE progress
// stream, hard-coded command name, no shell) but accepts an arbitrary skill
// identifier validated by the same SAFE_NAME regex used in SkillDetailPanel.
//
// Security model:
//   1. Localhost-only — req.socket.remoteAddress must be 127.0.0.1 / ::1.
//   2. SAFE_NAME regex — skill identifier MUST match /^[a-zA-Z0-9._@/\-]+$/
//      (same as SkillDetailPanel sanitizer). The validated string is passed
//      as a single argv entry to spawn("vskill", [...]) — never a shell.
//   3. Scope allowlist — "project" | "user" | "global" only.
//   4. Hard-coded command name "vskill" — no path injection.
//
// 0845 T-017: extended to accept agentIds[] for in-process multi-install
// dispatch. Backward-compatible: legacy `agent: string` or no agent field
// still goes through the CLI-spawn single-agent path (AC-US2-09).
//
// 0845 closure fix: server-side fallback resolves `parsedSkill` from the
// local skill registry (project / personal / plugin cache) when callers
// omit it on the multi-agent path. Keeps the API surface minimal — the
// frontend just sends `{ skill, agentIds, scope }`.
//
// Endpoints:
//   POST /api/studio/install-skill        { skill, scope, agentIds?, parsedSkill? } → 202 + { jobId }
//   GET  /api/studio/install-skill/:id/stream             SSE progress | done

import * as http from "node:http";
import * as os from "node:os";
import { promises as fsPromises } from "node:fs";
import { join as pathJoin } from "node:path";
import { randomUUID } from "node:crypto";

import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import {
  isLocalhost,
  mountSpawnStreamRoute,
  startSpawnJob,
  type SpawnJob,
  type JobEvent,
} from "./install-jobs.js";
import { initSSE, sendSSE, sendSSEDone } from "./sse-helpers.js";
import {
  installSkillToMultipleAgents,
  type AgentInstallResult,
} from "../installer/multi-install.js";
import { getAgent } from "../agents/agents-registry.js";
import type { ParsedSkill } from "../installer/transformers/index.js";
import { locateSkill } from "../clone/skill-locator.js";
import { extractDescription } from "../installer/frontmatter.js";

type InstallScope = "project" | "user" | "global";

const SAFE_NAME = /^[a-zA-Z0-9._@/\-]+$/;
// Agent IDs are slug-shaped: lowercase alphanumeric + hyphens. Stricter
// than SAFE_NAME to reject `.`, `/`, `@`, and uppercase at the boundary
// (FR-007 — every entry in agentIds[] must pass this regex).
const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]*$/;
const VALID_SCOPES: ReadonlySet<string> = new Set(["project", "user", "global"]);
const INSTALL_TIMEOUT_MS = 180_000; // 3 min — installs can be slow on cold caches.

interface SkillJobMeta {
  skill: string;
  scope: InstallScope;
}

const JOBS = new Map<string, SpawnJob<SkillJobMeta>>();

// 0845 T-017 — in-process multi-agent job pool. Distinct from the spawn-job
// JOBS map because these jobs don't have a ChildProcess; their lifecycle is
// the awaited installSkillToMultipleAgents promise.
interface MultiInstallJob {
  id: string;
  done: boolean;
  subscribers: Set<(event: JobEvent, data: unknown) => void>;
  pastEvents: Array<{ event: JobEvent; data: unknown }>;
}

const MULTI_JOBS = new Map<string, MultiInstallJob>();

function buildArgs(skill: string, scope: InstallScope): string[] {
  // No shell — every entry is a discrete argv element. Scope is from a
  // closed set; skill is regex-validated. Both flags map to vskill CLI.
  if (scope === "global") return ["install", skill, "--global"];
  return ["install", skill, "--scope", scope];
}

function emitMultiJob(job: MultiInstallJob, event: JobEvent, data: unknown): void {
  job.pastEvents.push({ event, data });
  for (const sub of job.subscribers) {
    try { sub(event, data); } catch { /* subscriber dead — ignore */ }
  }
}

function isValidParsedSkill(s: unknown): s is ParsedSkill {
  if (!s || typeof s !== "object") return false;
  const v = s as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.body === "string"
  );
}

const SERVER_FALLBACK_FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const SERVER_FALLBACK_NAME_RE = /^name:\s*(.+?)\s*$/m;
const SERVER_FALLBACK_VERSION_RE = /^version:\s*(.+?)\s*$/m;

function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Server-side fallback: when the frontend posts a multi-agent install
 * without `parsedSkill`, locate the skill on disk (project / personal /
 * plugin cache via {@link locateSkill}), read its SKILL.md, and build a
 * minimal {@link ParsedSkill}. Keeps the POST payload trivial — the
 * frontend doesn't need to fetch, parse, and re-marshal SKILL.md itself.
 *
 * Returns `null` when no on-disk skill matches the identifier (the route
 * surfaces this as a 404 so the caller can retry with an explicit
 * `parsedSkill`).
 */
export async function resolveParsedSkillFromIdentifier(
  identifier: string,
  opts?: { cwd?: string; home?: string },
): Promise<ParsedSkill | null> {
  const cwd = opts?.cwd ?? process.cwd();
  const home = opts?.home ?? os.homedir();
  const matches = await locateSkill(identifier, { cwd, home });
  if (matches.length === 0) return null;
  const source = matches[0];
  const skillMdPath = pathJoin(source.skillDir, "SKILL.md");
  let raw: string;
  try {
    raw = await fsPromises.readFile(skillMdPath, "utf-8");
  } catch {
    return null;
  }
  const normalized = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const fmMatch = normalized.match(SERVER_FALLBACK_FRONTMATTER_RE);
  let originalFrontmatter = "";
  let body = normalized;
  let nameFromFm: string | undefined;
  let version: string | undefined;
  if (fmMatch) {
    originalFrontmatter = fmMatch[1];
    body = fmMatch[2];
    const nameMatch = originalFrontmatter.match(SERVER_FALLBACK_NAME_RE);
    if (nameMatch) nameFromFm = unquoteYaml(nameMatch[1]);
    const versionMatch = originalFrontmatter.match(SERVER_FALLBACK_VERSION_RE);
    if (versionMatch) version = unquoteYaml(versionMatch[1]);
  }
  const name = nameFromFm || source.skillName;
  const description = extractDescription(body, name);
  return {
    name,
    description,
    body,
    originalFrontmatter,
    version,
  };
}

function validateAgentIds(ids: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(ids)) return { ok: false, error: "agentIds must be an array" };
  if (ids.length === 0) return { ok: false, error: "agentIds[] cannot be empty" };
  const validated: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string") return { ok: false, error: "agentIds[] entries must be strings" };
    const id = raw.trim();
    if (!SAFE_AGENT_ID.test(id)) return { ok: false, error: `invalid agentId: ${raw}` };
    if (!getAgent(id)) return { ok: false, error: `unknown agentId: ${id}` };
    validated.push(id);
  }
  return { ok: true, ids: validated };
}

async function runMultiInstallJob(opts: {
  skill: ParsedSkill;
  agentIds: string[];
  scope: "project" | "user";
  projectRoot: string;
}): Promise<MultiInstallJob> {
  const job: MultiInstallJob = {
    id: randomUUID(),
    done: false,
    subscribers: new Set(),
    pastEvents: [],
  };
  MULTI_JOBS.set(job.id, job);

  // Run install async — caller returns the jobId synchronously, then
  // streams progress + final done event as agents complete.
  (async () => {
    try {
      const result = await installSkillToMultipleAgents({
        skill: opts.skill,
        agentIds: opts.agentIds,
        scope: opts.scope,
        projectRoot: opts.projectRoot,
      });
      for (const agentResult of result.agents) {
        emitMultiJob(job, "progress", agentResult);
      }
      emitMultiJob(job, "done", {
        success: result.errorCount === 0,
        installedCount: result.installedCount,
        exportedCount: result.exportedCount,
        errorCount: result.errorCount,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitMultiJob(job, "done", { success: false, error: message });
    } finally {
      job.done = true;
    }
  })();

  return job;
}

export function registerInstallSkillRoutes(router: Router): void {
  // POST /api/studio/install-skill
  // Body shape (legacy single-agent CLI spawn):    { skill: string, scope: "project"|"user"|"global" }
  // Body shape (new multi-agent in-process):       { skill: string, scope, agentIds: string[], parsedSkill: ParsedSkill, projectRoot?: string }
  router.post(
    "/api/studio/install-skill",
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (!isLocalhost(req)) {
        sendJson(res, { error: "localhost-only endpoint" }, 403, req);
        return;
      }
      const body = (await readBody(req)) as {
        skill?: string;
        scope?: string;
        agentIds?: unknown;
        parsedSkill?: unknown;
        projectRoot?: string;
      };
      const skill = typeof body?.skill === "string" ? body.skill.trim() : "";
      const scope = typeof body?.scope === "string" ? body.scope : "";
      if (!skill || !SAFE_NAME.test(skill)) {
        sendJson(res, { error: "invalid skill identifier" }, 400, req);
        return;
      }
      if (!VALID_SCOPES.has(scope)) {
        sendJson(res, { error: "invalid scope (must be project|user|global)" }, 400, req);
        return;
      }

      // 0845 T-017 (AC-US2-06): multi-agent in-process path.
      if (body.agentIds !== undefined) {
        const validation = validateAgentIds(body.agentIds);
        if (!validation.ok) {
          sendJson(res, { error: validation.error }, 400, req);
          return;
        }
        // Multi-install only supports "project" | "user" — "global" is a
        // legacy CLI flag with no analogue in the in-process API.
        if (scope !== "project" && scope !== "user") {
          sendJson(
            res,
            { error: "multi-agent installs require scope: project|user" },
            400,
            req,
          );
          return;
        }
        // 0845 closure fix: server-side fallback resolves parsedSkill from
        // the local skill registry when callers omit it. Keeps the frontend
        // payload minimal — the browser doesn't need to fetch + parse
        // SKILL.md itself. Explicit `parsedSkill` in the body still wins so
        // out-of-tree skills (e.g. authoring flows) keep working.
        let parsedSkill: ParsedSkill;
        if (isValidParsedSkill(body.parsedSkill)) {
          parsedSkill = body.parsedSkill;
        } else if (body.parsedSkill !== undefined) {
          sendJson(
            res,
            {
              error:
                "parsedSkill, when provided, must have shape { name, description, body }",
            },
            400,
            req,
          );
          return;
        } else {
          const resolved = await resolveParsedSkillFromIdentifier(skill);
          if (!resolved) {
            sendJson(
              res,
              {
                error:
                  `parsedSkill omitted and could not locate skill "${skill}" in project/personal/plugin-cache; ` +
                  "either install the skill locally first or include parsedSkill: { name, description, body } in the request body",
              },
              404,
              req,
            );
            return;
          }
          parsedSkill = resolved;
        }
        const projectRoot = typeof body.projectRoot === "string" && body.projectRoot
          ? body.projectRoot
          : process.cwd();
        const job = await runMultiInstallJob({
          skill: parsedSkill,
          agentIds: validation.ids,
          scope,
          projectRoot,
        });
        sendJson(res, { jobId: job.id, mode: "multi-agent" }, 202, req);
        return;
      }

      // 0845 T-017 (AC-US2-09): legacy single-agent CLI spawn — backward compat.
      const job = startSpawnJob<SkillJobMeta>({
        command: "vskill",
        args: buildArgs(skill, scope as InstallScope),
        meta: { skill, scope: scope as InstallScope },
        timeoutMs: INSTALL_TIMEOUT_MS,
        jobs: JOBS,
      });
      sendJson(res, { jobId: job.id }, 202, req);
    },
  );

  // GET /api/studio/install-skill/:jobId/stream — legacy spawn-job stream.
  mountSpawnStreamRoute(router, "/api/studio/install-skill", JOBS);

  // 0845 T-017 — distinct stream for multi-install jobs (in-process).
  // Same SSE shape (event: progress | done) so the frontend can consume
  // both flavors with one EventSource subscription pattern.
  router.get(
    "/api/studio/install-skill/multi/:jobId/stream",
    async (
      req: http.IncomingMessage,
      res: http.ServerResponse,
      params: Record<string, string>,
    ) => {
      if (!isLocalhost(req)) {
        sendJson(res, { error: "localhost-only endpoint" }, 403, req);
        return;
      }
      const job = MULTI_JOBS.get(params.jobId);
      if (!job) {
        sendJson(res, { error: "unknown jobId" }, 404, req);
        return;
      }
      initSSE(res, req);
      for (const ev of job.pastEvents) {
        try {
          if (ev.event === "done") sendSSEDone(res, ev.data);
          else sendSSE(res, ev.event, ev.data);
        } catch { /* stream closed */ }
      }
      if (job.done) {
        try { res.end(); } catch { /* already closed */ }
        return;
      }
      const subscriber = (event: JobEvent, data: unknown) => {
        try {
          if (event === "done") sendSSEDone(res, data);
          else sendSSE(res, event, data);
        } catch {
          job.subscribers.delete(subscriber);
        }
      };
      job.subscribers.add(subscriber);
      const cleanup = () => { job.subscribers.delete(subscriber); };
      req.on("close", cleanup);
      req.on("aborted", cleanup);
    },
  );
}

export const __test__ = {
  JOBS,
  MULTI_JOBS,
  SAFE_NAME,
  SAFE_AGENT_ID,
  VALID_SCOPES,
  INSTALL_TIMEOUT_MS,
  buildArgs,
  validateAgentIds,
  isValidParsedSkill,
  resolveParsedSkillFromIdentifier,
};
