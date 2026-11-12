// ---------------------------------------------------------------------------
// vskill skill publish <name> -- find which repo and SKILL.md a skill name
// means, then run the same public submit as `vskill submit`.
//
// Lookup order: the authored-skills file (vskill.authored.json, written after
// a successful submit), then tracked SKILL.md files in the current git
// checkout. When neither names it, print the exact submit command to run.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import { readAuthored } from "../lockfile/authored.js";
import { getProjectRoot } from "../lockfile/project-root.js";
import { existsSync } from "node:fs";
import {
  findTrackedSkill,
  readLocalCheckout,
  sameRepo,
  toRepoPath,
  type LocalCheckout,
} from "../lib/git-checkout.js";
import { cyan, dim, red } from "../utils/output.js";
import { validateSkillName } from "../utils/validation.js";
import { submitCommand } from "./submit.js";

export interface ResolvedPublish {
  source: string;
  skill: string;
  /** Repo-relative SKILL.md path. */
  path?: string;
  /** Absolute SKILL.md in a local checkout of `source`, when there is one. */
  localFile?: string;
}

function lastSegment(name: string): string {
  const parts = name.split("/");
  return parts[parts.length - 1];
}

function fromAuthored(name: string, projectRoot: string): ResolvedPublish | null {
  const entries = readAuthored(projectRoot);
  const match =
    entries.find((e) => e.name === name) ??
    (name.includes("/") ? undefined : entries.find((e) => lastSegment(e.name) === name));
  if (!match) return null;
  const parts = match.name.split("/");
  if (parts.length < 3) return null;
  const [owner, repo] = parts;
  const skill = lastSegment(match.name);
  const abs = path.isAbsolute(match.sourcePath) ? match.sourcePath : path.join(projectRoot, match.sourcePath);
  const checkout = readLocalCheckout(path.dirname(abs));
  const repoPath = sameRepo(checkout, owner, repo) ? toRepoPath(checkout, abs) : null;
  return {
    source: `${owner}/${repo}`,
    skill,
    ...(repoPath ? { path: repoPath } : {}),
    ...(repoPath && existsSync(abs) ? { localFile: abs } : {}),
  };
}

function fromCheckout(name: string, checkout: LocalCheckout | null): ResolvedPublish | null {
  if (!checkout?.owner || !checkout.repo) return null;
  const wanted = lastSegment(name);
  const match = findTrackedSkill(checkout, wanted);
  if (!match) return null;
  return {
    source: `${checkout.owner}/${checkout.repo}`,
    skill: match.name ?? wanted,
    path: match.repoPath,
    localFile: match.file,
  };
}

/** Resolve a skill name to owner/repo + skill + repo-relative SKILL.md, or null. */
export function resolvePublishTarget(name: string, cwd: string = process.cwd()): ResolvedPublish | null {
  const checkout = readLocalCheckout(cwd);
  const roots = [...new Set([getProjectRoot(cwd), ...(checkout ? [checkout.root] : [])])];
  for (const root of roots) {
    const authored = fromAuthored(name, root);
    if (authored) return authored;
  }
  const local = fromCheckout(name, checkout);
  if (local) return local;
  // A full owner/repo/skill name is enough on its own.
  const parts = name.split("/");
  if (parts.length === 3) return { source: `${parts[0]}/${parts[1]}`, skill: parts[2] };
  return null;
}

export async function skillPublishCommand(name: string, opts: { wait?: boolean } = {}): Promise<void> {
  const segments = name.split("/");
  if (segments.length > 3 || !segments.every((seg) => validateSkillName(seg))) {
    console.error(red("Invalid skill name. ") + dim("Path traversal patterns are not allowed."));
    process.exit(1);
  }
  const target = resolvePublishTarget(name);
  if (!target) {
    const checkout = readLocalCheckout(process.cwd());
    const repo = checkout?.owner && checkout.repo ? `${checkout.owner}/${checkout.repo}` : "<owner>/<repo>";
    console.error(red(`Could not find which repository holds the skill "${name}".`));
    console.error(dim("It is not in vskill.authored.json and no tracked SKILL.md in this checkout is named that."));
    console.error(dim("Submit it directly:"));
    console.error("  " + cyan(`vskill submit ${repo} --skill ${name} --path <path/to/SKILL.md>`));
    process.exit(1);
  }
  console.log(dim(`Publishing ${target.skill} from ${target.source}${target.path ? ` (${target.path})` : ""}`));
  // A local SKILL.md goes over as its absolute path, so the version write-back
  // and authored tracking work from any subfolder, and submit runs the same
  // committed / pushed / default-branch checks as a no-argument submit.
  await submitCommand(target.source, {
    skill: target.skill,
    path: target.localFile ?? target.path,
    wait: opts.wait,
    ...(target.localFile ? { checkLocal: true } : {}),
  });
}
