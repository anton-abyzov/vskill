// ---------------------------------------------------------------------------
// Skill deprecation with a replacement pointer (increment 1486).
//
// A skill marks itself deprecated with flat string keys directly under a
// block-style `metadata:` mapping (the Agent Skills spec keeps metadata
// string-to-string; the version already lives in metadata.version):
//
//   metadata:
//     version: "1.0.5"
//     deprecated: "true"
//     deprecated-message: "A smoke-test fixture, not a user skill."
//     replaced-by: "none"            # | mcp:<server>[:tool] | <owner>/<repo>/<skill>
//     deprecated-since: "1.0.5"
//
// Nothing here removes or overwrites a skill: callers only print notices.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isMap, isScalar, parseDocument, type Document } from "yaml";
import { resolveInstallPath } from "../eval/disk-version.js";
import { parseSource } from "../resolvers/source-resolver.js";
import type { SkillLockEntry } from "../lockfile/types.js";
import { yellow } from "../utils/output.js";

export interface SkillDeprecation {
  message: string;
  /** "none", "mcp:<server>[:tool]" or "<owner>/<repo>/<skill>". */
  replacedBy: string;
  since?: string;
}

const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FRONTMATTER_ALL_RE = /(?:^|\n)---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/g;

function scalarText(node: unknown): string | undefined {
  if (!isScalar(node)) return undefined;
  const v = node.value;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

/** Parsed frontmatter, or null when it is not valid YAML. Never throws. */
function parseFrontmatter(frontmatter: string): Document | null {
  try {
    const doc = parseDocument(frontmatter, { uniqueKeys: false });
    return doc.errors.length ? null : doc;
  } catch {
    return null;
  }
}

/**
 * Direct scalar children of a block-style `metadata:` mapping (D-04). A flow
 * mapping, an alias, a nested map or a list is not read.
 */
function metadataChildren(doc: Document): Map<string, string> {
  const out = new Map<string, string>();
  const node = doc.get("metadata", true);
  if (!isMap(node) || node.flow) return out;
  for (const pair of node.items) {
    const key = scalarText(pair.key);
    const value = scalarText(pair.value);
    if (key === undefined || value === undefined || out.has(key)) continue;
    out.set(key, value.trim());
  }
  return out;
}

function fromDocument(doc: Document | null): SkillDeprecation | null {
  if (!doc) return null;
  const meta = metadataChildren(doc);
  if ((meta.get("deprecated") ?? "").toLowerCase() !== "true") return null;
  const since = meta.get("deprecated-since");
  return {
    message: meta.get("deprecated-message") ?? "",
    replacedBy: meta.get("replaced-by") || "none",
    ...(since ? { since } : {}),
  };
}

function documentName(doc: Document | null): string | undefined {
  const name = doc ? scalarText(doc.get("name", true))?.trim() : undefined;
  return name ? name.slice(name.lastIndexOf("/") + 1) : undefined;
}

function frontmatterName(frontmatter: string): string | undefined {
  return documentName(parseFrontmatter(frontmatter));
}

/** The deprecation a SKILL.md declares, or null. Never throws. */
export function readDeprecation(content: string | null | undefined): SkillDeprecation | null {
  if (typeof content !== "string") return null;
  const fm = content.match(FRONTMATTER_RE);
  return fm ? fromDocument(parseFrontmatter(fm[1])) : null;
}

/**
 * Every deprecated skill in content that may join several SKILL.md files
 * (plugin installs combine them). `name` is the frontmatter name, when set.
 */
export function readDeprecations(
  content: string | null | undefined,
): Array<{ name?: string; deprecation: SkillDeprecation }> {
  if (typeof content !== "string") return [];
  const out: Array<{ name?: string; deprecation: SkillDeprecation }> = [];
  for (const m of content.replace(/^\uFEFF/, "").matchAll(FRONTMATTER_ALL_RE)) {
    const doc = parseFrontmatter(m[1]);
    const deprecation = fromDocument(doc);
    if (deprecation) out.push({ name: documentName(doc), deprecation });
  }
  return out;
}

/** The deprecation an installed SKILL.md on disk declares, or null. */
export function readInstalledDeprecation(skillMdPath: string | null | undefined): SkillDeprecation | null {
  if (!skillMdPath) return null;
  try {
    return readDeprecation(readFileSync(skillMdPath, "utf8"));
  } catch {
    return null;
  }
}

/** "none" reads as "no replacement"; anything else is shown as written. */
export function describeReplacement(replacedBy: string): string {
  return replacedBy === "none" ? "none (no replacement)" : replacedBy;
}

/** One line: "<name> is deprecated since X: <message> Replaced by: <r>." */
export function formatDeprecation(name: string, d: SkillDeprecation): string {
  const message = d.message.trim();
  const sentence = message ? (/[.!?]$/.test(message) ? message : `${message}.`) : "No reason given.";
  return `${name} is deprecated${d.since ? ` since ${d.since}` : ""}: ${sentence} Replaced by: ${describeReplacement(d.replacedBy)}.`;
}

/** The printed notice: a warning line; nothing is removed or overwritten. */
export function deprecationNotice(name: string, d: SkillDeprecation): string {
  return yellow(`⚠ ${formatDeprecation(name, d)}`);
}

/**
 * Print a notice for every deprecated skill in installed content (one SKILL.md
 * or a plugin's combined files). `fallbackName` names a skill whose
 * frontmatter has no name. The install itself goes ahead unchanged.
 */
export function printDeprecationsIn(content: string | null | undefined, fallbackName: string): void {
  try {
    for (const d of readDeprecations(content)) console.log(deprecationNotice(d.name ?? fallbackName, d.deprecation));
  } catch {
    // A notice must never break an install.
  }
}

/** JSON shape for `--json` outputs. */
export function deprecationJson(d: SkillDeprecation): { message: string; replacedBy: string; since?: string } {
  return { message: d.message, replacedBy: d.replacedBy, ...(d.since ? { since: d.since } : {}) };
}

// ---------------------------------------------------------------------------
// Upstream reads: what the source serves now, so an install that predates
// the field still learns about it. raw.githubusercontent.com only, bounded
// by a timeout; any failure is "no claim".
// ---------------------------------------------------------------------------

export type FetchText = (url: string, signal?: AbortSignal) => Promise<string | null>;

export const UPSTREAM_TIMEOUT_MS = 5_000;

/**
 * A plain, unauthenticated GET on raw.githubusercontent.com (D-06): no token,
 * no Contents API, no retries. The signal aborts the request and its body.
 */
const defaultFetchText: FetchText = async (url, signal) => {
  const res = await fetch(url, { signal, headers: { "User-Agent": "vskill-cli" } });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  return await res.text();
};

/**
 * One deadline for a whole upstream lookup: every request shares it, and the
 * abort ends in-flight requests instead of leaving them running.
 */
function deadline(timeoutMs: number, fetchText: FetchText) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const aborted = new Promise<null>((resolve) => controller.signal.addEventListener("abort", () => resolve(null), { once: true }));
  const get = (url: string): Promise<string | null> =>
    controller.signal.aborted
      ? Promise.resolve(null)
      : Promise.race([fetchText(url, controller.signal).catch(() => null), aborted]);
  const done = () => {
    clearTimeout(timer);
    controller.abort();
  };
  return { get, done };
}

/** A pinned install stores its commit as the branch: read the default branch then. */
function upstreamRef(entry: SkillLockEntry): string {
  const b = entry.sourceBranch?.trim();
  return !b || /^[0-9a-f]{7,40}$/i.test(b) ? "HEAD" : b;
}

/**
 * The SKILL.md files the source of a lock entry serves now: one for a
 * single-skill GitHub install, one per installed skill folder for a plugin
 * install (nested `skills/<dir>/SKILL.md` or a flat plugin-root SKILL.md).
 * Other source types (registry, local, private) return [].
 */
export async function fetchUpstreamSkillMds(
  name: string,
  entry: SkillLockEntry,
  opts: { fetchText?: FetchText; timeoutMs?: number } = {},
): Promise<Array<{ skill: string; content: string }>> {
  if (entry.sourcePrivate || entry.hostedPrivate) return [];
  const parsed = parseSource(entry.source ?? "");
  if (parsed.type !== "github" && parsed.type !== "github-plugin" && parsed.type !== "marketplace") return [];
  const { get, done } = deadline(opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS, opts.fetchText ?? defaultFetchText);
  // "HEAD" resolves to the default branch on raw.githubusercontent.com
  // without a REST call (installs read the default branch, usually main).
  const base = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${upstreamRef(entry)}`;
  const skillName = name.slice(name.lastIndexOf("/") + 1);
  try {
    if (parsed.type === "github") {
      const paths = [...new Set([entry.sourceSkillPath, `skills/${skillName}/SKILL.md`, "SKILL.md"])].filter(
        (p): p is string => !!p,
      );
      for (const path of paths) {
        const content = await get(`${base}/${path}`);
        if (!content) continue;
        // A fallback path may serve another skill: only trust a matching name.
        const fm = content.match(FRONTMATTER_RE);
        const declared = fm ? frontmatterName(fm[1]) : undefined;
        if (path !== entry.sourceSkillPath && declared && declared !== skillName) continue;
        return [{ skill: skillName, content }];
      }
      return [];
    }

    const manifest = await get(`${base}/.claude-plugin/marketplace.json`);
    if (!manifest) return [];
    let source: string | null = null;
    try {
      const { getPluginSource } = await import("../marketplace/index.js");
      source = getPluginSource(parsed.pluginName, manifest);
    } catch {
      return [];
    }
    if (source === null) return [];
    const prefix = source.replace(/^\.\/?/, "").replace(/\/+$/, "");
    const root = `${base}/${prefix ? `${prefix}/` : ""}`;
    const results = await Promise.all(
      pluginSkillDirs(entry, parsed.pluginName).map(async (dir) => {
        let content = await get(`${root}skills/${dir}/SKILL.md`);
        // Flat plugin: its one skill, named after the plugin, is the root SKILL.md.
        if (!content && dir === parsed.pluginName) content = await get(`${root}SKILL.md`);
        return content ? { skill: dir, content } : null;
      }),
    );
    return results.filter((r): r is { skill: string; content: string } => r !== null);
  } finally {
    done();
  }
}

/** Skill folders a plugin lock entry installed; a bare SKILL.md is the plugin-named skill. */
function pluginSkillDirs(entry: SkillLockEntry, pluginName: string): string[] {
  const dirs = new Set<string>(entry.skills ?? []);
  for (const f of entry.files ?? []) {
    if (f === "SKILL.md") dirs.add(pluginName);
    const m = f.match(/^([^/]+)\/SKILL\.md$/);
    if (m) dirs.add(m[1]);
  }
  return [...dirs];
}

/** Deprecations the source of a lock entry declares now, keyed by skill folder. */
export async function fetchUpstreamDeprecations(
  name: string,
  entry: SkillLockEntry,
  opts: { fetchText?: FetchText; timeoutMs?: number } = {},
): Promise<Array<{ skill: string; deprecation: SkillDeprecation }>> {
  try {
    const files = await fetchUpstreamSkillMds(name, entry, opts);
    return files.flatMap(({ skill, content }) => {
      const deprecation = readDeprecation(content);
      return deprecation ? [{ skill, deprecation }] : [];
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Lock-wide scan: the installed copies plus, optionally, their sources.
// ---------------------------------------------------------------------------

export interface DeprecationFinding {
  /** Lock entry name (a plugin name for plugin installs). */
  name: string;
  /** Skill folder that is deprecated. */
  skill: string;
  deprecation: SkillDeprecation;
  /** Where it was read: the installed SKILL.md or the source's current one. */
  origin: "installed" | "source";
}

/**
 * Skills folders an entry may have been installed into: every agent's
 * project or user-level folder plus the shared `.agents/skills`, Claude first.
 */
async function installBases(entry: SkillLockEntry, lockDir: string): Promise<string[]> {
  const user = entry.scope === "user";
  const bases = user
    ? [join(homedir(), ".claude", "skills"), join(homedir(), ".agents", "skills")]
    : [join(lockDir, ".claude", "skills"), join(lockDir, ".agents", "skills")];
  try {
    const { getInstallableAgents } = await import("../agents/agents-registry.js");
    const { agentGlobalInstallDirs } = await import("../agents/global-dirs.js");
    for (const agent of getInstallableAgents()) {
      if (user) bases.push(...agentGlobalInstallDirs(agent));
      else if (agent.localSkillsDir) bases.push(join(lockDir, agent.localSkillsDir));
    }
  } catch {
    // The Claude and shared folders above still cover the common layouts.
  }
  return [...new Set(bases)];
}

/** SKILL.md paths on disk for a lock entry, keyed by skill folder (only those that exist). */
export async function installedSkillMdPaths(
  name: string,
  entry: SkillLockEntry,
  lockDir: string,
): Promise<Array<{ skill: string; path: string }>> {
  const parsed = parseSource(entry.source ?? "");
  const bases = await installBases(entry, lockDir);
  const first = (paths: string[]) => paths.find((p) => existsSync(p));
  const leaf = name.slice(name.lastIndexOf("/") + 1);

  if (parsed.type !== "github-plugin" && parsed.type !== "marketplace" && !entry.pluginDir) {
    const path = first([
      ...(entry.installedPath ? [resolveInstallPath({ name, entry, lockDir })] : []),
      ...bases.map((b) => join(b, leaf, "SKILL.md")),
    ]);
    return path ? [{ skill: leaf, path }] : [];
  }

  const pluginName = "pluginName" in parsed ? parsed.pluginName : leaf;
  const out: Array<{ skill: string; path: string }> = [];
  for (const skill of pluginSkillDirs(entry, pluginName)) {
    const own = skill === pluginName;
    const path = first([
      ...(entry.installedPath
        ? [join(entry.installedPath, skill, "SKILL.md"), join(entry.installedPath, "skills", skill, "SKILL.md"), ...(own ? [join(entry.installedPath, "SKILL.md")] : [])]
        : []),
      // --plugin installs: <base>/<plugin>/<skill>/, the plugin-named skill in <base>/<plugin>/.
      ...(parsed.type === "github-plugin" ? bases.map((b) => (own ? join(b, pluginName, "SKILL.md") : join(b, pluginName, skill, "SKILL.md"))) : []),
      // Marketplace installs: <base>/<skill>/.
      ...bases.map((b) => join(b, skill, "SKILL.md")),
    ]);
    if (path) out.push({ skill, path });
  }
  return out;
}

/**
 * Deprecated skills among lock entries. The source's current SKILL.md wins
 * over the installed copy, so an install that predates the field is flagged.
 * `upstream: false` reads only the installed copies (no network).
 */
export async function collectDeprecations(
  entries: Array<{ name: string; entry: SkillLockEntry; lockDir: string }>,
  opts: { upstream?: boolean; fetchText?: FetchText; timeoutMs?: number } = {},
): Promise<DeprecationFinding[]> {
  const perEntry = await Promise.all(
    entries.map(async ({ name, entry, lockDir }) => {
      const found = new Map<string, DeprecationFinding>();
      for (const { skill, path } of await installedSkillMdPaths(name, entry, lockDir)) {
        const d = readInstalledDeprecation(path);
        if (d) found.set(skill, { name, skill, deprecation: d, origin: "installed" });
      }
      if (opts.upstream) {
        for (const { skill, deprecation } of await fetchUpstreamDeprecations(name, entry, opts)) {
          found.set(skill, { name, skill, deprecation, origin: "source" });
        }
      }
      return [...found.values()];
    }),
  );
  return perEntry.flat();
}
