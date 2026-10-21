import { lstatSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep, dirname } from "node:path";
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

/** Shared by status and receipt retention, including partially remaining output. */
export function hasSkillFiles(agent: AgentDefinition, slug: string, opts: InstallOptions): boolean {
  if (effectiveSkillDirs(agent, opts).some((dir) => isSkillFile(join(dir, slug, "SKILL.md")))) return true;
  return convertedSkillPaths(agent, slug, opts).owned.some(isSkillFile);
}
