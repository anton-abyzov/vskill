import { lstatSync, statSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep, dirname, basename, parse } from "node:path";
import { homedir } from "node:os";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { agentGlobalInstallDirs } from "../agents/global-dirs.js";
import { resolveAgentSkillsDir, resolveEffectiveSkillsDir, resolveAgentInstallRoot, type InstallOptions } from "../installer/canonical.js";
import { resolveTilde } from "../utils/paths.js";

export function isSkillFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

/** Native/legacy directories this tool owns, excluding its additional readers. */
export function ownedSkillDirs(agent: AgentDefinition, opts: InstallOptions): string[] {
  return opts.global
    ? agentGlobalInstallDirs(agent, resolveTilde)
    : [resolveAgentSkillsDir(agent, opts)];
}

/** Every owned copy, including global fallback locations, uses the same set
 * for status, removal planning, and receipt retention. */
export function ownedSkillPaths(agent: AgentDefinition, slug: string, opts: InstallOptions): string[] {
  return ownedSkillDirs(agent, opts).map((dir) => join(dir, slug));
}

/** Never follow a parent link while deleting in the selected scope. The leaf
 * itself may be a link: removers unlink that entry, preserving its target. */
export function assertSafeRemovalParents(path: string, opts: InstallOptions): void {
  const root = resolve(opts.global ? homedir() : opts.projectRoot);
  const rel = relative(root, dirname(path));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Refusing removal outside the scope root: ${path}`);
  }
  let parent = root;
  for (const part of ["", ...rel.split(sep).filter(Boolean)]) {
    parent = join(parent, part);
    if (lstatSync(parent).isSymbolicLink()) {
      throw new Error(`Refusing removal through linked parent: ${parent}`);
    }
  }
}

export function extraSkillDirs(agent: AgentDefinition, opts: InstallOptions): string[] {
  const owned = new Set(ownedSkillDirs(agent, opts));
  const dirs = opts.global
    ? (agent.extraGlobalSkillsDirs ?? []).map(resolveTilde)
    : (agent.extraLocalSkillsDirs ?? []).map((dir) => join(opts.projectRoot, dir));
  return [...new Set(dirs)].filter((dir) => !owned.has(dir) && dir !== resolveEffectiveSkillsDir(agent, opts));
}

export function effectiveSkillDirs(agent: AgentDefinition, opts: InstallOptions): string[] {
  return [...new Set([resolveEffectiveSkillsDir(agent, opts), ...ownedSkillDirs(agent, opts), ...extraSkillDirs(agent, opts)])];
}

/** Pure transformer paths, with shared configuration separated from owned output. */
export function convertedSkillPaths(agent: AgentDefinition, slug: string, opts: InstallOptions): { owned: string[]; sharedConfig: string[] } {
  if (!agent.formatTransformer) return { owned: [], sharedConfig: [] };
  const root = resolveAgentInstallRoot(agent, opts);
  const files = agent.formatTransformer({ name: slug, description: "", body: "", originalFrontmatter: "" }, opts.global ? "user" : "project");
  const owned: string[] = [];
  const sharedConfig: string[] = [];
  for (const file of files) {
    const path = resolve(root, file.relativePath);
    if (file.op === "append-yaml-list") {
      // Aider's config intentionally sits outside its install root. It is
      // shared metadata, never a target for file removal.
      sharedConfig.push(path);
      continue;
    }
    const rel = relative(root, path);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`Refusing converted output outside the install root: ${path}`);
    }
    owned.push(path);
  }
  return { owned, sharedConfig };
}

/** One read-path set for status, canonical dependencies, and receipt retention. */
export function effectiveSkillFiles(agent: AgentDefinition, slug: string, opts: InstallOptions): string[] {
  return [...new Set([
    ...effectiveSkillDirs(agent, opts).map((dir) => join(dir, slug, "SKILL.md")),
    ...convertedSkillPaths(agent, slug, opts).owned,
  ])];
}

/** Shared by status and receipt retention, including partially remaining output. */
export function hasSkillFiles(agent: AgentDefinition, slug: string, opts: InstallOptions): boolean {
  return effectiveSkillFiles(agent, slug, opts).some(isSkillFile);
}

export function pathWithin(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Entries a successful read needs: traversed directories/links and the file.
 * realpath alone loses intermediate links, so cannot describe unlink effects.
 * Process link targets component by component: `link/..` means the target's
 * parent, and must not be normalized before following `link`.
 */
export function skillReadEntries(path: string): string[] | null {
  let current = parse(resolve(path)).root;
  let pending = resolve(path).slice(current.length).split(sep);
  const entries: string[] = [];
  let links = 0;
  try {
    while (pending.length > 0) {
      const part = pending.shift()!;
      if (!part || part === ".") continue;
      if (part === "..") { current = dirname(current); continue; }
      const next = join(current, part);
      const stat = lstatSync(next);
      entries.push(next);
      if (!stat.isSymbolicLink()) {
        if (pending.length > 0 && !stat.isDirectory()) return null;
        current = next;
        continue;
      }
      if (++links > 40) throw new Error(`Too many links while resolving ${path}`);
      const target = readlinkSync(next);
      if (isAbsolute(target)) current = parse(target).root;
      pending = [...target.slice(isAbsolute(target) ? current.length : 0).split(sep), ...pending];
    }
    return statSync(current).isFile() ? entries : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

/** A leaf link removes only its entry. A physical directory removes contained
 * entries, including links inside it, but never those links' outside targets. */
export function removalAffects(path: string, readEntries: readonly string[]): boolean {
  const entry = join(realpathSync(dirname(path)), basename(path));
  const directory = lstatSync(path).isDirectory();
  return readEntries.some((read) => directory ? pathWithin(read, entry) : read === entry);
}
