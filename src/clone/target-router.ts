// ---------------------------------------------------------------------------
// vskill clone — target-router
// ---------------------------------------------------------------------------
// Three target writers, all `.tmp`-staged so the orchestrator can atomically
// rename the staged copy into place once every other step (frontmatter
// rewrite, provenance write, validation) has succeeded.
//
//   writeStandalone  → drop the cloned skill at <dir>
//   writeToPlugin    → drop into <plugin>/skills/<skill> and append to manifest
//   writeNewPlugin   → scaffold a fresh plugin with .claude-plugin/plugin.json + skills/<skill>
//
// All three return the absolute path of the *staging* `.tmp` directory so the
// orchestrator can run subsequent in-place edits (frontmatter, sidecar) before
// committing with `fs.rename`. The ONLY exception is `writeToPlugin` which
// also returns a separate `manifestTmpPath` so the orchestrator can rename
// both `.tmp` paths in sequence (two-phase commit).
//
// Filtering: the recursive copy reuses the public `shouldSkipFromCommands`
// helper from src/shared/copy-plugin-filtered.ts plus a root-level filter for
// the vskill-internal sidecars `.vskill-meta.json` and `.vskill-source.json`
// (matching the OWN-scope copy semantics in src/studio/lib/scope-transfer.ts).
//
// See spec.md AC-US1-03 / AC-US2-01..03 / AC-US3-01, plan.md §5–§6.
// ---------------------------------------------------------------------------

import {
  promises as fs,
  existsSync,
  readdirSync,
  statSync,
  copyFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";

import { shouldSkipFromCommands } from "../shared/copy-plugin-filtered.js";

export interface CopyResult {
  /** Absolute path of the `.tmp` staging directory. Caller renames into place. */
  stagingDir: string;
  /** Number of files written under `stagingDir`. */
  filesCopied: number;
  /** Final destination path (where `stagingDir` should be renamed to). */
  finalDir: string;
}

export interface PluginCopyResult extends CopyResult {
  /** Absolute path of the `.tmp` staged plugin manifest (sibling of the live manifest). */
  manifestTmpPath: string;
  /** Absolute path of the live plugin manifest (final rename target). */
  manifestFinalPath: string;
}

/**
 * Recursive skill-dir copy with sidecar filtering at the root and
 * shouldSkipFromCommands filtering at every depth. Mirrors the OWN-scope
 * helper in src/studio/lib/scope-transfer.ts (lines 101–119) — that helper is
 * not exported, so we re-implement the same behavior rather than duplicate
 * its file.
 */
function copySkillDirFiltered(sourceDir: string, targetDir: string, relBase = ""): number {
  mkdirSync(targetDir, { recursive: true });
  let filesCopied = 0;
  for (const entry of readdirSync(sourceDir)) {
    // Filter vskill internal sidecars at the skill root only — same asymmetric
    // contract as scope-transfer.ts: OWN scope is a single skill dir, so
    // sidecars only ever exist at the root.
    if (!relBase && (entry === ".vskill-meta.json" || entry === ".vskill-source.json")) continue;
    const relPath = relBase ? `${relBase}/${entry}` : entry;
    const sourcePath = join(sourceDir, entry);
    const st = statSync(sourcePath);
    if (st.isDirectory()) {
      filesCopied += copySkillDirFiltered(sourcePath, join(targetDir, entry), relPath);
    } else if (st.isFile() && !shouldSkipFromCommands(relPath)) {
      copyFileSync(sourcePath, join(targetDir, entry));
      filesCopied += 1;
    }
  }
  return filesCopied;
}

/** Compute the `.tmp` sibling of a final destination path. */
export function tmpSibling(finalPath: string): string {
  return `${finalPath}.tmp`;
}

/**
 * Best-effort cleanup of a `.tmp` path. Mirrors the rollback shape used by
 * src/commands/add.ts:rollbackInstall — swallows per-call errors so a partial
 * filesystem state doesn't suppress the underlying diagnostic the orchestrator
 * is about to surface to the user.
 */
export function bestEffortRm(path: string): void {
  try {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Copy a source skill into a fresh standalone target dir, staged at
 * `<finalDir>.tmp`. The orchestrator is responsible for the atomic
 * rename and any pre-checks for collisions / `--force`.
 */
export async function writeStandalone(args: {
  sourceSkillDir: string;
  finalDir: string;
}): Promise<CopyResult> {
  const stagingDir = tmpSibling(args.finalDir);
  // Clear any leftover staging directory from a prior failed run before copying.
  bestEffortRm(stagingDir);
  await fs.mkdir(dirname(args.finalDir), { recursive: true });
  const filesCopied = copySkillDirFiltered(args.sourceSkillDir, stagingDir);
  return { stagingDir, filesCopied, finalDir: args.finalDir };
}

/**
 * Copy a source skill into an existing user-owned plugin's skills/ directory
 * AND stage an updated `plugin.json` at `<plugin.json>.tmp` so the
 * orchestrator can rename both in sequence (two-phase commit).
 *
 * Pre-flight: detects malformed plugin.json BEFORE any copy is staged
 * (AC-US2-03). Caller aborts on the thrown error; no skill files are written.
 */
export async function writeToPlugin(args: {
  sourceSkillDir: string;
  pluginRoot: string;
  newSkillName: string;
}): Promise<PluginCopyResult> {
  const manifestFinalPath = join(args.pluginRoot, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestFinalPath)) {
    throw new Error(
      `target plugin manifest not found at ${manifestFinalPath} — pass a plugin root that contains .claude-plugin/plugin.json`,
    );
  }

  // Pre-flight: parse the manifest BEFORE any copy is staged.
  let manifestRaw: string;
  try {
    manifestRaw = await fs.readFile(manifestFinalPath, "utf-8");
  } catch (err) {
    throw new Error(`failed to read plugin manifest: ${(err as Error).message}`);
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    throw new Error(
      `target plugin manifest is malformed JSON (${(err as Error).message}) — refusing to clone into ${args.pluginRoot}`,
    );
  }

  // The "register the new skill" step appends to a `skills` array (creating
  // one if absent). Existing entries are preserved; duplicate entries are
  // collapsed.
  const skills = Array.isArray(manifest.skills) ? [...(manifest.skills as unknown[])] : [];
  if (!skills.includes(args.newSkillName)) skills.push(args.newSkillName);
  const updatedManifest = { ...manifest, skills };

  const finalDir = join(args.pluginRoot, "skills", args.newSkillName);
  const stagingDir = tmpSibling(finalDir);
  bestEffortRm(stagingDir);

  await fs.mkdir(dirname(finalDir), { recursive: true });
  let filesCopied = 0;
  try {
    filesCopied = copySkillDirFiltered(args.sourceSkillDir, stagingDir);
  } catch (err) {
    bestEffortRm(stagingDir);
    throw err;
  }

  // Stage the updated manifest. The orchestrator commits both renames.
  const manifestTmpPath = `${manifestFinalPath}.tmp`;
  try {
    await fs.writeFile(
      manifestTmpPath,
      JSON.stringify(updatedManifest, null, 2) + "\n",
      "utf-8",
    );
  } catch (err) {
    bestEffortRm(stagingDir);
    bestEffortRm(manifestTmpPath);
    throw err;
  }

  return {
    stagingDir,
    filesCopied,
    finalDir,
    manifestTmpPath,
    manifestFinalPath,
  };
}

/**
 * Scaffold a fresh new plugin at `<pluginRoot>` containing
 * `.claude-plugin/plugin.json` (with the requested name) plus
 * `skills/<skill>/` subtree containing the cloned skill.
 *
 * The whole plugin tree is staged at `<pluginRoot>.tmp` and atomically
 * renamed by the caller — there is no two-phase commit because the manifest
 * and the skill files live under a common root (one `rename` is enough).
 */
export async function writeNewPlugin(args: {
  sourceSkillDir: string;
  pluginRoot: string;
  pluginName: string;
  newSkillName: string;
  /** Optional plugin description; defaults to a generic forked-skills line. */
  description?: string;
  /** Optional plugin author; recorded in plugin.json. */
  author?: string;
}): Promise<CopyResult> {
  const stagingDir = tmpSibling(args.pluginRoot);
  bestEffortRm(stagingDir);

  // Build the new plugin's manifest.
  await fs.mkdir(join(stagingDir, ".claude-plugin"), { recursive: true });
  const manifest: Record<string, unknown> = {
    name: args.pluginName,
    description:
      args.description ?? `Plugin scaffolded by 'vskill clone' containing forked skills.`,
    skills: [args.newSkillName],
  };
  if (args.author) {
    manifest.author = { name: args.author };
  }
  await fs.writeFile(
    join(stagingDir, ".claude-plugin", "plugin.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );

  // Copy the skill into <stagingDir>/skills/<newSkillName>/.
  const skillTargetDir = join(stagingDir, "skills", args.newSkillName);
  let filesCopied = 0;
  try {
    filesCopied = copySkillDirFiltered(args.sourceSkillDir, skillTargetDir);
  } catch (err) {
    bestEffortRm(stagingDir);
    throw err;
  }

  return { stagingDir, filesCopied, finalDir: args.pluginRoot };
}

/**
 * The `bareSkillName` helper extracts the unqualified skill name from a
 * fully-qualified name like `anton/ado-mapper` → `ado-mapper`. Used by the
 * orchestrator and by callers that need the directory-safe segment.
 */
export function bareSkillName(fullyQualified: string): string {
  const idx = fullyQualified.indexOf("/");
  return idx >= 0 ? fullyQualified.slice(idx + 1) : fullyQualified;
}

/** Re-export for callers that want to validate basenames. */
export { basename };
