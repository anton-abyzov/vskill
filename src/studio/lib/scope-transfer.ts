// ---------------------------------------------------------------------------
// scope-transfer — copy a skill between OWN / INSTALLED / GLOBAL scopes
// ---------------------------------------------------------------------------
// Used by /api/skills/:plugin/:skill/promote | test-install | revert routes.
// Reuses src/shared/copy-plugin-filtered.ts for file copy + filtering so the
// logic is shared with `vskill add`.
//
// Path contract (plan.md §2.3):
//   OWN        → <root>/skills/<skill>/
//   INSTALLED  → <root>/.claude/skills/<skill>/     (Claude-default; non-Claude agents deferred)
//   GLOBAL     → <home>/.claude/skills/<skill>/
//
// Provenance sidecar (.vskill-meta.json) must NEVER leak out of OWN scope —
// filtered inside transfer before invoking copy.
// ---------------------------------------------------------------------------

import { existsSync, rmSync, readdirSync, statSync, copyFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";

import type { SkillScope, TransferEvent } from "../types.js";
import {
  copyPluginFiltered,
  isSkillMdCandidate,
  shouldSkipFromCommands,
} from "../../shared/copy-plugin-filtered.js";

export interface TransferRequest {
  plugin: string;
  skill: string;
  fromScope: SkillScope;
  toScope: SkillScope;
  root: string;
  home: string;
  overwrite?: boolean;
}

export interface TransferResult {
  sourcePath: string;
  destPath: string;
  filesWritten: number;
}

export type SSEEmit = (e: TransferEvent) => void;

export class CollisionError extends Error {
  readonly path: string;
  readonly code = "collision" as const;
  constructor(path: string) {
    super(`destination already exists: ${path}`);
    this.name = "CollisionError";
    this.path = path;
  }
}

export class MissingSourceError extends Error {
  readonly path: string;
  readonly code = "missing-source" as const;
  constructor(path: string) {
    super(`source path missing: ${path}`);
    this.name = "MissingSourceError";
    this.path = path;
  }
}

export function resolveScopePath(
  scope: SkillScope,
  root: string,
  skill: string,
  home: string,
): string {
  switch (scope) {
    case "own":
      return join(root, "skills", skill);
    case "installed":
      return join(root, ".claude", "skills", skill);
    case "global":
      return join(home, ".claude", "skills", skill);
  }
}

/**
 * Count files written recursively into a directory — used for the SSE
 * `copied` event payload.
 */
function countFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) n += countFiles(full);
    else if (st.isFile()) n += 1;
  }
  return n;
}

/**
 * Copy a OWN skill directory filtering out `.vskill-meta.json`. Unlike
 * copyPluginFiltered this does not do the plugin-root flattening, because
 * OWN → INSTALLED|GLOBAL is a straight skill-dir copy with one exclusion.
 */
function copyOwnSkillFiltered(sourceDir: string, targetDir: string, relBase = ""): void {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir)) {
    if (!relBase && entry === ".vskill-meta.json") continue;
    const relPath = relBase ? `${relBase}/${entry}` : entry;
    const sourcePath = join(sourceDir, entry);
    const st = statSync(sourcePath);
    if (st.isDirectory()) {
      copyOwnSkillFiltered(sourcePath, join(targetDir, entry), relPath);
    } else if (st.isFile() && !shouldSkipFromCommands(relPath)) {
      copyFileSync(sourcePath, join(targetDir, entry));
    }
  }
  void isSkillMdCandidate;
  void basename;
}

export async function transfer(req: TransferRequest, emit: SSEEmit): Promise<TransferResult> {
  const sourcePath = resolveScopePath(req.fromScope, req.root, req.skill, req.home);
  const destPath = resolveScopePath(req.toScope, req.root, req.skill, req.home);

  if (!existsSync(sourcePath)) {
    throw new MissingSourceError(sourcePath);
  }

  if (existsSync(destPath) && !req.overwrite) {
    throw new CollisionError(destPath);
  }

  // If overwrite, clear the destination first so stale files aren't left behind.
  if (existsSync(destPath) && req.overwrite) {
    rmSync(destPath, { recursive: true, force: true });
  }

  // Branch on direction — OWN → * uses the sidecar-filtering copier,
  // * → OWN uses the plugin-root copier (which already ignores PLUGIN.md etc
  // and promotes SKILL.md candidates).
  if (req.fromScope === "own") {
    copyOwnSkillFiltered(sourcePath, destPath);
  } else {
    copyPluginFiltered(sourcePath, destPath);
  }

  const filesWritten = countFiles(destPath);

  emit({ type: "copied", filesWritten });

  return { sourcePath, destPath, filesWritten };
}
