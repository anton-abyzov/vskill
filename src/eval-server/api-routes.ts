// ---------------------------------------------------------------------------
// api-routes.ts -- REST API route handlers for the eval UI
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname, basename } from "node:path";
import { homedir } from "node:os";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { initSSE, sendSSE, sendSSEDone, withHeartbeat, startDynamicHeartbeat } from "./sse-helpers.js";
import { dataEventBus, emitDataEvent } from "./data-events.js";
import { classifyError } from "./error-classifier.js";
import { readLockfile } from "../lockfile/lockfile.js";
import { parseSource } from "../resolvers/source-resolver.js";
import { resolveSkillApiName as resolveSkillApiNameImpl } from "./skill-name-resolver.js";
import { runBenchmarkSSE, runSingleCaseSSE, assembleBulkResult } from "./benchmark-runner.js";
import { getSkillSemaphore } from "./concurrency.js";
import { resolveSkillDir } from "./skill-resolver.js";
import { scanSkills, classifyOrigin, scanSkillsTriScope } from "../eval/skill-scanner.js";
import type { SkillInfo, SkillScope } from "../eval/skill-scanner.js";
import {
  scanInstalledPluginSkills,
  scanAuthoredPluginSkills,
} from "../eval/plugin-scanner.js";
import { resolveGlobalSkillsDir } from "../eval/path-utils.js";
import { loadAndValidateEvals, EvalValidationError } from "../eval/schema.js";
import { ANTHROPIC_CATALOG_SNAPSHOT, findAnthropicModel } from "../eval/anthropic-catalog.js";
import type { EvalsFile } from "../eval/schema.js";
import { readBenchmark } from "../eval/benchmark.js";
import type { BenchmarkResult, BenchmarkCase, BenchmarkAssertionResult } from "../eval/benchmark.js";
import { writeHistoryEntry, listHistory, readHistoryEntry, computeRegressions, deleteHistoryEntry, getCaseHistory, computeStats } from "../eval/benchmark-history.js";
import type { HistoryFilter } from "../eval/benchmark-history.js";
import { judgeAssertion } from "../eval/judge.js";
import { buildEvalSystemPrompt, buildBaselineSystemPrompt } from "../eval/prompt-builder.js";
import { createLlmClient } from "../eval/llm.js";
import type { ProviderName, LlmOverrides } from "../eval/llm.js";
import { runComparison } from "../eval/comparator.js";
import { computeVerdict } from "../eval/verdict.js";
import { generateActionItems } from "../eval/action-items.js";
import { buildEvalInitPrompt, parseGeneratedEvals, buildIntegrationEvalPrompt, parseGeneratedIntegrationEvals, detectBrowserRequirements, detectPlatformTargets } from "../eval/prompt-builder.js";
import { testActivation } from "../eval/activation-tester.js";
import type { ActivationPrompt, SkillMeta } from "../eval/activation-tester.js";
import { detectMcpDependencies, detectSkillDependencies } from "../eval/mcp-detector.js";
import { writeActivationRun, listActivationRuns, getActivationRun } from "../eval/activation-history.js";
import type { ActivationHistoryRun } from "../eval/activation-history.js";
import { AGENTS_REGISTRY, detectInstalledAgents } from "../agents/agents-registry.js";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { resolveOllamaBaseUrl } from "../eval/env.js";
import * as settingsStore from "./settings-store.js";
import { PROVIDERS, isProviderId, getProviderById, type ProviderId } from "./providers.js";
import { DarwinKeychainMigrator } from "./darwin-migrator.js";
import { loadStudioSelection, saveStudioSelection } from "./studio-json.js";

// ---------------------------------------------------------------------------
// Installed agents response builder
// ---------------------------------------------------------------------------

export interface InstalledAgentEntry {
  id: string;
  displayName: string;
  featureSupport: AgentDefinition["featureSupport"];
  isUniversal: boolean;
  installed: boolean;
}

export interface InstalledAgentsResponse {
  agents: InstalledAgentEntry[];
  suggested: string;
}

/**
 * Build the response for GET /api/agents/installed.
 * Returns all known agents with installed flag based on detected agents.
 */
export function buildInstalledAgentsResponse(
  detectedAgents: AgentDefinition[],
): InstalledAgentsResponse {
  const detectedIds = new Set(detectedAgents.map((a) => a.id));

  const agents: InstalledAgentEntry[] = AGENTS_REGISTRY.map((agent) => ({
    id: agent.id,
    displayName: agent.displayName,
    featureSupport: agent.featureSupport,
    isUniversal: agent.isUniversal,
    installed: detectedIds.has(agent.id),
  }));

  // Suggest claude-code if installed, otherwise first installed alphabetically, fallback to claude-code
  let suggested = "claude-code";
  if (detectedIds.has("claude-code")) {
    suggested = "claude-code";
  } else if (detectedAgents.length > 0) {
    suggested = detectedAgents[0].id;
  }

  return { agents, suggested };
}

// ---------------------------------------------------------------------------
// 0686 — /api/agents response builder + detection cache.
//
// Returns agent registry entries filtered to those with presence (local
// folder, global folder, or detectInstalled binary) with per-agent
// localSkillCount + globalSkillCount + isDefault + resolved absolute paths.
// Shared-folder grouping surfaces agents that map to the same normalized
// globalSkillsDir (e.g. kimi + amp + replit → ~/.config/agents/skills).
//
// Presence is cached for 30s (mirrors detectAvailableProviders pattern).
// ---------------------------------------------------------------------------

export interface AgentScopeEntry {
  id: string;
  displayName: string;
  featureSupport: AgentDefinition["featureSupport"];
  isUniversal: boolean;
  parentCompany: string;
  detected: boolean;
  isDefault: boolean;
  localSkillCount: number;
  globalSkillCount: number;
  resolvedLocalDir: string;
  resolvedGlobalDir: string;
  lastSync: string | null;
  health: "ok" | "stale" | "missing";
  // 0694 (AC-US4-04): web-only agents (Devin, bolt.new, v0, Replit) have no
  // local install path. UI uses this to render a "Remote" badge and suppress
  // install/active affordances. Optional so older clients ignore the field.
  isRemoteOnly?: boolean;
}

export interface AgentsResponse {
  agents: AgentScopeEntry[];
  suggested: string;
  sharedFolders: Array<{ path: string; consumers: string[] }>;
}

interface AgentPresenceCacheEntry {
  data: AgentsResponse;
  ts: number;
  rootKey: string;
  homeKey: string;
  binariesKey: string;
}

let agentPresenceCache: AgentPresenceCacheEntry | null = null;
const AGENT_PRESENCE_CACHE_TTL = 30_000;

/** Test hook — clear the 30 s cache so the next buildAgentsResponse() re-scans. */
export function resetAgentPresenceCache(): void {
  agentPresenceCache = null;
}

interface BuildAgentsOptions {
  /** Project root (typically eval-server cwd). */
  root: string;
  /** Override home dir (primarily for tests / fixture homes). */
  home?: string;
  /** Agents whose CLI binary is on PATH — optional; callers may pre-detect. */
  detectedBinaries?: Set<string>;
}

/** Count skills in a directory following the `<dir>/<skill>/SKILL.md` layout.
 *  Non-recursive — skills are conventionally flat children of the skills dir. */
function countSkillsIn(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      // Accept plain dirs AND symlinked-dirs.
      let isDirLike = entry.isDirectory();
      if (!isDirLike && entry.isSymbolicLink?.()) {
        try { isDirLike = statSync(fullPath).isDirectory(); } catch { /* broken link */ }
      }
      if (!isDirLike) continue;
      if (existsSync(join(fullPath, "SKILL.md"))) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Build the /api/agents response. Filters to agents with presence and
 * includes per-agent counts, resolved paths, and shared-folder grouping.
 *
 * Results are cached for 30s keyed by `(root, home, binaries)` so repeated
 * polls don't re-walk the filesystem.
 */
export async function buildAgentsResponse(
  opts: BuildAgentsOptions,
): Promise<AgentsResponse> {
  const root = opts.root;
  const home = opts.home;
  const detectedBinaries = opts.detectedBinaries ?? new Set<string>();

  const cacheKey = {
    rootKey: root,
    homeKey: home ?? "",
    binariesKey: [...detectedBinaries].sort().join(","),
  };
  const now = Date.now();
  if (
    agentPresenceCache &&
    now - agentPresenceCache.ts < AGENT_PRESENCE_CACHE_TTL &&
    agentPresenceCache.rootKey === cacheKey.rootKey &&
    agentPresenceCache.homeKey === cacheKey.homeKey &&
    agentPresenceCache.binariesKey === cacheKey.binariesKey
  ) {
    return agentPresenceCache.data;
  }

  // Map each agent → resolved local + global dir. For tests, `home` overrides
  // the homedir-derived global path. In production, resolveGlobalSkillsDir()
  // handles cross-platform resolution (darwin / linux / win32).
  const entries: AgentScopeEntry[] = [];
  const globalDirByAgentId = new Map<string, string>();

  for (const agent of AGENTS_REGISTRY) {
    const resolvedLocalDir = join(root, agent.localSkillsDir);
    const resolvedGlobalDir = home
      ? join(home, firstNonTildeSegment(agent.globalSkillsDir))
      : resolveGlobalSkillsDir(agent);
    globalDirByAgentId.set(agent.id, resolvedGlobalDir);

    const localExists = existsSync(resolvedLocalDir);
    const globalExists = existsSync(resolvedGlobalDir);
    const binaryDetected = detectedBinaries.has(agent.id);

    // 0694 (AC-US4-04): remote-only agents (Devin, bolt.new, v0, Replit) have
    // no local CLI to detect. Surface them in the catalog so the UI can render
    // a "Remote" badge and suppress install affordances. Without this, the
    // presence filter below would drop them and the badge code path would be
    // unreachable in production.
    const hasPresence = localExists || globalExists || binaryDetected || agent.isRemoteOnly === true;
    if (!hasPresence) continue;

    const localSkillCount = countSkillsIn(resolvedLocalDir);
    const globalSkillCount = countSkillsIn(resolvedGlobalDir);
    const firstLocalSegment = agent.localSkillsDir.split("/")[0] || "";
    const hasProjectFolder = firstLocalSegment
      ? existsSync(join(root, firstLocalSegment))
      : false;
    const isDefault = agent.id === "claude-code" && hasProjectFolder;

    // Best-effort lastSync from lockfile — null when no lockfile or no entry.
    const lastSync = resolveAgentLastSync(root, agent.id);
    const health = computeAgentHealth(lastSync, localSkillCount + globalSkillCount);

    entries.push({
      id: agent.id,
      displayName: agent.displayName,
      featureSupport: agent.featureSupport,
      isUniversal: agent.isUniversal,
      parentCompany: agent.parentCompany,
      // Remote-only agents are always "detected" in the catalog sense — the
      // service exists, just not locally. UI keys off isRemoteOnly to render
      // the appropriate affordance (badge, not install button).
      detected: hasPresence,
      isDefault,
      localSkillCount,
      globalSkillCount,
      resolvedLocalDir,
      resolvedGlobalDir,
      lastSync,
      health,
      // 0694 (AC-US4-04): propagate the flag so the UI can render a "Remote"
      // badge for web-only agents (suppresses install affordances).
      isRemoteOnly: agent.isRemoteOnly,
    });
  }

  // Sort: healthy + detected first, then by id.
  entries.sort((a, b) => {
    const aMissing = a.health === "missing";
    const bMissing = b.health === "missing";
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    return a.id.localeCompare(b.id);
  });

  // Shared-folder grouping — normalize paths via resolve() and group agents
  // whose resolvedGlobalDir maps to the same absolute path.
  const sharedGroups = new Map<string, string[]>();
  for (const entry of entries) {
    const key = resolve(entry.resolvedGlobalDir);
    const list = sharedGroups.get(key) ?? [];
    list.push(entry.id);
    sharedGroups.set(key, list);
  }
  const sharedFolders: AgentsResponse["sharedFolders"] = [];
  for (const [path, consumers] of sharedGroups.entries()) {
    if (consumers.length >= 2) {
      sharedFolders.push({ path, consumers: consumers.sort() });
    }
  }

  // Suggested: claude-code if detected; else alphabetically-first detected;
  // else claude-code as fallback (consistent with buildInstalledAgentsResponse).
  let suggested = "claude-code";
  if (!entries.some((e) => e.id === "claude-code")) {
    suggested = entries[0]?.id ?? "claude-code";
  }

  const data: AgentsResponse = { agents: entries, suggested, sharedFolders };

  agentPresenceCache = { data, ts: now, ...cacheKey };
  return data;
}

function firstNonTildeSegment(p: string): string {
  if (p.startsWith("~/") || p.startsWith("~\\")) return p.slice(2);
  if (p.startsWith("~")) return p.slice(1);
  return p;
}

/** Read the lockfile and return the newest `updatedAt` across entries owned by
 *  `agentId`. Returns null if the lockfile is missing or has no matching entry. */
function resolveAgentLastSync(root: string, _agentId: string): string | null {
  try {
    const lock = readLockfile(root);
    if (!lock?.skills) return null;
    let newest: string | null = null;
    for (const entry of Object.values(lock.skills)) {
      const updatedAt = (entry as { updatedAt?: string }).updatedAt;
      if (typeof updatedAt === "string" && (!newest || updatedAt > newest)) {
        newest = updatedAt;
      }
    }
    return newest;
  } catch {
    return null;
  }
}

function computeAgentHealth(
  lastSync: string | null,
  totalSkills: number,
): "ok" | "stale" | "missing" {
  if (totalSkills === 0 && !lastSync) return "missing";
  if (!lastSync) return "ok";
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const age = Date.now() - new Date(lastSync).getTime();
  return age > SEVEN_DAYS_MS ? "stale" : "ok";
}

// ---------------------------------------------------------------------------
// 0686 — /api/skills?scope=&agent= filter.
//
// The existing /api/skills response is the SSoT for skill shape; this helper
// applies an in-memory filter on top of the full tri-scope list so the
// endpoint stays a pure projection (no fresh disk walk per query).
// ---------------------------------------------------------------------------

export interface SkillScopeFilter {
  scope?: string;
  agent?: string;
}

export function filterSkillsByScopeAndAgent<T extends SkillInfo>(
  skills: T[],
  filter: SkillScopeFilter,
): T[] {
  let out = skills;
  if (filter.scope !== undefined) {
    const allowed: SkillScope[] = ["own", "installed", "global"];
    if (!allowed.includes(filter.scope as SkillScope)) return [];
    out = out.filter((s) => (s.scope ?? "own") === filter.scope);
  }
  if (filter.agent !== undefined) {
    const agent = filter.agent;
    out = out.filter((s) => {
      const scope = s.scope ?? "own";
      if (scope === "own") return true;
      return s.sourceAgent === agent;
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function extractDescription(skillContent: string): string {
  const fmMatch = skillContent.match(/^---[\s\S]*?description:\s*"([^"]+)"[\s\S]*?---/);
  if (fmMatch) return fmMatch[1];
  const body = skillContent.replace(/^---[\s\S]*?---\s*/, "").trim();
  return body.slice(0, 500);
}

// ---------------------------------------------------------------------------
// T-025: SKILL.md frontmatter + filesystem enrichment for /api/skills.
//
// The response must carry every frontmatter field (description, version,
// tags, etc.) alongside filesystem stats (lastModified, sizeBytes) and, for
// installed skills, the owning agent id (sourceAgent). Unknown/missing
// fields MUST be `null` (not undefined) so that JSON.stringify preserves
// them — downstream consumers rely on the shape being stable.
// ---------------------------------------------------------------------------

export interface SkillMetadataFields {
  description: string | null;
  version: string | null;
  category: string | null;
  author: string | null;
  license: string | null;
  homepage: string | null;
  tags: string[] | null;
  deps: string[] | null;
  mcpDeps: string[] | null;
  entryPoint: string | null;
  lastModified: string | null;
  sizeBytes: number | null;
  sourceAgent: string | null;
  /** 0737 — Canonical https:// URL of the source GitHub repo, derived from
   *  vskill.lock (`sourceRepoUrl` or legacy `source: github:owner/repo`).
   *  Drives the source-file anchor on the Studio detail header. */
  repoUrl: string | null;
  /** 0737 — Relative path inside the repo to the SKILL.md (e.g.
   *  "skills/foo/SKILL.md"). Defaults to "SKILL.md" for flat-layout
   *  installs derived from a legacy `github:` source string. */
  skillPath: string | null;
}

const EMPTY_METADATA: SkillMetadataFields = {
  description: null,
  version: null,
  category: null,
  author: null,
  license: null,
  homepage: null,
  tags: null,
  deps: null,
  mcpDeps: null,
  entryPoint: null,
  lastModified: null,
  sizeBytes: null,
  sourceAgent: null,
  repoUrl: null,
  skillPath: null,
};

/**
 * Allow-list of metadata children that may be surfaced at the top level
 * during the metadata-nesting migration. Surfacing is intentional for these
 * keys (existing consumers read them as `fm.<key>`); other metadata children
 * stay nested under `fm.metadata.<key>` only, so they cannot accidentally
 * shadow future top-level fields. (0679 review F-004.)
 *
 * Includes every key that `buildSkillMetadata` (below) reads at the root, so
 * that if a future hand-edit moves them under `metadata:` per the spec, the
 * /api/skills payload still recovers them.
 */
const SURFACED_METADATA_KEYS = new Set([
  // Spec-required keys (agentskills.io/specification — `metadata:` block)
  "tags",
  "target-agents",
  "version",
  "homepage",
  "category",
  "author",
  "license",
  // Dependency keys read by buildSkillMetadata. Both kebab-case (canonical)
  // and camelCase (legacy SKILL.md) are surfaced so the migration is total.
  "skill-deps",
  "skillDeps",
  "deps",
  "mcp-deps",
  "mcpDeps",
  "mcpDependencies",
  // Path / file metadata
  "entryPoint",
  "entry-point",
]);

/**
 * Minimal YAML frontmatter parser — handles scalars and arrays (inline [a, b]
 * or YAML list form), folded scalars (`key: >` + indented continuation), and
 * the `metadata:` block. We intentionally avoid pulling gray-matter into the
 * eval-server bundle; SKILL.md frontmatter is a well-bounded subset.
 *
 * 0679: also recognizes the canonical agentskills.io shape where `tags` and
 * `target-agents` are nested under a `metadata:` block. Allow-listed children
 * of `metadata:` (see SURFACED_METADATA_KEYS) are surfaced both as top-level
 * keys (`fm.tags`) AND under `metadata.<key>` (e.g., `fm.metadata.tags`), so
 * existing consumers that read `fm.tags` keep working without changes. Other
 * metadata children stay nested-only. If a SKILL.md somehow has BOTH a
 * top-level `tags:` AND a `metadata.tags:` (hand-edited transitional file),
 * the top-level value wins — explicit beats nested.
 */
export function parseSkillFrontmatter(content: string): Record<string, string | string[] | Record<string, string | string[]>> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split("\n");
  const rootOut: Record<string, string | string[]> = {};
  const metaOut: Record<string, string | string[]> = {};
  let scope: "root" | "metadata" = "root";
  let currentKey: string | null = null;
  let currentList: string[] | null = null;
  let currentScope: "root" | "metadata" = "root";
  // Folded-scalar (`key: >`) / literal-scalar (`key: |`) accumulator.
  // While active, indented continuation lines are joined into a single value.
  let foldedKey: string | null = null;
  let foldedScope: "root" | "metadata" | null = null;
  let foldedLines: string[] = [];
  let foldedKind: ">" | "|" | null = null;

  const stripQuotes = (s: string) => s.trim().replace(/^["']|["']$/g, "");

  const flushList = () => {
    if (currentKey && currentList) {
      const target = currentScope === "metadata" ? metaOut : rootOut;
      target[currentKey] = currentList;
    }
    currentKey = null;
    currentList = null;
    // 0679 review F-005: keep currentScope coherent with the cleared list.
    currentScope = scope;
  };

  const flushFolded = () => {
    if (!foldedKey) return;
    // Folded (`>`): join with single spaces, collapsing blank lines to "\n".
    // Literal (`|`): preserve newlines.
    const joined = foldedKind === "|"
      ? foldedLines.join("\n").trim()
      : foldedLines.map((l) => l.trim()).filter(Boolean).join(" ").trim();
    const target = foldedScope === "metadata" ? metaOut : rootOut;
    target[foldedKey] = joined;
    foldedKey = null;
    foldedScope = null;
    foldedLines = [];
    foldedKind = null;
  };

  for (const line of lines) {
    // While accumulating a folded/literal scalar, any indented continuation
    // line belongs to the scalar; an empty line is a paragraph break.
    if (foldedKey) {
      if (line.trim() === "") {
        foldedLines.push("");
        continue;
      }
      if (/^ {2,}/.test(line)) {
        foldedLines.push(line.replace(/^ +/, ""));
        continue;
      }
      // Non-indented line — fold ends, fall through to normal processing.
      flushFolded();
    }

    if (line.trim() === "") continue;

    // Metadata-nested list item (exactly 4 spaces indent): `    - value`
    const nestedListItem = line.match(/^ {4}-\s+(.+)$/);
    if (nestedListItem && currentKey && currentList && currentScope === "metadata") {
      currentList.push(stripQuotes(nestedListItem[1]));
      continue;
    }
    // Root-level list item — accept either `  - value` (2-space, YAML-conventional
    // for top-level keys followed by indented list) or `- value` (0-space, also
    // valid YAML). Reject 1-space and 3+ space (malformed) for symmetry with
    // the strict 2-space metadata-child rule. (0679 review F-002 iter-1, regex
    // readability cleanup iter-4 F-002: `(?:  )?-` is the conventional form.)
    const rootListItem = line.match(/^(?:  )?-\s+(.+)$/);
    if (rootListItem && currentKey && currentList && currentScope === "root") {
      currentList.push(stripQuotes(rootListItem[1]));
      continue;
    }

    // Metadata child key: `  key:` or `  key: value` (exactly 2-space indent)
    const metaChild = line.match(/^ {2}([\w-]+):\s*(.*)$/);
    if (scope === "metadata" && metaChild) {
      flushList();
      const key = metaChild[1];
      const rawValue = metaChild[2].trim();
      currentScope = "metadata";
      currentKey = key;
      if (!rawValue) {
        currentList = [];
        continue;
      }
      // Folded / literal scalar inside metadata.
      if (rawValue === ">" || rawValue === "|") {
        foldedKey = key;
        foldedScope = "metadata";
        foldedLines = [];
        foldedKind = rawValue;
        currentKey = null;
        currentList = null;
        continue;
      }
      const arrayMatch = rawValue.match(/^\[(.*)\]$/);
      if (arrayMatch) {
        metaOut[key] = arrayMatch[1].split(",").map(stripQuotes).filter(Boolean);
        currentList = null;
        currentKey = null;
      } else {
        metaOut[key] = stripQuotes(rawValue);
        currentList = null;
        currentKey = null;
      }
      continue;
    }

    // Top-level key: `key:` or `key: value` (no leading whitespace)
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    flushList();
    const key = kv[1];
    const rawValue = kv[2].trim();

    if (key === "metadata") {
      // 0679 review F-002 + iter-3 F-001: `metadata: <inline-scalar>` is a
      // malformed file. We open the block (subsequent indented children land
      // under `metadata`) AND preserve the inline value at a sentinel
      // top-level key (`metadata-inline`) so callers can detect the mistake
      // instead of silently losing data. The post-merge step (below) removes
      // any chance of the block contents overwriting the inline value.
      if (rawValue && rawValue !== ">" && rawValue !== "|") {
        rootOut["metadata-inline"] = stripQuotes(rawValue);
      }
      // Entering the metadata block; subsequent indented children are nested.
      scope = "metadata";
      currentScope = "metadata";
      currentKey = null;
      currentList = null;
      continue;
    }

    // Any unindented key resets scope back to root.
    scope = "root";
    currentScope = "root";
    currentKey = key;
    if (!rawValue) {
      currentList = [];
      continue;
    }
    // 0679 review F-001: folded (`>`) and literal (`|`) scalars at root.
    if (rawValue === ">" || rawValue === "|") {
      foldedKey = key;
      foldedScope = "root";
      foldedLines = [];
      foldedKind = rawValue;
      currentKey = null;
      currentList = null;
      continue;
    }
    const arrayMatch = rawValue.match(/^\[(.*)\]$/);
    if (arrayMatch) {
      rootOut[key] = arrayMatch[1].split(",").map(stripQuotes).filter(Boolean);
      currentList = null;
      currentKey = null;
    } else {
      // scope is "root" here — set just above. Top-level scalar.
      rootOut[key] = stripQuotes(rawValue);
      currentList = null;
      currentKey = null;
    }
  }
  flushList();
  flushFolded();

  // Surface allow-listed metadata children at the top level so existing
  // consumers (`fm.tags`, `fm["target-agents"]`) keep working post-migration.
  // A top-level value with the same name takes precedence over the nested
  // one. Non-allow-listed children stay nested-only — see SURFACED_METADATA_KEYS.
  // 0679 review iter-4 F-003 + grill G-002: defensive-copy arrays on BOTH
  // sides (root surfacing and the nested `fm.metadata.<key>`) so neither
  // path can accidentally mutate the other.
  const merged: Record<string, string | string[] | Record<string, string | string[]>> = { ...rootOut };
  for (const [k, v] of Object.entries(metaOut)) {
    if (SURFACED_METADATA_KEYS.has(k) && !(k in merged)) {
      merged[k] = Array.isArray(v) ? [...v] : v;
    }
  }
  if (Object.keys(metaOut).length > 0) {
    const metaCopy: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(metaOut)) {
      metaCopy[k] = Array.isArray(v) ? [...v] : v;
    }
    merged.metadata = metaCopy;
  }
  return merged;
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function toStringArrayOrNull(v: unknown): string[] | null {
  if (Array.isArray(v)) {
    const filtered = v
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
    return filtered.length > 0 ? filtered : null;
  }
  if (typeof v === "string" && v.trim().length > 0) {
    // Comma-separated fallback
    const parts = v.split(",").map((x) => x.trim()).filter(Boolean);
    return parts.length > 0 ? parts : null;
  }
  return null;
}

/**
 * Best-effort total file size + newest mtime for a skill directory. Used for
 * the detail panel's filesystem group. Non-recursive by design — skills are
 * conventionally flat, and recursion would make large docs expensive to list.
 */
function statSkillDir(dir: string): { sizeBytes: number | null; lastModified: string | null } {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    let total = 0;
    let newest = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        const st = statSync(join(dir, entry.name));
        total += st.size;
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch { /* ignore unreadable file */ }
    }
    return {
      sizeBytes: total > 0 ? total : null,
      lastModified: newest > 0 ? new Date(newest).toISOString() : null,
    };
  } catch {
    return { sizeBytes: null, lastModified: null };
  }
}

/**
 * Derive the owning agent id for an installed skill by matching its first
 * relative path segment against AGENTS_REGISTRY.localSkillsDir. Returns null
 * for `origin="source"` or if no registry entry matches.
 */
export function deriveSourceAgent(
  skillDir: string,
  root: string,
  origin: "source" | "installed",
): string | null {
  if (origin !== "installed") return null;
  const rel = resolve(skillDir).startsWith(resolve(root))
    ? resolve(skillDir).slice(resolve(root).length).replace(/^[/\\]/, "")
    : skillDir;
  const firstSegment = rel.split(/[/\\]/)[0];
  if (!firstSegment) return null;
  for (const agent of AGENTS_REGISTRY) {
    const agentFirst = agent.localSkillsDir.split("/")[0];
    if (agentFirst && agentFirst === firstSegment) return agent.id;
  }
  return null;
}

/**
 * 0737 — Resolve the source-repo provenance (repoUrl + skillPath) for a
 * skill by looking up its lockfile entry. Two precedences:
 *   1. Explicit `sourceRepoUrl` / `sourceSkillPath` (set by `vskill install`
 *      after this change ships).
 *   2. Legacy `source: github:owner/repo` string (every existing install).
 *
 * Lockfile entries are keyed by plugin name; for nested-layout plugins the
 * skill dir basename and the lockfile key differ — fall back to the parent
 * directory's basename when no exact match exists.
 *
 * Returns `{ null, null }` for any non-github source (e.g.
 * `marketplace:specweave/sw#name`) — guessing a repo URL would produce
 * broken anchors. Authored skills (no lockfile entry) also return null.
 */
function resolveSourceLink(
  skillDir: string,
  root: string,
): { repoUrl: string | null; skillPath: string | null } {
  const lock = readLockfile(root);
  if (!lock) return { repoUrl: null, skillPath: null };

  const skillName = basename(skillDir);
  const parentName = basename(dirname(skillDir));
  const entry = lock.skills[skillName] ?? lock.skills[parentName];
  if (!entry) return { repoUrl: null, skillPath: null };

  if (entry.sourceRepoUrl) {
    return {
      repoUrl: entry.sourceRepoUrl,
      skillPath: entry.sourceSkillPath ?? "SKILL.md",
    };
  }

  // Legacy derivation from `source: github:owner/repo`.
  const m = /^github:([^/]+)\/([^/#]+)/.exec(entry.source ?? "");
  if (!m) return { repoUrl: null, skillPath: null };
  return {
    repoUrl: `https://github.com/${m[1]}/${m[2]}`,
    skillPath: entry.sourceSkillPath ?? "SKILL.md",
  };
}

/**
 * Build the T-025 metadata payload for a single skill. Reads SKILL.md from
 * disk if present; returns EMPTY_METADATA on any error so the /api/skills
 * response never fails because of a single bad skill.
 */
export function buildSkillMetadata(
  skillDir: string,
  origin: "source" | "installed",
  root: string,
): SkillMetadataFields {
  const skillMd = join(skillDir, "SKILL.md");
  const sourceLink = resolveSourceLink(skillDir, root);
  if (!existsSync(skillMd)) {
    return {
      ...EMPTY_METADATA,
      sourceAgent: deriveSourceAgent(skillDir, root, origin),
      ...sourceLink,
    };
  }
  let fm: Record<string, string | string[] | Record<string, string | string[]>> = {};
  try {
    const content = readFileSync(skillMd, "utf8");
    fm = parseSkillFrontmatter(content);
  } catch {
    // Fall through with empty frontmatter
  }
  const { sizeBytes, lastModified } = statSkillDir(skillDir);
  // Prefer "skill-deps" / "mcp-deps" kebab-case but accept camelCase too.
  const deps = toStringArrayOrNull(fm["skill-deps"] ?? fm.skillDeps ?? fm.deps);
  const mcpDeps = toStringArrayOrNull(fm["mcp-deps"] ?? fm.mcpDeps ?? fm.mcpDependencies);
  const tags = toStringArrayOrNull(fm.tags);
  return {
    description: toStringOrNull(fm.description),
    version: toStringOrNull(fm.version),
    category: toStringOrNull(fm.category),
    author: toStringOrNull(fm.author),
    license: toStringOrNull(fm.license),
    homepage: toStringOrNull(fm.homepage),
    tags,
    deps,
    mcpDeps,
    entryPoint: toStringOrNull(fm.entryPoint) ?? "SKILL.md",
    lastModified,
    sizeBytes,
    sourceAgent: deriveSourceAgent(skillDir, root, origin),
    repoUrl: sourceLink.repoUrl,
    skillPath: sourceLink.skillPath,
  };
}

// ---------------------------------------------------------------------------
// In-memory config state — UI can change provider/model at runtime.
//
// Default: claude-cli (Sonnet). The eval server is always run from a separate
// terminal, so claude-cli is always safe — even if CLAUDECODE env is set
// (which only matters for the `vskill eval run` CLI command).
// ---------------------------------------------------------------------------
let currentOverrides: LlmOverrides = { provider: "claude-cli" };

// 0682 F-001 — Tracks whether the persistent studio.json selection has been
// loaded for this process lifetime. Initialized to false; set to true once
// loadStudioSelection(root) has been attempted (regardless of whether a file
// existed). Without this flag, the prior gate `if (!currentOverrides.provider)`
// was permanently false (the default `{ provider: "claude-cli" }` already
// populates `provider`), so the persisted selection at .vskill/studio.json
// was silently discarded on every server boot — a CRITICAL regression of
// AC-US1-03 / FR-005.
let studioLoaded = false;

/**
 * 0682 F-001 — Test helper. Resets `currentOverrides` to the default and
 * clears the `studioLoaded` flag so subsequent /api/config calls re-attempt
 * loadStudioSelection. Production code never needs this; it exists solely so
 * vitest can simulate a fresh server boot per-case.
 */
export function resetStudioRestoreState(): void {
  currentOverrides = { provider: "claude-cli" };
  studioLoaded = false;
}

// 0682 CR-001 — Known ProviderName values, used to validate the activeAgent
// string read from .vskill/studio.json before assigning into currentOverrides.
// studio-json.ts only checks `typeof activeAgent === "string"`; without this
// gate a corrupt or version-mismatched file would flow an unknown provider
// into getClient() / PROVIDER_MODELS and produce undefined-key lookups.
const KNOWN_PROVIDER_NAMES: ReadonlySet<ProviderName> = new Set<ProviderName>([
  "anthropic",
  "claude-cli",
  "codex-cli",
  "gemini-cli",
  "lm-studio",
  "ollama",
  "openai",
  "openrouter",
]);

function isKnownProviderName(s: string): s is ProviderName {
  return KNOWN_PROVIDER_NAMES.has(s as ProviderName);
}

/** Return the effective raw model ID (suitable for round-tripping via the API). */
function getEffectiveRawModel(): string {
  if (currentOverrides.model) return currentOverrides.model;
  const provider = (currentOverrides.provider || "claude-cli") as ProviderName;
  return PROVIDER_MODELS[provider]?.[0]?.id || "sonnet";
}

function getClient(): ReturnType<typeof createLlmClient> {
  return createLlmClient(currentOverrides);
}

/** Derive sidebar badge status from benchmark + current eval IDs. */
function computeBenchmarkStatus(
  benchmark: BenchmarkResult | null,
  evalIds: Set<number>,
  hasEvals: boolean,
): "pass" | "fail" | "pending" | "stale" | "missing" {
  if (!benchmark) return hasEvals ? "pending" : "missing";
  if (benchmark.cases.length === 0) return "pending";
  // Stale: benchmark references case IDs that no longer exist in evals
  const isStale = evalIds.size > 0 && !benchmark.cases.every((c) => evalIds.has(c.eval_id));
  if (isStale) return "stale";
  // Use overall_pass_rate as single source of truth
  return (benchmark.overall_pass_rate ?? 0) >= 1 ? "pass" : "fail";
}

interface ModelOption {
  id: string;       // raw model id passed to the provider
  label: string;    // human-readable display name
  pricing?: { prompt: number; completion: number };  // USD per 1M tokens
  // Concrete dated/canonical Anthropic ID this alias resolves to via the
  // catalog snapshot. Populated only on claude-cli rows so the picker can
  // surface "routing to claude-sonnet-4-6" under each generic alias.
  resolvedId?: string;
}

// 0711 — Anthropic models + pricing now derive from the dated catalog
// snapshot at `src/eval/anthropic-catalog.ts`. Manual maintenance of this
// list led to stale prices (Opus 4.7 shown at $15/$75 instead of $5/$25)
// because three different files held copies of the same fact. The catalog
// file is the single source of truth; CI fails if its snapshotDate is
// older than 6 months.
function buildAnthropicProviderModels(): ModelOption[] {
  return ANTHROPIC_CATALOG_SNAPSHOT.models
    .filter((m) => m.status === "active")
    .map((m) => ({
      id: m.id,
      label: `${m.displayName} (API)`,
      pricing: {
        prompt: m.pricing.promptUsdPer1M,
        completion: m.pricing.completionUsdPer1M,
      },
    }));
}

function aliasInfo(alias: string, fallbackLabel: string): { label: string; resolvedId?: string } {
  const entry = findAnthropicModel(alias);
  if (!entry) return { label: fallbackLabel };
  return { label: entry.displayName, resolvedId: entry.id };
}

export const PROVIDER_MODELS: Record<ProviderName, ModelOption[]> = {
  // Opus first so it is the default when no override is set
  // (getEffectiveRawModel returns models[0]). Labels come from the catalog so
  // the picker shows the exact dated version (e.g. "Claude Opus 4.7"), not the
  // bare family name — keeps the Studio truthful when a model is bumped.
  "claude-cli": [
    { id: "opus", ...aliasInfo("opus", "Claude Opus") },
    { id: "sonnet", ...aliasInfo("sonnet", "Claude Sonnet") },
    { id: "haiku", ...aliasInfo("haiku", "Claude Haiku") },
  ],
  "anthropic": buildAnthropicProviderModels(),
  "ollama": [
    { id: "llama3.1:8b", label: "Llama 3.1 8B" },
    { id: "qwen2.5:32b", label: "Qwen 2.5 32B" },
    { id: "gemma2:9b", label: "Gemma 2 9B" },
    { id: "mistral:7b", label: "Mistral 7B" },
  ],
  "gemini-cli": [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  "codex-cli": [
    { id: "o3", label: "OpenAI o3" },
    { id: "o4-mini", label: "OpenAI o4-mini" },
  ],
  "openai": [
    { id: "gpt-4o-mini", label: "GPT-4o mini (API)", pricing: { prompt: 0.15, completion: 0.60 } },
    { id: "gpt-4o", label: "GPT-4o (API)", pricing: { prompt: 2.50, completion: 10 } },
    { id: "gpt-4.1", label: "GPT-4.1 (API)", pricing: { prompt: 2, completion: 8 } },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini (API)", pricing: { prompt: 0.40, completion: 1.60 } },
    { id: "o4-mini", label: "o4-mini (API)", pricing: { prompt: 1.10, completion: 4.40 } },
  ],
  "openrouter": [
    // Anthropic via OpenRouter
    { id: "anthropic/claude-opus-4", label: "Claude Opus 4 (via OpenRouter)" },
    { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (via OpenRouter)" },
    { id: "anthropic/claude-haiku-4", label: "Claude Haiku 4 (via OpenRouter)" },
    // OpenAI via OpenRouter (0698 polish — Anton wants OpenAI first-class)
    { id: "openai/gpt-5", label: "GPT-5 (via OpenRouter)" },
    { id: "openai/gpt-5-mini", label: "GPT-5 mini (via OpenRouter)" },
    { id: "openai/o4-mini", label: "o4-mini (via OpenRouter)" },
    { id: "openai/o3", label: "OpenAI o3 (via OpenRouter)" },
    { id: "openai/gpt-4.1", label: "GPT-4.1 (via OpenRouter)" },
    // Google + Meta
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (via OpenRouter)" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (via OpenRouter)" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (via OpenRouter)" },
  ],
  // LM Studio's default model list is empty because the actual list depends on
  // what models the user has loaded. The probe at probeLmStudio() populates
  // this dynamically from GET /v1/models.
  "lm-studio": [],
};

// ---------------------------------------------------------------------------
// Local provider detection caches — avoid 500ms+ probes on every /api/config
// request. Without the caches, page load blocks on the timeout when the
// local server is not running. TTL is 30s to balance freshness with latency.
//
// Both Ollama and LM Studio share the same TTL and silent-failure semantics
// (probe → non-2xx / throw → `available: false`, no log above debug).
//
// Follow-up (out of scope for 0677): Ollama's upstream standard env var is
// OLLAMA_HOST but this codebase uses OLLAMA_BASE_URL. Do not change here;
// tracked separately.
// ---------------------------------------------------------------------------
const PROBE_CACHE_TTL = 30_000; // re-probe every 30s
let ollamaCache: { available: boolean; models: ModelOption[]; ts: number } | null = null;
let lmStudioCache: { available: boolean; models: ModelOption[]; ts: number } | null = null;

// OpenRouter catalog cache — 10 min TTL per-key (keyed by last-8 of apiKey
// so two keys don't collide and we never store full keys). Exported as a
// module const for tests to reset via resetOpenRouterCache().
//
// 0710 — `pricing.{prompt,completion}` is canonically USD per 1M tokens
// (parity with PROVIDER_MODELS["anthropic"]). OpenRouter's upstream values
// are USD per token and are converted at ingestion in /api/openrouter/models.
type OpenRouterCacheEntry = {
  value: Array<{
    id: string;
    name: string;
    contextWindow?: number;
    /** USD per 1M tokens (canonical wire unit; converted from per-token at ingestion). */
    pricing: { prompt: number; completion: number };
  }>;
  fetchedAt: number;
};
export const OPENROUTER_CACHE = new Map<string, OpenRouterCacheEntry>();
// 0682 F-003 (review iter 2): cap the cache size so a long-running
// multi-tenant server doesn't accumulate one ~30KB entry per distinct API
// key seen since boot. 16 entries is plenty for any realistic deployment
// (single-developer + occasional team-shared studio); FIFO eviction keeps
// the cap simple — true LRU isn't worth the bookkeeping cost.
const OPENROUTER_CACHE_MAX_ENTRIES = 16;
export function evictOldestOpenRouterCacheIfFull(): void {
  if (OPENROUTER_CACHE.size <= OPENROUTER_CACHE_MAX_ENTRIES) return;
  // Map iteration order is insertion order — first key is oldest.
  const firstKey = OPENROUTER_CACHE.keys().next().value;
  if (firstKey !== undefined) OPENROUTER_CACHE.delete(firstKey);
}
export function resetOpenRouterCache(): void {
  OPENROUTER_CACHE.clear();
}

/** Test hook: clear all probe caches so the next detectAvailableProviders() re-probes. */
export function resetDetectionCache(): void {
  ollamaCache = null;
  lmStudioCache = null;
}

async function probeOllama(): Promise<{ available: boolean; models: ModelOption[] }> {
  const now = Date.now();
  if (ollamaCache && now - ollamaCache.ts < PROBE_CACHE_TTL) {
    return ollamaCache;
  }
  let models = PROVIDER_MODELS["ollama"];
  let available = false;
  try {
    const baseUrl = resolveOllamaBaseUrl(process.env);
    const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(500) });
    if (resp.ok) {
      const data = await resp.json() as { models?: Array<{ name: string }> };
      // Only mark available after JSON parses cleanly — protects against 200-with-bad-body proxies.
      available = true;
      if (data.models?.length) {
        models = data.models
          .filter((m): m is { name: string } => typeof m?.name === "string" && m.name.length > 0)
          .map((m) => ({ id: m.name, label: m.name }));
      }
    }
  } catch { /* ollama not running */ }
  ollamaCache = { available, models, ts: now };
  return ollamaCache;
}

// ---------------------------------------------------------------------------
// probeLmStudio — hits GET <base>/models to detect LM Studio and populate the
// model list from the server's loaded models. Mirrors the Ollama pattern:
// 500ms AbortSignal timeout, 30s in-memory cache, silent failure on any
// exception. Base URL is overridable via LM_STUDIO_BASE_URL.
// ---------------------------------------------------------------------------
async function probeLmStudio(): Promise<{ available: boolean; models: ModelOption[] }> {
  const now = Date.now();
  if (lmStudioCache && now - lmStudioCache.ts < PROBE_CACHE_TTL) {
    return lmStudioCache;
  }
  let models: ModelOption[] = PROVIDER_MODELS["lm-studio"];
  let available = false;
  try {
    const baseUrl = process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";
    const resp = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(500) });
    if (resp.ok) {
      const data = await resp.json() as { data?: Array<{ id: string }> };
      // Only mark available after JSON parses cleanly — protects against 200-with-bad-body proxies.
      available = true;
      if (data.data?.length) {
        // Alphabetical sort honors AC-US3-01 (group children ordered alphabetically
        // in the dropdown). LM Studio returns models in load-order, which is unstable.
        models = data.data
          .filter((m): m is { id: string } => typeof m?.id === "string" && m.id.length > 0)
          .map((m) => ({ id: m.id, label: m.id }))
          .sort((a, b) => a.id.localeCompare(b.id));
      }
    }
  } catch { /* lm studio not running */ }
  lmStudioCache = { available, models, ts: now };
  return lmStudioCache;
}

/**
 * Detection block — surfaces wrapper-folder presence and binary availability
 * so the UI can render accurate "installed" dots and "install me" CTAs.
 *
 * Shape is part of the /api/config response (the frontend types.ts is
 * read-only per the 0682 ownership boundary, so the field is carried as
 * opaque JSON and consumed by useAgentCatalog via its own typing).
 */
export interface DetectionInfo {
  wrapperFolders: Record<string, boolean>;
  binaries: Record<string, boolean>;
}

const DETECTION_WRAPPER_FOLDERS = [
  ".claude",
  ".cursor",
  ".codex",
  ".gemini",
  ".github",
  ".zed",
  ".specweave",
];

const DETECTION_BINARIES = ["claude", "cursor", "codex", "gemini"];

let detectionCache: { data: DetectionInfo; ts: number } | null = null;
const DETECTION_CACHE_TTL = 30_000;

export function resetProjectDetectionCache(): void {
  detectionCache = null;
}

/**
 * Scan the project root for known agent wrapper folders and the system
 * PATH for known agent binaries. Cheap synchronous scan (`existsSync` +
 * `which`) cached for 30 s so repeated `/api/config` polls don't burn CPU.
 */
export function detectProjectAgents(root: string): DetectionInfo {
  const now = Date.now();
  if (detectionCache && now - detectionCache.ts < DETECTION_CACHE_TTL) {
    return detectionCache.data;
  }

  const wrapperFolders: Record<string, boolean> = {};
  for (const folder of DETECTION_WRAPPER_FOLDERS) {
    try {
      wrapperFolders[folder] = existsSync(join(root, folder));
    } catch {
      wrapperFolders[folder] = false;
    }
  }

  const binaries: Record<string, boolean> = {};
  for (const bin of DETECTION_BINARIES) {
    binaries[bin] = isBinaryOnPath(bin);
  }

  const data: DetectionInfo = { wrapperFolders, binaries };
  detectionCache = { data, ts: now };
  return data;
}

function isBinaryOnPath(name: string): boolean {
  try {
    const cmd = process.platform === "win32" ? `where ${name}` : `command -v ${name}`;
    execSync(cmd, { stdio: "ignore", timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

// 0701 — Read the active Claude Code model from ~/.claude/settings.json so the
// Studio picker can surface "routing to claude-opus-4-7[1m]" under the generic
// Claude Code rows. Returns null on any read/parse failure — callers fall back
// to generic aliases. Re-read on every call (no caching) so toggling /model in
// Claude Code is reflected on the next picker open.
export function resolveClaudeCodeModel(): string | null {
  try {
    const path = join(homedir(), ".claude", "settings.json");
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const model = (parsed as { model?: unknown }).model;
    return typeof model === "string" && model.length > 0 ? model : null;
  } catch {
    return null;
  }
}

export async function detectAvailableProviders(): Promise<Array<{
  id: ProviderName;
  label: string;
  available: boolean;
  models: ModelOption[];
  resolvedModel?: string | null;
}>> {
  const providers: Array<{
    id: ProviderName;
    label: string;
    available: boolean;
    models: ModelOption[];
    resolvedModel?: string | null;
  }> = [];

  // Claude CLI — delegates to the `claude` binary; the CLI owns session auth.
  // See src/eval/llm.ts createClaudeCliClient compliance doc-block.
  providers.push({
    id: "claude-cli",
    label: "Use current Claude Code session",
    available: true,
    models: PROVIDER_MODELS["claude-cli"],
    resolvedModel: resolveClaudeCodeModel(),
  });

  // Anthropic API — available if ANTHROPIC_API_KEY is set OR a key is in the
  // settings-store. After 0702 the tier concept is gone; storage is file-only.
  providers.push({
    id: "anthropic",
    label: "Anthropic API",
    available:
      !!process.env.ANTHROPIC_API_KEY ||
      settingsStore.hasKeySync("anthropic"),
    models: PROVIDER_MODELS["anthropic"],
  });

  // OpenAI API — available if OPENAI_API_KEY is set OR a key is stored (0702 T-023).
  providers.push({
    id: "openai",
    label: "OpenAI API",
    available:
      !!process.env.OPENAI_API_KEY ||
      settingsStore.hasKeySync("openai"),
    models: PROVIDER_MODELS["openai"],
  });

  // OpenRouter — available if OPENROUTER_API_KEY is set OR a key is stored.
  providers.push({
    id: "openrouter",
    label: "OpenRouter",
    available:
      !!process.env.OPENROUTER_API_KEY ||
      settingsStore.hasKeySync("openrouter"),
    models: PROVIDER_MODELS["openrouter"],
  });

  // Local providers (Ollama + LM Studio) — cached probes fired in parallel so
  // total detection time stays ≤ 550ms even if both time out.
  const [ollama, lmStudio] = await Promise.all([probeOllama(), probeLmStudio()]);

  providers.push({
    id: "ollama",
    label: "Ollama (local, free)",
    available: ollama.available,
    models: ollama.models,
  });

  providers.push({
    id: "lm-studio",
    label: "LM Studio (local, free)",
    available: lmStudio.available,
    models: lmStudio.models,
  });

  return providers;
}

export function registerRoutes(router: Router, root: string, projectName?: string): void {
  // Health check
  router.get("/api/health", (_req, res) => {
    sendJson(res, { ok: true });
  });

  // Installed agents — returns all 49 known agents with installed flag
  router.get("/api/agents/installed", async (_req, res) => {
    try {
      const detected = await detectInstalledAgents();
      sendJson(res, buildInstalledAgentsResponse(detected), 200, _req);
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500, _req);
    }
  });

  // 0686 — /api/agents: agents with filesystem presence + per-agent counts +
  // shared-folder grouping. 30s detection cache (mirrors Ollama/LM Studio
  // probe pattern from 0677).
  router.get("/api/agents", async (req, res) => {
    try {
      const detected = await detectInstalledAgents();
      const detectedBinaries = new Set(detected.map((a) => a.id));
      const data = await buildAgentsResponse({ root, detectedBinaries });
      sendJson(res, data, 200, req);
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500, req);
    }
  });

  // Server-Sent Events endpoint for data change notifications
  // Clients subscribe here to receive push updates when benchmarks complete,
  // history is written, or leaderboard is updated.
  router.get("/api/events", (req, res) => {
    initSSE(res, req);

    const onBenchmarkComplete = (payload: unknown) => {
      sendSSE(res, "benchmark:complete", payload ?? {});
    };
    const onHistoryWritten = (payload: unknown) => {
      sendSSE(res, "history:written", payload ?? {});
    };
    const onLeaderboardUpdated = (payload: unknown) => {
      sendSSE(res, "leaderboard:updated", payload ?? {});
    };

    dataEventBus.on("benchmark:complete", onBenchmarkComplete);
    dataEventBus.on("history:written", onHistoryWritten);
    dataEventBus.on("leaderboard:updated", onLeaderboardUpdated);

    const cleanup = () => {
      dataEventBus.off("benchmark:complete", onBenchmarkComplete);
      dataEventBus.off("history:written", onHistoryWritten);
      dataEventBus.off("leaderboard:updated", onLeaderboardUpdated);
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
  });

  // OpenRouter model search proxy — 10-minute in-memory cache keyed by the
  // last-8 chars of the API key so different keys don't collide while the
  // key itself is never stored in the cache map. Stale cache served (with
  // X-Vskill-Catalog-Age header) when upstream is down.
  router.get("/api/openrouter/models", async (_req, res) => {
    const envKey = process.env.OPENROUTER_API_KEY;
    const storedKey = settingsStore.readKeySync("openrouter");
    const apiKey = envKey || storedKey;
    if (!apiKey) {
      sendJson(res, { error: "OPENROUTER_API_KEY not configured" }, 400);
      return;
    }
    const cacheKey = apiKey.slice(-8);
    const now = Date.now();
    const cached = OPENROUTER_CACHE.get(cacheKey);
    const CACHE_TTL_MS = 600_000; // 10 min

    // Fresh cache hit — serve immediately without upstream.
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      const ageSec = Math.floor((now - cached.fetchedAt) / 1000);
      res.setHeader?.("X-Vskill-Catalog-Age", String(ageSec));
      sendJson(res, { models: cached.value, ageSec });
      return;
    }

    try {
      const resp = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        if (cached) {
          const ageSec = Math.floor((now - cached.fetchedAt) / 1000);
          res.setHeader?.("X-Vskill-Catalog-Age", String(ageSec));
          sendJson(res, { models: cached.value, ageSec, stale: true });
          return;
        }
        sendJson(res, { error: `OpenRouter API returned ${resp.status}` }, 502);
        return;
      }
      const data = (await resp.json()) as {
        data?: Array<{
          id: string;
          name?: string;
          context_length?: number;
          pricing?: { prompt?: string; completion?: string };
        }>;
      };
      const models = (data.data || []).map((m) => ({
        id: m.id,
        name: m.name || m.id,
        contextWindow: typeof m.context_length === "number" ? m.context_length : undefined,
        // 0710 — OpenRouter publishes USD per token; canonicalize to USD per 1M
        // tokens so the wire contract matches PROVIDER_MODELS["anthropic"]
        // (3, 15, 75, …) and every consumer can assume one unit.
        pricing: {
          prompt: parseFloat(m.pricing?.prompt || "0") * 1_000_000,
          completion: parseFloat(m.pricing?.completion || "0") * 1_000_000,
        },
      }));
      OPENROUTER_CACHE.set(cacheKey, { value: models, fetchedAt: now });
      // 0682 F-003 (review iter 2): bound cache size to avoid unbounded
      // growth on long-running shared servers.
      evictOldestOpenRouterCacheIfFull();
      res.setHeader?.("X-Vskill-Catalog-Age", "0");
      sendJson(res, { models, ageSec: 0 });
    } catch (err) {
      if (cached) {
        const ageSec = Math.floor((now - cached.fetchedAt) / 1000);
        res.setHeader?.("X-Vskill-Catalog-Age", String(ageSec));
        sendJson(res, { models: cached.value, ageSec, stale: true });
        return;
      }
      sendJson(res, { error: (err as Error).message }, 500);
    }
  });

  // Settings / API key endpoints (0682 — US-004).
  // Keys live on-device only. Never logged, never synced, never returned
  // through GET. Response includes only metadata (stored, updatedAt, tier).
  router.get("/api/settings/keys", async (_req, res) => {
    sendJson(res, settingsStore.listKeys());
  });

  // 0702 T-024: expose the absolute keys.env path for the Settings footer +
  // "Copy path" button. Key contents are NEVER returned — path only.
  router.get("/api/settings/storage-path", async (_req, res) => {
    sendJson(res, { path: settingsStore.getKeysFilePath() });
  });

  router.post("/api/settings/keys", async (req, res) => {
    // Reject any request that smuggles the key in a query-string — JSON body only.
    const url = (req as unknown as { url?: string }).url || "";
    if (/[?&]key=/.test(url)) {
      sendJson(res, { error: "key must not appear in query string" }, 400);
      return;
    }
    const body = (await readBody(req)) as {
      provider?: string;
      key?: string;
    };
    if (!body.key || typeof body.key !== "string" || body.key.trim().length === 0) {
      sendJson(res, { error: "key must be non-empty string" }, 400);
      return;
    }
    if (typeof body.provider !== "string" || !isProviderId(body.provider)) {
      sendJson(res, { error: `unknown provider: ${String(body.provider)}` }, 400);
      return;
    }
    const providerId = body.provider as ProviderId;
    try {
      const saved = await settingsStore.saveKey(providerId, body.key.trim());
      // Prefix hint — non-blocking, purely informational. Sourced from PROVIDERS
      // so adding a provider later automatically extends the warning.
      const descriptor = getProviderById(providerId);
      const warning =
        descriptor.keyPrefix && !body.key.startsWith(descriptor.keyPrefix)
          ? `key doesn't match typical ${descriptor.label} prefix ${descriptor.keyPrefix}`
          : undefined;
      sendJson(res, {
        ok: true,
        updatedAt: saved.updatedAt,
        available: true,
        ...(warning ? { warning } : {}),
      });
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500);
    }
  });

  router.delete("/api/settings/keys/:provider", async (_req, res, params) => {
    const provider = params.provider;
    if (typeof provider !== "string" || !isProviderId(provider)) {
      sendJson(res, { error: `unknown provider: ${String(provider)}` }, 400);
      return;
    }
    await settingsStore.removeKey(provider);
    sendJson(res, { ok: true });
  });

  // Migration — one-shot copy from pre-0702 macOS Keychain into the file store.
  // Non-Darwin platforms short-circuit inside the migrator (no spawn).
  router.get("/api/settings/migration-status", async (_req, res) => {
    try {
      const migrator = new DarwinKeychainMigrator();
      const availability = await migrator.available();
      sendJson(res, {
        hasLegacyKeys: availability.hasLegacyKeys,
        providers: availability.providers,
        ackStatus: availability.ackStatus ?? null,
      });
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500);
    }
  });

  router.post("/api/settings/migration/perform", async (_req, res) => {
    try {
      const migrator = new DarwinKeychainMigrator();
      const result = await migrator.migrate();
      sendJson(res, { migrated: result.migrated });
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500);
    }
  });

  router.post("/api/settings/migration/acknowledge", async (_req, res) => {
    try {
      const migrator = new DarwinKeychainMigrator();
      await migrator.acknowledge();
      sendJson(res, { ok: true });
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500);
    }
  });

  // Config — expose current provider/model + available providers + project
  // IMPORTANT: Return raw model IDs (e.g. "sonnet"), NOT display models
  // (e.g. "claude-sonnet"). The frontend round-trips config.model back to
  // generate-evals and other endpoints, so it must be a valid CLI model ID.
  router.get("/api/config", async (_req, res) => {
    // 0682 F-001 — Boot-time restoration of .vskill/studio.json selection.
    // Use a dedicated `studioLoaded` flag rather than checking
    // `!currentOverrides.provider` because the module default
    // `{ provider: "claude-cli" }` would make the prior guard permanently
    // false, silently discarding the persisted selection on every boot.
    if (!studioLoaded) {
      // 0682 CR-0682-M1 — Wrap loadStudioSelection() in its own try/catch
      // and set `studioLoaded = true` ONLY after the load attempt completes.
      // Pre-fix the flag was flipped before the call, so any thrown error
      // (fs, permissions, malformed JSON path inside the loader) would
      // permanently mask studio.json for the process lifetime — exactly the
      // same class of bug as the F-001 it tried to remedy. Now: on success
      // OR clean miss, mark loaded; on thrown error, log and leave the flag
      // unset so the next request retries.
      try {
        const stored = loadStudioSelection(root);
        if (stored) {
          // 0682 CR-001 — Validate the persisted activeAgent against the
          // ProviderName union before mutating currentOverrides. A tampered
          // or version-mismatched studio.json (e.g. "unknown", "claude-code",
          // or arbitrary text) silently falls back to the claude-cli default
          // rather than poisoning getClient() lookups downstream.
          if (isKnownProviderName(stored.activeAgent)) {
            currentOverrides.provider = stored.activeAgent;
            if (stored.activeModel) currentOverrides.model = stored.activeModel;
          } else {
            console.warn(
              `[studio.json] Ignoring unknown activeAgent "${stored.activeAgent}" — falling back to claude-cli`,
            );
          }
        }
        studioLoaded = true;
      } catch (e) {
        console.warn(
          `[studio.json] load failed: ${(e as Error).message} — will retry on next /api/config request`,
        );
        // Intentionally leave studioLoaded=false so transient FS errors don't
        // permanently mask the persisted selection.
      }
    }
    try {
      // Validate the client can be created (catches missing API keys etc.)
      getClient();
      const providers = await detectAvailableProviders();
      const detection = detectProjectAgents(root);
      sendJson(res, {
        provider: currentOverrides.provider || null,
        model: getEffectiveRawModel(),
        providers,
        detection,
        projectName: projectName || null,
        root,
      });
    } catch (err) {
      const providers = await detectAvailableProviders().catch(() => []);
      const detection = detectProjectAgents(root);
      sendJson(res, {
        provider: null,
        model: "unknown",
        error: (err as Error).message,
        providers,
        detection,
        projectName: projectName || null,
        root,
      });
    }
  });

  // Update config — change provider/model at runtime and persist atomically.
  router.post("/api/config", async (req, res) => {
    const body = (await readBody(req)) as { provider?: ProviderName; model?: string };

    // 0682 F-001 (review iter 3): validate the incoming provider against the
    // ProviderName union BEFORE mutating currentOverrides. Pre-fix, an
    // unknown provider was eagerly applied and only caught downstream by
    // `getClient()`, where a hard reset to claude-cli destroyed any prior
    // valid in-memory selection. Now: reject early with 400 and leave the
    // existing selection intact.
    if (body.provider !== undefined && !isKnownProviderName(body.provider)) {
      sendJson(res, { error: `unknown provider: ${String(body.provider)}` }, 400, req);
      return;
    }

    // 0682 F-001 (review iter 3): snapshot the prior selection so we can
    // restore it on validation failure, rather than zapping everything to
    // the default. Spec semantics: a failed POST should leave the previous
    // good state intact.
    const priorOverrides = { ...currentOverrides };

    if (body.provider) currentOverrides.provider = body.provider;
    if (body.model) currentOverrides.model = body.model;
    // If provider changed but no model, clear model override so it uses the provider default
    if (body.provider && !body.model) delete currentOverrides.model;

    try {
      // Validate the client can be created
      getClient();
      const providers = await detectAvailableProviders();
      // Persist to .vskill/studio.json (atomic tmp-then-rename). Fire-and-forget
      // from the handler's perspective — errors are logged but not surfaced,
      // matching how currentOverrides already survives process lifetime.
      if (currentOverrides.provider) {
        try {
          await saveStudioSelection(root, {
            activeAgent: currentOverrides.provider,
            activeModel: getEffectiveRawModel(),
            updatedAt: new Date().toISOString(),
          });
        } catch (e) {
          console.warn(`[studio.json] atomic write failed: ${(e as Error).message}`);
        }
      }
      sendJson(res, { provider: currentOverrides.provider || null, model: getEffectiveRawModel(), providers });
    } catch (err) {
      // 0682 F-001 (review iter 3): revert to the prior good selection, NOT
      // the hard-coded claude-cli default. Pre-fix any failed POST silently
      // wiped the user's prior valid choice.
      currentOverrides = priorOverrides;
      sendJson(res, { error: (err as Error).message }, 400, req);
    }
  });

  // List all skills
  //
  // Response contract (see src/eval-ui/src/types.ts → SkillInfo):
  //   - `origin` is GUARANTEED non-null (T-021). Derived from classifyOrigin()
  //     in src/eval/skill-scanner.ts — the SSoT. Never recomputed here.
  //   - Frontmatter + filesystem fields (T-025) are included when resolvable;
  //     unknown/missing fields default to `null` (not undefined) so the shape
  //     remains JSON-stable for all consumers.
  router.get("/api/skills", async (req, res) => {
    // 0686: ?scope=own|installed|global and ?agent=<id> query params.
    // When either is present, switch to tri-scope scanning so the response
    // carries the new `scope`/`isSymlink`/`symlinkTarget`/`installMethod`/
    // `sourceAgent` fields. With no filter, we stay on the legacy two-scope
    // path AND still layer the tri-scope enrichment on top so the UI gets a
    // consistent shape either way.
    const url = new URL(req.url ?? "/api/skills", "http://localhost");
    const rawScope = url.searchParams.get("scope") ?? undefined;
    const rawAgent = url.searchParams.get("agent") ?? undefined;

    // Determine which agent's global scope to scan. When the caller doesn't
    // specify one, default to the suggested agent from buildAgentsResponse —
    // that's usually claude-code but falls back to the first detected agent.
    let activeAgent = rawAgent;
    if (!activeAgent) {
      try {
        const detected = await detectInstalledAgents();
        const resp = await buildAgentsResponse({
          root,
          detectedBinaries: new Set(detected.map((a) => a.id)),
        });
        activeAgent = resp.suggested;
      } catch {
        activeAgent = "claude-code";
      }
    }

    // 0698 T-002/T-004/T-005: merge legacy tri-scope scan with the two new
    // plugin scanners (installed plugin cache + authored plugin sources).
    // scanSkillsTriScope already attaches `scopeV2`/`group`/`source` via
    // `enrichAndComputePrecedence`. The plugin scanners return rows already
    // tagged `scopeV2="available-plugin"` / `"authoring-plugin"`.
    const [triScopeSkills, installedPluginSkills, authoredPluginSkills] = await Promise.all([
      scanSkillsTriScope(root, { agentId: activeAgent }),
      Promise.resolve(scanInstalledPluginSkills({ agentId: activeAgent })),
      Promise.resolve(scanAuthoredPluginSkills({ agentId: activeAgent, projectRoot: root })),
    ]);
    const skills: SkillInfo[] = [
      ...triScopeSkills,
      ...installedPluginSkills,
      ...authoredPluginSkills,
    ];
    const enriched = await Promise.all(
      skills.map(async (s) => {
        let evalCount = 0;
        let assertionCount = 0;
        let evalIds: Set<number> = new Set();
        try {
          const evals = loadAndValidateEvals(s.dir);
          evalCount = evals.evals.length;
          assertionCount = evals.evals.reduce((sum, e) => sum + e.assertions.length, 0);
          evalIds = new Set(evals.evals.map((e) => e.id));
        } catch { /* no evals */ }
        const benchmark = await readBenchmark(s.dir);
        const meta = buildSkillMetadata(s.dir, s.origin, root);
        const origin = s.origin ?? classifyOrigin(s.dir, root);
        // Preserve scanner-derived sourceAgent (populated for installed + global
        // scopes) over the metadata-derived one which only covers local wrappers.
        const sourceAgent = s.sourceAgent ?? meta.sourceAgent;
        return {
          ...s,
          origin,
          scope: s.scope ?? (origin === "installed" ? "installed" : "own"),
          isSymlink: s.isSymlink ?? false,
          symlinkTarget: s.symlinkTarget ?? null,
          installMethod: s.installMethod ?? (origin === "installed" ? "copied" : "authored"),
          evalCount,
          assertionCount,
          benchmarkStatus: computeBenchmarkStatus(benchmark, evalIds, s.hasEvals),
          lastBenchmark: benchmark?.timestamp ?? null,
          // T-025: frontmatter + filesystem + sourceAgent, all nullable
          description: meta.description,
          version: meta.version,
          category: meta.category,
          author: meta.author,
          license: meta.license,
          homepage: meta.homepage,
          tags: meta.tags,
          deps: meta.deps,
          mcpDeps: meta.mcpDeps,
          entryPoint: meta.entryPoint,
          lastModified: meta.lastModified,
          sizeBytes: meta.sizeBytes,
          sourceAgent,
          // 0737: source-repo provenance — drives the Studio detail header's
          // clickable GitHub anchor. Both fields default to null when no
          // lockfile entry / no github source is known.
          repoUrl: meta.repoUrl,
          skillPath: meta.skillPath,
        };
      }),
    );
    // 0733: filter MUST use the resolved `activeAgent` (not the raw query
    // param). The handler scans the global scope using `activeAgent` — if the
    // filter keeps using `rawAgent`, the server scans for one agent but
    // returns skills from ALL of them (the .aider/ .cursor/ etc. leak).
    const filtered = filterSkillsByScopeAndAgent(enriched, {
      scope: rawScope,
      agent: activeAgent,
    });
    sendJson(res, filtered, 200, req);
  });

  // Check for skill updates via `vskill outdated --json`
  router.get("/api/skills/updates", async (req, res) => {
    try {
      const raw = execSync("vskill outdated --json", {
        timeout: 15_000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
      });
      const parsed = JSON.parse(raw);
      sendJson(res, Array.isArray(parsed) ? parsed : [], 200, req);
    } catch (e) {
      // vskill outdated exits 1 when updates exist — stdout still has JSON
      const stdout = e && typeof e === "object" && "stdout" in e ? (e as { stdout: unknown }).stdout : null;
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout as string);
          sendJson(res, Array.isArray(parsed) ? parsed : [], 200, req);
          return;
        } catch { /* fall through */ }
      }
      sendJson(res, [], 200, req);
    }
  });

  // -------------------------------------------------------------------------
  // Version proxy, diff, update, and batch-update routes (Phase 2)
  // MUST be registered BEFORE the /:plugin/:skill catch-all below.
  // -------------------------------------------------------------------------

  const PLATFORM_BASE = "https://verified-skill.com";

  /**
   * Resolve plugin/skill to full hierarchical API name. Lockfile path first
   * (installed skills); falls back to authored-skill discovery on disk +
   * git remote parse for skills authored in this repo. See skill-name-resolver.ts.
   */
  function resolveSkillApiName(skill: string): Promise<string> {
    return resolveSkillApiNameImpl(skill, root);
  }

  // T-009 (proxy) + 0707 T-021 (harden): Versions endpoint
  //
  // Envelope:  { versions: VersionEntry[], count: number, source: "platform" | "none" }
  //   - source:"platform" → remote Verified-Skill platform responded
  //   - source:"none"     → skill has no VCS surface (local fixture, platform
  //                         unreachable, or platform returned non-OK). In this
  //                         case the `X-Skill-VCS: unavailable` response header
  //                         is also emitted so the UI can badge the skill as
  //                         "no version history" without treating it as an error.
  //
  // Never returns 5xx for the "no VCS surface" case — that is normal empty state.
  router.get("/api/skills/:plugin/:skill/versions", async (req, res, params) => {
    const fullName = await resolveSkillApiName(params.skill);
    const parts = fullName.split("/");
    const apiPath = parts.length === 3
      ? `/api/v1/skills/${parts.map(encodeURIComponent).join("/")}/versions`
      : `/api/v1/skills/${encodeURIComponent(fullName)}/versions`;

    const emptyEnvelope = () => {
      res.setHeader("X-Skill-VCS", "unavailable");
      sendJson(res, { versions: [], count: 0, source: "none" }, 200, req);
    };

    let fetchResp: Response;
    try {
      fetchResp = await fetch(`${PLATFORM_BASE}${apiPath}`, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Network failure / timeout / no VCS surface → empty envelope, not 502.
      emptyEnvelope();
      return;
    }

    if (!fetchResp.ok) {
      emptyEnvelope();
      return;
    }

    let data: { versions?: unknown[] };
    try {
      data = (await fetchResp.json()) as { versions?: unknown[] };
    } catch {
      emptyEnvelope();
      return;
    }
    const versions = Array.isArray(data.versions) ? data.versions : [];

    // Enrich with isInstalled from lockfile
    const lock = readLockfile();
    const installedVersion = lock?.skills[params.skill]?.version;
    const enriched = versions.map((v: any) => ({
      ...v,
      isInstalled: installedVersion ? v.version === installedVersion : undefined,
    }));

    sendJson(
      res,
      { versions: enriched, count: enriched.length, source: "platform" },
      200,
      req,
    );
  });

  // T-010: Diff proxy route
  router.get("/api/skills/:plugin/:skill/versions/diff", async (req, res, params) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!from || !to) {
      sendJson(res, { error: "Missing required query params: from and to" }, 400, req);
      return;
    }

    const fullName = await resolveSkillApiName(params.skill);
    const parts = fullName.split("/");
    const basePath = parts.length === 3
      ? `/api/v1/skills/${parts.map(encodeURIComponent).join("/")}/versions/diff`
      : `/api/v1/skills/${encodeURIComponent(fullName)}/versions/diff`;

    try {
      const resp = await fetch(
        `${PLATFORM_BASE}${basePath}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!resp.ok) {
        sendJson(res, { error: "Platform API unavailable" }, 502, req);
        return;
      }
      const data = await resp.json();
      sendJson(res, data, 200, req);
    } catch {
      sendJson(res, { error: "Platform API unavailable" }, 502, req);
    }
  });

  // T-011: Single-skill update SSE endpoint
  router.post("/api/skills/:plugin/:skill/update", async (req, res, params) => {
    initSSE(res, req);
    const skillName = params.skill;

    sendSSE(res, "progress", { status: "updating", skill: skillName });

    try {
      execSync(`vskill update ${skillName}`, {
        timeout: 60_000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      sendSSE(res, "progress", { status: "done", skill: skillName });
      sendSSEDone(res, { status: "done", skill: skillName });
    } catch (err) {
      sendSSE(res, "error", { error: (err as Error).message, skill: skillName });
      sendSSEDone(res, { status: "error", skill: skillName });
    }
  });

  // T-012: Batch update SSE + 409 conflict guard
  let batchUpdateInProgress = false;

  router.post("/api/skills/batch-update", async (req, res) => {
    if (batchUpdateInProgress) {
      sendJson(res, { error: "Update already in progress" }, 409, req);
      return;
    }
    batchUpdateInProgress = true;

    const body = (await readBody(req)) as { skills?: string[] };
    const skills = Array.isArray(body.skills) ? body.skills : [];

    initSSE(res, req);

    let updated = 0;
    let failed = 0;

    try {
      for (const skill of skills) {
        sendSSE(res, "skill:start", { skill });

        try {
          execSync(`vskill update ${skill}`, {
            timeout: 60_000,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
          });
          sendSSE(res, "skill:done", { skill });
          updated++;
        } catch (err) {
          sendSSE(res, "skill:error", { skill, error: (err as Error).message });
          failed++;
        }
      }

      sendSSEDone(res, { updated, failed, skipped: 0 });
    } finally {
      batchUpdateInProgress = false;
    }
  });

  // Get skill detail
  router.get("/api/skills/:plugin/:skill", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const skillMdPath = join(skillDir, "SKILL.md");
    let skillContent = "";
    try {
      skillContent = readFileSync(skillMdPath, "utf-8");
    } catch { /* no SKILL.md */ }
    sendJson(res, { plugin: params.plugin, skill: params.skill, skillContent }, 200, req);
  });

  // List all files in a skill directory (recursive, flat list)
  router.get("/api/skills/:plugin/:skill/files", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    if (!resolve(skillDir).startsWith(resolve(root))) {
      sendJson(res, { error: "Invalid skill path" }, 400, req);
      return;
    }
    if (!existsSync(skillDir)) {
      sendJson(res, { error: "Skill directory not found" }, 404, req);
      return;
    }

    const EXCLUDE = new Set([".git", "node_modules", ".DS_Store"]);
    const MAX_ENTRIES = 200;
    const MAX_DEPTH = 5;
    const entries: Array<{ path: string; size: number; type: "file" | "dir" }> = [];

    function walk(dir: string, prefix: string, depth: number): void {
      if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;
      let items: import("node:fs").Dirent<string>[];
      try {
        items = readdirSync(dir, { withFileTypes: true, encoding: "utf-8" });
      } catch { return; }
      for (const item of items) {
        if (EXCLUDE.has(item.name)) continue;
        if (entries.length >= MAX_ENTRIES) break;
        const relPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) {
          entries.push({ path: relPath, size: 0, type: "dir" });
          walk(join(dir, item.name), relPath, depth + 1);
        } else {
          let size = 0;
          try { size = statSync(join(dir, item.name)).size; } catch { /* ignore */ }
          entries.push({ path: relPath, size, type: "file" });
        }
      }
    }

    walk(skillDir, "", 0);

    // Sort: SKILL.md first, then dirs before files, then alphabetical
    entries.sort((a, b) => {
      if (a.path === "SKILL.md") return -1;
      if (b.path === "SKILL.md") return 1;
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    sendJson(res, { files: entries }, 200, req);
  });

  // Read any file in a skill directory (with path traversal protection)
  router.get("/api/skills/:plugin/:skill/file", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    if (!resolve(skillDir).startsWith(resolve(root))) {
      sendJson(res, { error: "Invalid skill path" }, 400, req);
      return;
    }

    const url = new URL(req.url ?? "", "http://localhost");
    const filePath = url.searchParams.get("path") ?? "";
    if (!filePath) {
      sendJson(res, { error: "Missing path query parameter" }, 400, req);
      return;
    }

    const fullPath = resolve(join(skillDir, filePath));
    if (!fullPath.startsWith(resolve(skillDir))) {
      sendJson(res, { error: "Access denied" }, 403, req);
      return;
    }

    if (!existsSync(fullPath)) {
      sendJson(res, { error: "File not found" }, 404, req);
      return;
    }

    let size = 0;
    try { size = statSync(fullPath).size; } catch { /* ignore */ }

    const MAX_SIZE = 1024 * 1024; // 1MB hard limit
    const TRUNCATE_AT = 512 * 1024; // 500KB soft truncation

    if (size > MAX_SIZE) {
      sendJson(res, { error: "File too large", path: filePath, size }, 413, req);
      return;
    }

    // Binary detection: check first 8KB for null bytes
    let buf: Buffer;
    try {
      buf = readFileSync(fullPath);
    } catch (err) {
      sendJson(res, { error: `Unable to read file: ${(err as Error).message}` }, 500, req);
      return;
    }

    const probe = buf.subarray(0, Math.min(8192, buf.length));
    for (let i = 0; i < probe.length; i++) {
      if (probe[i] === 0) {
        sendJson(res, { path: filePath, binary: true, size }, 200, req);
        return;
      }
    }

    const truncated = buf.length > TRUNCATE_AT;
    const content = (truncated ? buf.subarray(0, TRUNCATE_AT) : buf).toString("utf-8");
    sendJson(res, { path: filePath, content, size, truncated: truncated || undefined }, 200, req);
  });

  // Save (create/overwrite) a file inside a skill directory
  router.put("/api/skills/:plugin/:skill/file", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    if (!resolve(skillDir).startsWith(resolve(root))) {
      sendJson(res, { error: "Invalid skill path" }, 400, req);
      return;
    }

    const body = (await readBody(req)) as { path?: string; content?: string };
    const filePath = body.path ?? "";
    if (!filePath) {
      sendJson(res, { error: "Missing path field" }, 400, req);
      return;
    }
    if (typeof body.content !== "string") {
      sendJson(res, { error: "Missing content field" }, 400, req);
      return;
    }

    const fullPath = resolve(join(skillDir, filePath));
    if (!fullPath.startsWith(resolve(skillDir))) {
      sendJson(res, { error: "Path traversal denied" }, 403, req);
      return;
    }

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, body.content, "utf-8");
    const size = Buffer.byteLength(body.content, "utf-8");
    sendJson(res, { ok: true, path: filePath, size }, 200, req);
  });

  // Delete a source skill (recursively removes its directory)
  router.delete("/api/skills/:plugin/:skill", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    // Path containment guard — prevent path traversal via ".." in params
    if (!resolve(skillDir).startsWith(resolve(root))) {
      sendJson(res, { error: "Invalid skill path" }, 400, req);
      return;
    }
    if (resolve(skillDir) === resolve(root)) {
      sendJson(res, { error: "Cannot delete the root skill directory" }, 403, req);
      return;
    }
    if (!existsSync(skillDir)) {
      sendJson(res, { error: "Skill directory not found" }, 404, req);
      return;
    }
    const origin = classifyOrigin(skillDir, root);
    if (origin === "installed") {
      sendJson(res, { error: "Cannot delete installed (read-only) skill" }, 403, req);
      return;
    }
    try {
      // 0722: route to OS trash (Trash / Recycle Bin / XDG) instead of hard delete
      // so accidental deletes are recoverable from the user's native Trash app.
      const trash = (await import("trash")).default;
      await trash([skillDir]);
      sendJson(res, { ok: true, deleted: `${params.plugin}/${params.skill}` }, 200, req);
    } catch (err) {
      sendJson(res, { error: `Failed to delete skill: ${(err as Error).message}` }, 500, req);
    }
  });

  // Get skill description (for activation testing preview)
  router.get("/api/skills/:plugin/:skill/description", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const skillMdPath = join(skillDir, "SKILL.md");
    let skillContent = "";
    try {
      skillContent = readFileSync(skillMdPath, "utf-8");
    } catch { /* no SKILL.md */ }
    const descMatch = skillContent.match(/^---[\s\S]*?description:\s*"([^"]+)"[\s\S]*?---/);
    const description = descMatch ? descMatch[1] : skillContent.slice(0, 500);
    sendJson(res, { description, rawContent: skillContent }, 200, req);
  });

  // Get evals.json
  //
  // Envelope (0707 T-023 / T-025):
  //   200 { exists: false, evals: [] }      when evals.json is missing
  //   200 { exists: true,  ...EvalsFile }   when valid (evals[], skill_name, …)
  //   422 { error, errors[] }               when malformed / fails schema
  //   500 { error }                         only for unexpected I/O failures
  //
  // "missing" must be distinguishable from "malformed" so the UI can render
  // the former as an empty-state CTA ("Create evals") and the latter as a
  // validation error panel. The earlier 400 status conflated malformed with
  // generic client errors — 422 Unprocessable Entity is the correct semantic
  // for well-formed requests whose payload fails validation.
  router.get("/api/skills/:plugin/:skill/evals", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const evalsPath = join(skillDir, "evals", "evals.json");
    if (!existsSync(evalsPath)) {
      // 0704: 200 empty-state sentinel (was 404) — "no evals.json yet" is
      // authoring empty state, not an error the client has to filter.
      sendJson(res, { exists: false, evals: [] }, 200, req);
      return;
    }
    try {
      const evals = loadAndValidateEvals(skillDir);
      sendJson(res, { exists: true, ...evals }, 200, req);
    } catch (err) {
      if (err instanceof EvalValidationError) {
        // 0707 T-023: malformed → 422 (was 400).
        sendJson(res, { error: err.message, errors: err.errors }, 422, req);
      } else {
        sendJson(res, { error: String((err as Error).message) }, 500, req);
      }
    }
  });

  // Save evals.json
  router.put("/api/skills/:plugin/:skill/evals", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const body = (await readBody(req)) as EvalsFile;

    // Validate before writing
    const errors = validateEvalsBody(body);
    if (errors.length > 0) {
      sendJson(res, { error: "Validation failed", errors }, 400, req);
      return;
    }

    const evalsDir = join(skillDir, "evals");
    mkdirSync(evalsDir, { recursive: true });
    const filePath = join(evalsDir, "evals.json");
    writeFileSync(filePath, JSON.stringify(body, null, 2), "utf-8");
    sendJson(res, body, 200, req);
  });

  // Generate evals using AI — reads SKILL.md and returns generated EvalsFile
  // Accepts optional { provider, model, testType } in request body
  router.post("/api/skills/:plugin/:skill/generate-evals", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const skillMdPath = join(skillDir, "SKILL.md");

    if (!existsSync(skillMdPath)) {
      sendJson(res, { error: "SKILL.md not found — cannot generate evals without skill content" }, 400, req);
      return;
    }

    const wantsSSE = req.headers.accept?.includes("text/event-stream") ||
      (req.url ? new URL(req.url, "http://localhost").searchParams.has("sse") : false);

    let aborted = false;
    res.on("close", () => { aborted = true; });

    if (wantsSSE) initSSE(res, req);

    // Read optional body params for model selection + test type
    const body = await readBody(req).catch(() => ({})) as {
      provider?: ProviderName;
      model?: string;
      testType?: "unit" | "integration";
    };

    // Build per-request client: use body overrides if provided, else global
    const overrides: LlmOverrides = { ...currentOverrides };
    if (body.provider) overrides.provider = body.provider;
    if (body.model) overrides.model = body.model;

    const isIntegration = body.testType === "integration";

    try {
      if (wantsSSE && !aborted) sendSSE(res, "progress", { phase: "preparing", message: "Reading skill content..." });

      const skillContent = readFileSync(skillMdPath, "utf-8");

      // Build prompt based on test type
      let prompt: string;
      if (isIntegration) {
        const mcpDeps = detectMcpDependencies(skillContent);
        const browserReqs = detectBrowserRequirements(skillContent);
        const platforms = detectPlatformTargets(skillContent);
        prompt = buildIntegrationEvalPrompt(skillContent, mcpDeps, browserReqs, platforms);
      } else {
        prompt = buildEvalInitPrompt(skillContent);
      }

      const client = createLlmClient(overrides);

      if (wantsSSE && !aborted) sendSSE(res, "progress", {
        phase: "generating",
        message: `Generating ${isIntegration ? "integration" : "unit"} test cases...`,
      });

      const genResult = wantsSSE
        ? await withHeartbeat(res, undefined, "generating",
            `Generating ${isIntegration ? "integration" : "unit"} test cases`, () =>
            client.generate("You generate eval test cases for AI skills. Output only valid JSON in a code fence.", prompt))
        : await client.generate("You generate eval test cases for AI skills. Output only valid JSON in a code fence.", prompt);

      if (aborted) return;

      if (wantsSSE && !aborted) sendSSE(res, "progress", { phase: "parsing", message: "Parsing generated evals..." });

      // Parse generated cases
      const newCases = isIntegration
        ? parseGeneratedIntegrationEvals(genResult.text)
        : parseGeneratedEvals(genResult.text).evals;

      // Load existing evals to merge — both unit and integration paths merge
      // to prevent data loss (e.g., regenerating unit tests won't wipe integration tests)
      let existingEvals: EvalsFile | null = null;
      try { existingEvals = loadAndValidateEvals(skillDir); } catch (e) {
        // Expected when generating evals for the first time (no evals.json yet).
        // Swallow ENOENT and "No evals.json found" errors; re-throw anything else.
        const isFileMissing =
          (e as NodeJS.ErrnoException).code === "ENOENT" ||
          (e instanceof Error && (e.message.includes("ENOENT") || e.message.includes("No evals.json found")));
        if (!isFileMissing) throw e;
      }

      // Filter out existing cases of the same type, then merge with new ones
      const keepType = isIntegration ? "unit" : "integration";
      const keptCases = (existingEvals?.evals || []).filter(
        (c) => (c.testType ?? "unit") === keepType,
      );

      const maxId = keptCases.length > 0 ? Math.max(...keptCases.map((c) => c.id)) : 0;
      const reNumbered = newCases.map((c, i) => ({ ...c, id: maxId + 1 + i }));

      const mergedEvals: EvalsFile = {
        skill_name: existingEvals?.skill_name || params.skill,
        evals: [...keptCases, ...reNumbered],
      };

      // Record history
      try {
        await writeHistoryEntry(skillDir, {
          timestamp: new Date().toISOString(),
          model: client.model,
          skill_name: mergedEvals.skill_name,
          cases: [],
          overall_pass_rate: undefined,
          type: "eval-generate",
          provider: overrides.provider || "claude-cli",
          generate: { prompt, result: JSON.stringify(mergedEvals) },
        });
      } catch { /* history write failure should not break the main response */ }

      if (wantsSSE && !aborted) {
        sendSSEDone(res, mergedEvals);
      } else {
        sendJson(res, mergedEvals, 200, req);
      }
    } catch (err) {
      if (wantsSSE && !aborted) {
        sendSSE(res, "error", classifyError(err, overrides.provider || "claude-cli"));
        res.end();
      } else {
        sendJson(res, { error: `Eval generation failed: ${(err as Error).message}` }, 500, req);
      }
    }
  });

  // Run benchmark (SSE) — optionally accepts { eval_ids, concurrency, judgeModel, noCache }
  router.post("/api/skills/:plugin/:skill/benchmark", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    const body = await readBody(req).catch(() => ({})) as {
      eval_ids?: number[];
      concurrency?: number;
      judgeModel?: string;
      noCache?: boolean;
    };
    const filterIds = Array.isArray(body?.eval_ids) ? new Set(body.eval_ids) : null;

    // Validate concurrency
    const concurrency = typeof body?.concurrency === "number" ? body.concurrency : undefined;
    if (concurrency !== undefined && (concurrency < 1 || !Number.isInteger(concurrency))) {
      sendJson(res, { error: "concurrency must be a positive integer" }, 400, req);
      return;
    }

    initSSE(res, req);

    try {
      const evals = loadAndValidateEvals(skillDir);
      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
      const client = getClient();
      const systemPrompt = buildEvalSystemPrompt(skillContent);

      // Create separate judge client if judgeModel is specified
      let judgeClient: import("../eval/llm.js").LlmClient | undefined;
      if (body?.judgeModel && typeof body.judgeModel === "string") {
        const slashIdx = body.judgeModel.indexOf("/");
        if (slashIdx > 0) {
          judgeClient = createLlmClient({
            provider: body.judgeModel.slice(0, slashIdx) as ProviderName,
            model: body.judgeModel.slice(slashIdx + 1),
          });
        }
      }

      // Create judge cache unless noCache
      let judgeCache: import("../eval/judge-cache.js").JudgeCache | undefined;
      if (!body?.noCache) {
        const { JudgeCache } = await import("../eval/judge-cache.js");
        judgeCache = new JudgeCache(skillDir);
      }

      await runBenchmarkSSE({
        res, skillDir, skillName: evals.skill_name, systemPrompt,
        runType: "benchmark", provider: currentOverrides.provider || "claude-cli",
        evalCases: evals.evals, filterIds, client, judgeClient, judgeCache,
        isAborted: () => aborted, concurrency,
      });

      // Flush cache after run
      judgeCache?.flush();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendSSEDone(res, { error: errorMsg });
    }
  });

  // Run baseline (SSE) — same as benchmark but without skill content
  router.post("/api/skills/:plugin/:skill/baseline", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    const body = await readBody(req).catch(() => ({})) as { eval_ids?: number[] };
    const filterIds = Array.isArray(body?.eval_ids) ? new Set(body.eval_ids) : null;

    initSSE(res, req);

    try {
      const evals = loadAndValidateEvals(skillDir);
      const client = getClient();

      await runBenchmarkSSE({
        res, skillDir, skillName: evals.skill_name,
        systemPrompt: "You are a helpful AI assistant.",
        runType: "baseline", provider: currentOverrides.provider || "claude-cli",
        evalCases: evals.evals, filterIds, client, isAborted: () => aborted,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendSSEDone(res, { error: errorMsg });
    }
  });

  // Run single case (SSE) — per-case endpoint with semaphore
  router.post("/api/skills/:plugin/:skill/benchmark/case/:evalId", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const evalId = parseInt(params.evalId, 10);
    if (isNaN(evalId)) { sendJson(res, { error: "Invalid evalId" }, 400, req); return; }

    const body = await readBody(req).catch(() => ({})) as { mode?: string; bulk?: boolean };
    const isBaseline = body?.mode === "baseline";
    const isBulkChild = body?.bulk === true;

    let aborted = false;
    let released = false;
    res.on("close", () => {
      aborted = true;
      if (!released) { released = true; sem.release(); }
    });

    const sem = getSkillSemaphore(`${params.plugin}/${params.skill}`);
    initSSE(res, req);

    try {
      const evals = loadAndValidateEvals(skillDir);
      const evalCase = evals.evals.find((e) => e.id === evalId);
      if (!evalCase) { sendSSEDone(res, { error: `Case ${evalId} not found` }); return; }

      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
      const client = getClient();
      const systemPrompt = isBaseline
        ? buildBaselineSystemPrompt()
        : buildEvalSystemPrompt(skillContent);

      await sem.acquire();

      const benchCase = await runSingleCaseSSE({
        res, evalCase, systemPrompt, client, isAborted: () => aborted,
        provider: currentOverrides.provider || "claude-cli",
      });

      if (!released) { released = true; sem.release(); }

      if (!aborted) {
        // Write per-case history unless this is part of a bulk run (bulk-save handles it)
        if (!isBulkChild) {
          const result: BenchmarkResult = {
            timestamp: new Date().toISOString(),
            model: client.model,
            skill_name: evals.skill_name,
            cases: [benchCase],
            overall_pass_rate: benchCase.pass_rate,
            type: isBaseline ? "baseline" : "benchmark",
            provider: currentOverrides.provider || "claude-cli",
            totalDurationMs: benchCase.durationMs ?? 0,
            totalInputTokens: benchCase.inputTokens ?? null,
            totalOutputTokens: benchCase.outputTokens ?? null,
            scope: "single",
          };
          await writeHistoryEntry(skillDir, result);
          emitDataEvent("benchmark:complete");
        }
        sendSSEDone(res, benchCase);
      }
    } catch (err) {
      if (!released) { released = true; sem.release(); }
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendSSEDone(res, { error: errorMsg });
    }
  });

  // Bulk save — client assembles result from per-case runs and saves as one history entry
  router.post("/api/skills/:plugin/:skill/benchmark/bulk-save", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    try {
      const body = await readBody(req) as { result: BenchmarkResult };
      if (!body?.result) { sendJson(res, { error: "Missing result" }, 400, req); return; }
      const result = { ...body.result, scope: "bulk" as const };
      await writeHistoryEntry(skillDir, result);
      emitDataEvent("history:written");
      sendJson(res, { ok: true }, 200, req);
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500, req);
    }
  });

  // Run comparison (SSE)
  router.post("/api/skills/:plugin/:skill/compare", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    initSSE(res, req);

    try {
      const evals = loadAndValidateEvals(skillDir);
      const body = await readBody(req).catch(() => ({})) as { eval_ids?: number[] };
      const filterIds = Array.isArray(body?.eval_ids) ? new Set(body.eval_ids) : null;
      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
      const client = getClient();

      const casesToRun = filterIds
        ? evals.evals.filter((e) => filterIds.has(e.id))
        : evals.evals;

      const comparisonResults: Array<{
        eval_id: number;
        eval_name: string;
        comparison: Awaited<ReturnType<typeof runComparison>>;
        assertionResults: BenchmarkAssertionResult[];
        baselineAssertionResults: BenchmarkAssertionResult[];
      }> = [];

      for (const evalCase of casesToRun) {
        if (aborted) break;

        sendSSE(res, "case_start", {
          eval_id: evalCase.id,
          eval_name: evalCase.name,
        });

        const heartbeat = startDynamicHeartbeat(
          res, evalCase.id, "generating_skill",
          `Generating skill output for "${evalCase.name}"...`,
        );

        try {
          const comparison = await runComparison(
            evalCase.prompt, skillContent, client,
            (phase, msg) => heartbeat.update(phase, msg),
          );
          heartbeat.stop();
          sendSSE(res, "outputs_ready", {
            eval_id: evalCase.id,
            eval_name: evalCase.name,
            prompt: evalCase.prompt,
            skillOutput: comparison.skillOutput,
            skillDurationMs: comparison.skillDurationMs,
            skillTokens: comparison.skillTokens,
            baselineOutput: comparison.baselineOutput,
            baselineDurationMs: comparison.baselineDurationMs,
            baselineTokens: comparison.baselineTokens,
            skillContentScore: comparison.skillContentScore,
            skillStructureScore: comparison.skillStructureScore,
            baselineContentScore: comparison.baselineContentScore,
            baselineStructureScore: comparison.baselineStructureScore,
            winner: comparison.winner,
          });

          // Also grade assertions against skill output
          sendSSE(res, "progress", {
            eval_id: evalCase.id,
            phase: "judging",
            message: `Evaluating ${evalCase.assertions.length} assertion${evalCase.assertions.length !== 1 ? "s" : ""}...`,
            total: evalCase.assertions.length,
          });

          const assertionResults: BenchmarkAssertionResult[] = [];
          const baselineAssertionResults: BenchmarkAssertionResult[] = [];
          for (let ai = 0; ai < evalCase.assertions.length; ai++) {
            const assertion = evalCase.assertions[ai];
            if (aborted) break;
            sendSSE(res, "progress", {
              eval_id: evalCase.id,
              phase: "judging_assertion",
              message: `Evaluating assertion ${ai + 1}/${evalCase.assertions.length}...`,
              current: ai + 1,
              total: evalCase.assertions.length,
            });
            const [skillResult, baselineResult] = await Promise.all([
              judgeAssertion(comparison.skillOutput, assertion, client),
              judgeAssertion(comparison.baselineOutput, assertion, client),
            ]);
            assertionResults.push(skillResult);
            baselineAssertionResults.push(baselineResult);
            sendSSE(res, "assertion_result", {
              eval_id: evalCase.id,
              assertion_id: skillResult.id,
              text: skillResult.text,
              pass: skillResult.pass,
              reasoning: skillResult.reasoning,
            });
            sendSSE(res, "baseline_assertion_result", {
              eval_id: evalCase.id,
              assertion_id: baselineResult.id,
              text: baselineResult.text,
              pass: baselineResult.pass,
              reasoning: baselineResult.reasoning,
            });
          }

          const casePassRate = assertionResults.length > 0
            ? assertionResults.filter((a) => a.pass).length / assertionResults.length
            : 0;
          const caseStatus = assertionResults.length > 0 && assertionResults.every((a) => a.pass) ? "pass" : "fail";
          sendSSE(res, "case_complete", {
            eval_id: evalCase.id,
            status: caseStatus,
            pass_rate: casePassRate,
            durationMs: comparison.skillDurationMs,
            tokens: comparison.skillTokens,
          });

          comparisonResults.push({
            eval_id: evalCase.id,
            eval_name: evalCase.name,
            comparison,
            assertionResults,
            baselineAssertionResults,
          });

          sendSSE(res, "comparison_scored", {
            eval_id: evalCase.id,
            winner: comparison.winner,
            skillContentScore: comparison.skillContentScore,
            skillStructureScore: comparison.skillStructureScore,
            baselineContentScore: comparison.baselineContentScore,
            baselineStructureScore: comparison.baselineStructureScore,
          });
        } catch (err) {
          heartbeat.stop();
          sendSSE(res, "case_error", {
            eval_id: evalCase.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (!aborted) {
        // Compute verdict
        const totalAssertions = comparisonResults.reduce(
          (s, r) => s + r.assertionResults.length,
          0,
        );
        const passedAssertions = comparisonResults.reduce(
          (s, r) => s + r.assertionResults.filter((a) => a.pass).length,
          0,
        );
        const passRate = totalAssertions > 0 ? passedAssertions / totalAssertions : 0;
        const skillRubricAvg =
          comparisonResults.length > 0
            ? comparisonResults.reduce(
                (s, r) =>
                  s +
                  (r.comparison.skillContentScore + r.comparison.skillStructureScore) / 2,
                0,
              ) / comparisonResults.length
            : 0;
        const baselineRubricAvg =
          comparisonResults.length > 0
            ? comparisonResults.reduce(
                (s, r) =>
                  s +
                  (r.comparison.baselineContentScore + r.comparison.baselineStructureScore) / 2,
                0,
              ) / comparisonResults.length
            : 0;

        const baselinePassed = comparisonResults.reduce(
          (s, r) => s + r.baselineAssertionResults.filter((a) => a.pass).length,
          0,
        );
        const baselinePassRate = totalAssertions > 0 ? baselinePassed / totalAssertions : 0;

        const verdict = computeVerdict(passRate, skillRubricAvg, baselineRubricAvg, baselinePassRate);

        // Generate action items (one LLM call with comparison context)
        let actionItems;
        try {
          const actionCases = comparisonResults.map((r) => ({
            eval_id: r.eval_id,
            eval_name: r.eval_name,
            winner: r.comparison.winner,
            skillContentScore: r.comparison.skillContentScore,
            skillStructureScore: r.comparison.skillStructureScore,
            baselineContentScore: r.comparison.baselineContentScore,
            baselineStructureScore: r.comparison.baselineStructureScore,
            assertionResults: r.assertionResults,
          }));
          actionItems = await withHeartbeat(
            res, undefined, "action_items", "Generating recommendations",
            () => generateActionItems(
              client, verdict,
              { passRate, skillRubricAvg, baselineRubricAvg, delta: skillRubricAvg - baselineRubricAvg },
              actionCases, skillContent,
            ),
          );
        } catch {
          // Non-fatal — comparison still valid without action items
          actionItems = undefined;
        }

        // Build benchmark-compatible result for history
        const cases: BenchmarkCase[] = comparisonResults.map((r) => ({
          eval_id: r.eval_id,
          eval_name: r.eval_name,
          status: r.assertionResults.every((a) => a.pass) ? "pass" as const : "fail" as const,
          error_message: null,
          pass_rate:
            r.assertionResults.length > 0
              ? r.assertionResults.filter((a) => a.pass).length / r.assertionResults.length
              : 0,
          durationMs: r.comparison.skillDurationMs,
          tokens: r.comparison.skillTokens,
          assertions: r.assertionResults,
          comparisonDetail: {
            skillDurationMs: r.comparison.skillDurationMs,
            skillTokens: r.comparison.skillTokens,
            baselineDurationMs: r.comparison.baselineDurationMs,
            baselineTokens: r.comparison.baselineTokens,
            skillContentScore: r.comparison.skillContentScore,
            skillStructureScore: r.comparison.skillStructureScore,
            baselineContentScore: r.comparison.baselineContentScore,
            baselineStructureScore: r.comparison.baselineStructureScore,
            winner: r.comparison.winner,
          },
        }));

        const historyResult = {
          timestamp: new Date().toISOString(),
          model: client.model,
          skill_name: evals.skill_name,
          cases,
          overall_pass_rate: passRate,
          type: "comparison" as const,
          provider: currentOverrides.provider || "claude-cli",
          verdict,
          comparison: {
            skillPassRate: passRate,
            baselinePassRate,
            skillRubricAvg,
            baselineRubricAvg,
            delta: passRate - baselinePassRate,
          },
          ...(actionItems ? { actionItems } : {}),
        };

        await writeHistoryEntry(skillDir, historyResult);
        emitDataEvent("history:written");
        sendSSEDone(res, historyResult);
      }
    } catch (err) {
      sendSSEDone(res, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  // List benchmark history (with optional filters)
  router.get("/api/skills/:plugin/:skill/history", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const url = new URL(req.url!, `http://localhost`);
    const filter: HistoryFilter = {};
    const modelParam = url.searchParams.get("model");
    const typeParam = url.searchParams.get("type");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    if (modelParam) filter.model = modelParam;
    if (typeParam && ["benchmark", "comparison", "baseline", "model-compare", "improve", "instruct", "ai-generate", "eval-generate"].includes(typeParam)) {
      filter.type = typeParam as HistoryFilter["type"];
    }
    if (fromParam) filter.from = fromParam;
    if (toParam) filter.to = toParam;
    const hasFilter = Object.keys(filter).length > 0;
    const history = await listHistory(skillDir, hasFilter ? filter : undefined);
    sendJson(res, history, 200, req);
  });

  // Compare two history runs
  router.get("/api/skills/:plugin/:skill/history-compare", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const url = new URL(req.url!, `http://localhost`);
    const tsA = url.searchParams.get("a");
    const tsB = url.searchParams.get("b");
    if (!tsA || !tsB) {
      sendJson(res, { error: "Both 'a' and 'b' timestamps are required" }, 400, req);
      return;
    }

    const [runA, runB] = await Promise.all([
      readHistoryEntry(skillDir, tsA),
      readHistoryEntry(skillDir, tsB),
    ]);
    if (!runA || !runB) {
      sendJson(res, { error: "One or both history entries not found" }, 404, req);
      return;
    }

    const regressions = computeRegressions(runB, runA);

    // Build case diffs
    const allEvalIds = new Set([
      ...runA.cases.map((c) => c.eval_id),
      ...runB.cases.map((c) => c.eval_id),
    ]);
    const caseDiffs = Array.from(allEvalIds).map((evalId) => {
      const caseA = runA.cases.find((c) => c.eval_id === evalId);
      const caseB = runB.cases.find((c) => c.eval_id === evalId);
      return {
        eval_id: evalId,
        eval_name: caseA?.eval_name || caseB?.eval_name || `Eval #${evalId}`,
        statusA: caseA?.status ?? "missing" as const,
        statusB: caseB?.status ?? "missing" as const,
        passRateA: caseA?.pass_rate ?? null,
        passRateB: caseB?.pass_rate ?? null,
        durationMsA: caseA?.durationMs ?? null,
        durationMsB: caseB?.durationMs ?? null,
        tokensA: caseA?.tokens ?? null,
        tokensB: caseB?.tokens ?? null,
      };
    });

    const totalA = runA.cases.reduce((s, c) => s + c.assertions.length, 0);
    const passedA = runA.cases.reduce((s, c) => s + c.assertions.filter((a) => a.pass).length, 0);
    const totalB = runB.cases.reduce((s, c) => s + c.assertions.length, 0);
    const passedB = runB.cases.reduce((s, c) => s + c.assertions.filter((a) => a.pass).length, 0);

    const costA = runA.totalCost ?? (runA.cases.some((c: any) => c.cost != null) ? runA.cases.reduce((s: number, c: any) => s + (c.cost ?? 0), 0) : null);
    const costB = runB.totalCost ?? (runB.cases.some((c: any) => c.cost != null) ? runB.cases.reduce((s: number, c: any) => s + (c.cost ?? 0), 0) : null);

    sendJson(res, {
      runA: {
        timestamp: runA.timestamp, model: runA.model,
        passRate: totalA > 0 ? passedA / totalA : 0,
        type: runA.type || "benchmark",
        totalCost: costA,
      },
      runB: {
        timestamp: runB.timestamp, model: runB.model,
        passRate: totalB > 0 ? passedB / totalB : 0,
        type: runB.type || "benchmark",
        totalCost: costB,
      },
      regressions,
      caseDiffs,
    }, 200, req);
  });

  // Per-case history
  router.get("/api/skills/:plugin/:skill/history/case/:evalId", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const evalId = parseInt(params.evalId, 10);
    if (isNaN(evalId)) {
      sendJson(res, { error: "Invalid eval ID" }, 400, req);
      return;
    }
    const url = new URL(req.url!, `http://localhost`);
    const modelParam = url.searchParams.get("model") || undefined;
    const entries = await getCaseHistory(skillDir, evalId, modelParam ? { model: modelParam } : undefined);
    sendJson(res, entries, 200, req);
  });

  // Get specific history entry
  router.get("/api/skills/:plugin/:skill/history/:timestamp", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const entry = await readHistoryEntry(skillDir, params.timestamp);
    if (!entry) {
      sendJson(res, { error: "History entry not found" }, 404, req);
      return;
    }
    sendJson(res, entry, 200, req);
  });

  // Delete history entry
  router.delete("/api/skills/:plugin/:skill/history/:timestamp", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const deleted = await deleteHistoryEntry(skillDir, params.timestamp);
    if (!deleted) {
      sendJson(res, { error: "History entry not found" }, 404, req);
      return;
    }
    sendJson(res, { ok: true }, 200, req);
  });

  // Get aggregated stats
  router.get("/api/skills/:plugin/:skill/stats", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const stats = await computeStats(skillDir);
    sendJson(res, stats, 200, req);
  });

  // Get latest benchmark
  //
  // Envelope (0707 T-022 / T-025):
  //   200 null                 when no benchmark has been persisted
  //   200 <BenchmarkResult>    when a benchmark exists
  //
  // Always 200 — a missing benchmark is normal empty state, not an error.
  // Works for any plugin slug (including dashes like `google-workspace`)
  // because routing uses `[^/]+` groups (see router.ts T-020).
  router.get("/api/skills/:plugin/:skill/benchmark/latest", async (req, res, params) => {
    // 0704: always 200; body null = no benchmark persisted yet.
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const benchmark = await readBenchmark(skillDir);
    sendJson(res, benchmark ?? null, 200, req);
  });

  // Run activation test (SSE)
  router.post("/api/skills/:plugin/:skill/activation-test", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    initSSE(res, req);

    try {
      const body = (await readBody(req)) as {
        prompts: ActivationPrompt[];
        provider?: ProviderName;
        model?: string;
      };
      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";

      // Extract description, name, and tags from frontmatter.
      // 0679 F-001: route through parseSkillFrontmatter so the metadata-nested
      // tags shape (per agentskills.io/specification) is honored. Direct regex
      // missed indented `metadata.tags:` and silently produced an empty array.
      const description = extractDescription(skillContent);
      const fm = parseSkillFrontmatter(skillContent);
      const fmName = fm.name;
      const fmTags = fm.tags;
      const meta: SkillMeta = {
        name: typeof fmName === "string" && fmName.trim().length > 0 ? fmName.trim() : params.skill,
        tags: Array.isArray(fmTags)
          ? fmTags.filter((t): t is string => typeof t === "string" && t.length > 0)
          : (typeof fmTags === "string"
            ? fmTags.split(",").map((t) => t.trim()).filter(Boolean)
            : []),
      };

      // Use per-request model overrides if provided, fall back to global config
      const client = body.provider || body.model
        ? createLlmClient({ provider: body.provider, model: body.model })
        : getClient();

      const summary = await testActivation(description, body.prompts, client, (result) => {
        if (!aborted) {
          sendSSE(res, "prompt_result", result);
        }
      }, meta, (phase, index, total) => {
        if (!aborted) sendSSE(res, phase, { index, total });
      });

      if (!aborted) {
        // Write activation history entry
        const usedProvider = body.provider || currentOverrides.provider || "unknown";
        const usedModel = body.model || currentOverrides.model || "unknown";
        const run: ActivationHistoryRun = {
          id: `run-${Date.now()}`,
          timestamp: new Date().toISOString(),
          model: usedModel,
          provider: usedProvider,
          promptCount: summary.total,
          summary: {
            precision: summary.precision,
            recall: summary.recall,
            reliability: summary.reliability,
            tp: summary.tp,
            tn: summary.tn,
            fp: summary.fp,
            fn: summary.fn,
          },
          results: summary.results,
        };
        try { await writeActivationRun(skillDir, run); } catch { /* non-blocking */ }

        sendSSEDone(res, { ...summary, description });
      }
    } catch (err) {
      sendSSEDone(res, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  // AI-generate activation test prompts (SSE)
  router.post("/api/skills/:plugin/:skill/activation-prompts", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    try {
      const body = (await readBody(req)) as {
        count?: number;
        provider?: ProviderName;
        model?: string;
      };

      const skillMdPath = join(skillDir, "SKILL.md");
      if (!existsSync(skillMdPath)) {
        sendJson(res, { error: "SKILL.md not found" }, 404, req);
        return;
      }
      const skillContent = readFileSync(skillMdPath, "utf-8");
      const description = extractDescription(skillContent);

      initSSE(res, req);

      const count = body.count || 8;
      const half = Math.ceil(count / 2);

      const client = body.provider || body.model
        ? createLlmClient({ provider: body.provider, model: body.model })
        : getClient();

      const systemPrompt = `Given this skill description, generate test prompts to evaluate activation quality.
Generate ${count} prompts: ${half} that SHOULD activate this skill, ${count - half} that should NOT.
For "should not" prompts, make them plausible but clearly outside this skill's domain.
Return one JSON object per line: {"prompt": "...", "expected": "should_activate"|"should_not_activate"}
Return ONLY the JSON lines, no other text.`;

      const userPrompt = `Skill description: ${description}`;

      const { text } = await withHeartbeat(
        res, undefined, "generating", "Generating test prompts...",
        () => client.generate(systemPrompt, userPrompt),
      );
      if (aborted) return;

      const allPrompts: Array<{ prompt: string; expected: string }> = [];
      const lines = text.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const cleaned = line.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
          if (!cleaned.startsWith("{")) continue;
          const parsed = JSON.parse(cleaned);
          if (parsed.prompt && parsed.expected) {
            allPrompts.push({ prompt: parsed.prompt, expected: parsed.expected });
            if (!aborted) sendSSE(res, "prompt_generated", parsed);
          }
        } catch { /* skip malformed lines */ }
      }

      if (!aborted) sendSSEDone(res, { prompts: allPrompts });
    } catch (err) {
      if (!aborted) {
        sendSSEDone(res, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  // List activation test history (summaries only)
  //
  // Envelope (0707 T-024 / T-025):
  //   200 { runs: [],     count: 0 }          when the history log doesn't
  //                                           exist / the skill has never been
  //                                           activation-tested. listActivation-
  //                                           Runs() catches ENOENT internally
  //                                           and returns [] — see activation-
  //                                           history.ts readHistoryFile().
  //   200 { runs: [...],  count: <N> }        when entries exist
  //   500 { error }                           only for unexpected I/O failures
  //                                           (ENOENT is explicitly not one)
  router.get("/api/skills/:plugin/:skill/activation-history", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    try {
      const runs = await listActivationRuns(skillDir);
      sendJson(res, { runs, count: runs.length }, 200, req);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        // Defensive — listActivationRuns already swallows ENOENT, but in case
        // a future refactor propagates it we still return the empty envelope.
        sendJson(res, { runs: [], count: 0 }, 200, req);
        return;
      }
      sendJson(res, { error: (err as Error).message }, 500, req);
    }
  });

  // Get full activation test run by ID
  router.get("/api/skills/:plugin/:skill/activation-history/:runId", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const run = await getActivationRun(skillDir, params.runId);
    if (!run) {
      sendJson(res, { error: "Run not found" }, 404, req);
      return;
    }
    sendJson(res, run, 200, req);
  });

  // Get skill dependencies (MCP + skill-to-skill)
  router.get("/api/skills/:plugin/:skill/dependencies", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const skillMdPath = join(skillDir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      sendJson(res, { error: "SKILL.md not found" }, 404, req);
      return;
    }
    const content = readFileSync(skillMdPath, "utf-8");
    const mcpDependencies = detectMcpDependencies(content);
    const skillDependencies = detectSkillDependencies(content);
    sendJson(res, { mcpDependencies, skillDependencies }, 200, req);
  });

  // Handle CORS preflight
  router.options = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void => {
    const origin = req.headers.origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "3600",
      });
    } else {
      res.writeHead(204);
    }
    res.end();
  };
}

function validateEvalsBody(body: any): Array<{ path: string; message: string }> {
  const errors: Array<{ path: string; message: string }> = [];

  if (!body || typeof body !== "object") {
    errors.push({ path: "body", message: "must be an object" });
    return errors;
  }
  if (typeof body.skill_name !== "string" || !body.skill_name) {
    errors.push({ path: "skill_name", message: "required string field" });
  }
  if (!Array.isArray(body.evals)) {
    errors.push({ path: "evals", message: "required array field" });
    return errors;
  }
  for (let i = 0; i < body.evals.length; i++) {
    const e = body.evals[i];
    const p = `evals[${i}]`;
    if (typeof e.id !== "number") errors.push({ path: `${p}.id`, message: "required number" });
    if (typeof e.name !== "string" || !e.name) errors.push({ path: `${p}.name`, message: "required string" });
    if (typeof e.prompt !== "string" || !e.prompt) errors.push({ path: `${p}.prompt`, message: "required string" });
    if (typeof e.expected_output !== "string") errors.push({ path: `${p}.expected_output`, message: "required string" });
    if (!Array.isArray(e.assertions) || e.assertions.length === 0) {
      errors.push({ path: `${p}.assertions`, message: "must have at least 1 assertion" });
    }
  }
  return errors;
}
