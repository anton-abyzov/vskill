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

import { existsSync, rmSync, readdirSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Cap recursion depth on user-content trees we don't fully control.
// 32 is well above any realistic skill nesting (plan.md skills have 0–3
// levels) and safely below Node's default call-stack budget.
const MAX_RECURSION_DEPTH = 32;

import type { SkillScope, TransferEvent } from "../types.js";
import {
  copyPluginFiltered,
  shouldSkipFromCommands,
} from "../../shared/copy-plugin-filtered.js";
import { resolveSourceLink } from "../../eval-server/source-link.js";

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
 * `copied` and `deleted` event payloads. Returns 0 for missing dirs so
 * callers can use it on paths that may have been removed mid-flight.
 *
 * Skips symlinks (lstat) to avoid following loops, and caps depth at
 * MAX_RECURSION_DEPTH so a pathological tree can't blow the call stack.
 */
export function countFiles(dir: string, depth = 0): number {
  if (!existsSync(dir)) return 0;
  if (depth >= MAX_RECURSION_DEPTH) return 0;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(full, depth + 1);
    else if (entry.isFile()) n += 1;
  }
  return n;
}

/**
 * Copy a OWN skill directory filtering out `.vskill-meta.json`. Unlike
 * copyPluginFiltered this does not do the plugin-root flattening, because
 * OWN → INSTALLED|GLOBAL is a straight skill-dir copy with one exclusion.
 */
function copyOwnSkillFiltered(sourceDir: string, targetDir: string, relBase = "", depth = 0): void {
  if (depth >= MAX_RECURSION_DEPTH) return;
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    // 0809: filter the copied-skill source-link sidecar at the OWN scope root
    // alongside the existing .vskill-meta.json filter. Sidecars are re-derived
    // by the destination's `transfer()` post-copy step, never copied through.
    // Asymmetric with copyPluginFiltered (which strips at any depth) on purpose:
    // OWN scope is a single skill dir, so sidecars only ever exist at the root.
    if (!relBase && (entry.name === ".vskill-meta.json" || entry.name === ".vskill-source.json")) continue;
    // Skip symlinks defensively — copying through them risks loops and
    // unexpected escapes from the skill dir.
    if (entry.isSymbolicLink()) continue;
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
    const sourcePath = join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      copyOwnSkillFiltered(sourcePath, join(targetDir, entry.name), relPath, depth + 1);
    } else if (entry.isFile() && !shouldSkipFromCommands(relPath)) {
      copyFileSync(sourcePath, join(targetDir, entry.name));
    }
  }
}

/**
 * Pre-flight check that a transfer can succeed. Throws MissingSourceError /
 * CollisionError without touching the filesystem. Routes call this BEFORE
 * opening an SSE stream so failure cases return clean HTTP 404 / 409 with
 * a JSON body instead of opening SSE then immediately emitting an error.
 */
export function validatePaths(
  sourcePath: string,
  destPath: string,
  overwrite: boolean,
): void {
  if (!existsSync(sourcePath)) throw new MissingSourceError(sourcePath);
  if (existsSync(destPath) && !overwrite) throw new CollisionError(destPath);
}

export async function transfer(req: TransferRequest, emit: SSEEmit): Promise<TransferResult> {
  const sourcePath = resolveScopePath(req.fromScope, req.root, req.skill, req.home);
  const destPath = resolveScopePath(req.toScope, req.root, req.skill, req.home);

  // Re-validate inside transfer too — callers may call transfer() directly
  // (not via the route layer) and expect the throw contract.
  validatePaths(sourcePath, destPath, req.overwrite ?? false);

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

  // 0809 — Snapshot the SOURCE skill's source-link provenance into a
  // `.vskill-source.json` sidecar in the destination so that downstream
  // /api/skills resolution can render the same `↗` GitHub anchor that
  // lockfile-installed and authored skills already get. The resolver's
  // own precedence chain handles chained copies: when the source itself
  // has a sidecar pointing to repo X, resolveSourceLink returns X and
  // the destination snapshots X (NOT the intermediate copy location).
  // We only write when the source has a resolvable repoUrl — otherwise
  // the destination is byte-for-byte identical to the pre-0809 behavior.
  try {
    const sourceLink = resolveSourceLink(sourcePath, req.root);
    if (sourceLink.repoUrl) {
      writeFileSync(
        join(destPath, ".vskill-source.json"),
        JSON.stringify(sourceLink, null, 2),
      );
    }
  } catch (err) {
    // resolver / write failure must never break the copy itself, but we
    // surface a breadcrumb so a degraded byline (no GitHub anchor on a
    // copied skill that should have had one) is debuggable.
    console.warn("[scope-transfer] sidecar write skipped:", (err as Error)?.message ?? err);
  }

  const filesWritten = countFiles(destPath);

  emit({ type: "copied", filesWritten });

  return { sourcePath, destPath, filesWritten };
}
