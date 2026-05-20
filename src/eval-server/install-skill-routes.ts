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
import { createHash, randomUUID } from "node:crypto";

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
import {
  collectSkillBundleFiles,
  sanitizeSkillBundleFiles,
} from "../installer/bundle-files.js";
import { getDefaultKeychain } from "../lib/keychain.js";
import { ensureLockfile, writeLockfile } from "../lockfile/lockfile.js";
import type { SkillLockEntry } from "../lockfile/types.js";

type InstallScope = "project" | "user" | "global";
type MultiInstallScope = "project" | "user";

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
  subscribers: Set<(event: MultiInstallJobEvent, data: unknown) => void>;
  pastEvents: Array<{ event: MultiInstallJobEvent; data: unknown }>;
}

const MULTI_JOBS = new Map<string, MultiInstallJob>();
type MultiInstallJobEvent = JobEvent | "result";

function buildArgs(skill: string, scope: InstallScope): string[] {
  // No shell — every entry is a discrete argv element. Scope is from a
  // closed set; skill is regex-validated. Both flags map to vskill CLI.
  if (scope === "global" || scope === "user") return ["install", skill, "--global"];
  return ["install", skill, "--scope", scope];
}

function normalizeInstallScope(scope: InstallScope): MultiInstallScope {
  return scope === "project" ? "project" : "user";
}

function userLockDir(): string {
  return pathJoin(os.homedir(), ".agents");
}

function emitMultiJob(job: MultiInstallJob, event: MultiInstallJobEvent, data: unknown): void {
  job.pastEvents.push({ event, data });
  for (const sub of job.subscribers) {
    try { sub(event, data); } catch { /* subscriber dead — ignore */ }
  }
}

function isValidParsedSkill(s: unknown): s is ParsedSkill {
  if (!s || typeof s !== "object") return false;
  const v = s as Record<string, unknown>;
  const requiredFieldsOk =
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.body === "string";
  if (!requiredFieldsOk) return false;
  try {
    sanitizeSkillBundleFiles(v.files);
  } catch {
    return false;
  }
  return true;
}

const SERVER_FALLBACK_FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const SERVER_FALLBACK_NAME_RE = /^name:\s*(.+?)\s*$/m;
const SERVER_FALLBACK_VERSION_RE = /^version:\s*(.+?)\s*$/m;
const DEFAULT_PLATFORM_URL = "https://verified-skill.com";

type FetchLike = typeof fetch;

interface ResolveSkillOptions {
  cwd?: string;
  home?: string;
  fetchImpl?: FetchLike;
  platformBaseUrl?: string;
  githubTokenProvider?: () => string | null;
}

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

function parseRawSkillMd(
  raw: string,
  fallbackName: string,
  fallbackDescription?: string,
): ParsedSkill {
  const normalized = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const fmMatch = normalized.match(SERVER_FALLBACK_FRONTMATTER_RE);
  let originalFrontmatter = "";
  let body = normalized;
  let nameFromFm: string | undefined;
  let version: string | undefined;
  let descriptionFromFm: string | undefined;
  if (fmMatch) {
    originalFrontmatter = fmMatch[1];
    body = fmMatch[2];
    const nameMatch = originalFrontmatter.match(SERVER_FALLBACK_NAME_RE);
    if (nameMatch) nameFromFm = unquoteYaml(nameMatch[1]);
    const versionMatch = originalFrontmatter.match(SERVER_FALLBACK_VERSION_RE);
    if (versionMatch) version = unquoteYaml(versionMatch[1]);
    const descMatch = originalFrontmatter.match(/^description:\s*(.+?)\s*$/m);
    if (descMatch) descriptionFromFm = unquoteYaml(descMatch[1]);
  }
  const name = nameFromFm || fallbackName;
  return {
    name,
    description: descriptionFromFm || fallbackDescription || extractDescription(body, name),
    body,
    originalFrontmatter,
    version,
  };
}

function stripIdentifierVersion(identifier: string): string {
  const slash = identifier.lastIndexOf("/");
  const at = identifier.lastIndexOf("@");
  return at > slash ? identifier.slice(0, at) : identifier;
}

function platformApiPath(identifier: string): string | null {
  const base = stripIdentifierVersion(identifier);
  const parts = base.split("/").filter(Boolean);
  if (parts.length !== 3) return null;
  return `/api/v1/skills/${parts.map(encodeURIComponent).join("/")}`;
}

function platformBaseUrl(opts?: ResolveSkillOptions): string {
  const raw = opts?.platformBaseUrl || process.env.VSKILL_PLATFORM_URL || DEFAULT_PLATFORM_URL;
  return raw.replace(/\/$/, "");
}

interface PlatformSkillRecord {
  name?: string;
  displayName?: string;
  description?: string;
  repoUrl?: string;
  skillPath?: string;
  ownerSlug?: string;
  repoSlug?: string;
  skillSlug?: string;
}

interface PlatformVersionRecord {
  version?: string;
  gitSha?: string | null;
}

function normalizePlatformSkill(body: unknown): PlatformSkillRecord | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const candidate = record.skill && typeof record.skill === "object"
    ? record.skill as Record<string, unknown>
    : record;
  return {
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    displayName: typeof candidate.displayName === "string" ? candidate.displayName : undefined,
    description: typeof candidate.description === "string" ? candidate.description : undefined,
    repoUrl: typeof candidate.repoUrl === "string" ? candidate.repoUrl : undefined,
    skillPath: typeof candidate.skillPath === "string" ? candidate.skillPath : undefined,
    ownerSlug: typeof candidate.ownerSlug === "string" ? candidate.ownerSlug : undefined,
    repoSlug: typeof candidate.repoSlug === "string" ? candidate.repoSlug : undefined,
    skillSlug: typeof candidate.skillSlug === "string" ? candidate.skillSlug : undefined,
  };
}

function normalizePlatformVersions(body: unknown): PlatformVersionRecord[] {
  if (!body || typeof body !== "object") return [];
  const versions = (body as Record<string, unknown>).versions;
  if (!Array.isArray(versions)) return [];
  return versions
    .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object")
    .map((v) => ({
      version: typeof v.version === "string" ? v.version : undefined,
      gitSha: typeof v.gitSha === "string" ? v.gitSha : null,
    }));
}

function parseGitHubRepo(repoUrl: string | undefined): { owner: string; repo: string } | null {
  if (!repoUrl) return null;
  try {
    const url = new URL(repoUrl);
    if (url.hostname !== "github.com") return null;
    const [owner, repoRaw] = url.pathname.replace(/^\/+/, "").split("/");
    const repo = repoRaw?.replace(/\.git$/, "");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

function isSafeSkillPath(skillPath: string | undefined): skillPath is string {
  if (!skillPath) return false;
  if (skillPath.startsWith("/") || skillPath.includes("\\")) return false;
  const parts = skillPath.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) return false;
  return parts[parts.length - 1] === "SKILL.md";
}

function readGitHubToken(opts?: ResolveSkillOptions): string | null {
  if (opts?.githubTokenProvider) return opts.githubTokenProvider();
  try {
    return getDefaultKeychain().getGitHubToken();
  } catch {
    return null;
  }
}

async function fetchSkillMdFromGitHub(opts: {
  repoUrl: string;
  skillPath: string;
  refs: string[];
  fetchImpl: FetchLike;
  token: string | null;
}): Promise<string | null> {
  const repo = parseGitHubRepo(opts.repoUrl);
  if (!repo || !isSafeSkillPath(opts.skillPath)) return null;
  const pathPart = opts.skillPath.split("/").map(encodeURIComponent).join("/");
  const refs = Array.from(new Set(opts.refs.filter(Boolean)));
  if (!refs.includes("")) refs.push("");
  for (const ref of refs) {
    const url = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${pathPart}`);
    if (ref) url.searchParams.set("ref", ref);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.raw",
      "User-Agent": "vskill-skill-studio",
    };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    try {
      const res = await opts.fetchImpl(url.toString(), { headers });
      if (res.ok) return await res.text();
    } catch {
      // Try the next ref.
    }
  }
  return null;
}

async function resolveParsedSkillFromPlatform(
  identifier: string,
  opts?: ResolveSkillOptions,
): Promise<ParsedSkill | null> {
  const apiPath = platformApiPath(identifier);
  if (!apiPath) return null;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const baseUrl = platformBaseUrl(opts);
  let skill: PlatformSkillRecord | null = null;
  try {
    const res = await fetchImpl(`${baseUrl}${apiPath}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    skill = normalizePlatformSkill(await res.json());
  } catch {
    return null;
  }
  if (!skill?.repoUrl || !isSafeSkillPath(skill.skillPath)) return null;

  let versions: PlatformVersionRecord[] = [];
  try {
    const res = await fetchImpl(`${baseUrl}${apiPath}/versions`, { headers: { Accept: "application/json" } });
    if (res.ok) versions = normalizePlatformVersions(await res.json());
  } catch {
    versions = [];
  }
  const requestedVersion = (() => {
    const slash = identifier.lastIndexOf("/");
    const at = identifier.lastIndexOf("@");
    return at > slash ? identifier.slice(at + 1) : null;
  })();
  const selectedVersion = requestedVersion
    ? versions.find((v) => v.version === requestedVersion)
    : versions[0];
  const refs = [
    selectedVersion?.gitSha ?? "",
    "main",
    "master",
  ];
  const raw = await fetchSkillMdFromGitHub({
    repoUrl: skill.repoUrl,
    skillPath: skill.skillPath,
    refs,
    fetchImpl,
    token: readGitHubToken(opts),
  });
  if (!raw) return null;
  return parseRawSkillMd(raw, skill.skillSlug || skill.displayName || stripIdentifierVersion(identifier).split("/").pop() || "skill", skill.description);
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
  opts?: ResolveSkillOptions,
): Promise<ParsedSkill | null> {
  const cwd = opts?.cwd ?? process.cwd();
  const home = opts?.home ?? os.homedir();
  const matches = await locateSkill(identifier, { cwd, home });
  if (matches.length > 0) {
    const source = matches[0];
    const skillMdPath = pathJoin(source.skillDir, "SKILL.md");
    try {
      const raw = await fsPromises.readFile(skillMdPath, "utf-8");
      const parsed = parseRawSkillMd(raw, source.skillName);
      const files = await collectSkillBundleFiles(source.skillDir);
      return { ...parsed, files };
    } catch {
      return null;
    }
  }
  return resolveParsedSkillFromPlatform(identifier, opts);
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

function reconstructedSkillMd(skill: ParsedSkill): string {
  const frontmatter = skill.originalFrontmatter.trim()
    ? skill.originalFrontmatter.trim()
    : [
        `name: ${skill.name}`,
        `description: ${JSON.stringify(skill.description)}`,
        skill.version ? `version: ${skill.version}` : null,
      ].filter(Boolean).join("\n");
  return `---\n${frontmatter}\n---\n\n${skill.body.replace(/^\n+/, "")}`;
}

function computeSha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function sourceFromIdentifier(identifier: string): Pick<
  SkillLockEntry,
  "source" | "sourceRepoUrl" | "sourceType"
> {
  const parts = stripIdentifierVersion(identifier).split("/").filter(Boolean);
  if (parts.length >= 2) {
    const [owner, repo, slug] = parts;
    return {
      source: slug
        ? `marketplace:${owner}/${repo}#${slug}`
        : `github:${owner}/${repo}`,
      sourceRepoUrl: `https://github.com/${owner}/${repo}`,
      sourceType: "github",
    };
  }
  return {
    source: `registry:${stripIdentifierVersion(identifier)}`,
    sourceType: "registry",
  };
}

function writeMultiInstallLockfile(opts: {
  identifier: string;
  skill: ParsedSkill;
  scope: "project" | "user";
  projectRoot: string;
  results: AgentInstallResult[];
}): void {
  const installedAgentIds = opts.results
    .filter((result) => result.status === "installed")
    .map((result) => result.agentId);
  if (installedAgentIds.length === 0) return;

  const content = reconstructedSkillMd(opts.skill);
  const lockDir = opts.scope === "user" ? userLockDir() : opts.projectRoot;
  const lock = ensureLockfile(lockDir);
  const files = ["SKILL.md", ...Object.keys(opts.skill.files ?? {})].sort();
  lock.skills[opts.skill.name] = {
    version: opts.skill.version || "1.0.0",
    sha: computeSha(content),
    tier: "VERIFIED",
    installedAt: new Date().toISOString(),
    scope: opts.scope,
    files,
    ...sourceFromIdentifier(opts.identifier),
  };
  lock.agents = [...new Set([...(lock.agents || []), ...installedAgentIds])];
  writeLockfile(lock, lockDir);
}

async function runMultiInstallJob(opts: {
  identifier: string;
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
        emitMultiJob(job, "result", agentResult);
      }
      writeMultiInstallLockfile({
        identifier: opts.identifier,
        skill: opts.skill,
        scope: opts.scope,
        projectRoot: opts.projectRoot,
        results: result.agents,
      });
      emitMultiJob(job, "done", {
        success: result.errorCount === 0,
        results: result.agents,
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

export function registerInstallSkillRoutes(router: Router, root: string = process.cwd()): void {
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
        const normalizedScope = normalizeInstallScope(scope as InstallScope);
        // 0845 closure fix: server-side fallback resolves parsedSkill from
        // the local skill registry when callers omit it. Keeps the frontend
        // payload minimal — the browser doesn't need to fetch + parse
        // SKILL.md itself. Explicit `parsedSkill` in the body still wins so
        // out-of-tree skills (e.g. authoring flows) keep working.
        let parsedSkill: ParsedSkill;
        if (isValidParsedSkill(body.parsedSkill)) {
          parsedSkill = {
            ...body.parsedSkill,
            files: sanitizeSkillBundleFiles(body.parsedSkill.files),
          };
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
          const resolved = await resolveParsedSkillFromIdentifier(skill, { cwd: root });
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
          : root;
        const job = await runMultiInstallJob({
          identifier: skill,
          skill: parsedSkill,
          agentIds: validation.ids,
          scope: normalizedScope,
          projectRoot,
        });
        sendJson(
          res,
          {
            jobId: job.id,
            mode: "multi-agent",
            streamPath: `/api/studio/install-skill/multi/${encodeURIComponent(job.id)}/stream`,
          },
          202,
          req,
        );
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
      const subscriber = (event: MultiInstallJobEvent, data: unknown) => {
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
  normalizeInstallScope,
  validateAgentIds,
  isValidParsedSkill,
  resolveParsedSkillFromIdentifier,
  resolveParsedSkillFromPlatform,
  fetchSkillMdFromGitHub,
  runMultiInstallJob,
  writeMultiInstallLockfile,
};
