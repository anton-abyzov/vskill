// ---------------------------------------------------------------------------
// vskill clone — orchestrator
// ---------------------------------------------------------------------------
// Drives the 9-step atomic pipeline described in plan.md §5:
//
//   1. Validate source (exists, SKILL.md parseable)
//   2. Resolve target (collision check; honor --force)
//   3. Copy via target-router into <target>.tmp
//   4. applyForkMetadata to <target>.tmp/SKILL.md
//   5. writeForkProvenance to <target>.tmp/.vskill-meta.json
//   6. Validate cloned (frontmatter parses; agents/* references resolve)
//   7. (plugin target only) stage updated plugin.json at <plugin.json>.tmp
//   8. Atomic rename(s) — and only at this point delete the live target if --force
//   9. Optional `runGh repo create + push` — never on partial state
//
// Failure path: any throw before step 8 triggers `bestEffortRm` on every
// staged `.tmp` path. The shape is deliberately the same as
// src/commands/add.ts:rollbackInstall (best-effort rm, swallow per-call errors)
// so a partial filesystem state never suppresses the underlying diagnostic.
//
// See spec AC-US6-01..03, AC-US1-01..04, AC-US2-01..03, AC-US3-01..03.
// ---------------------------------------------------------------------------

import { existsSync, promises as fs } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { homedir } from "node:os";

import { applyForkMetadata } from "../installer/frontmatter.js";
import {
  locateSkill,
  enumeratePluginSkills,
} from "../clone/skill-locator.js";
import { scanReferences, scanSelfNameOccurrences } from "../clone/reference-scanner.js";
import { writeForkProvenance } from "../clone/provenance-fork.js";
import {
  bestEffortRm,
  bareSkillName,
  tmpSibling,
  writeNewPlugin,
  writeStandalone,
  writeToPlugin,
  type CopyResult,
  type PluginCopyResult,
} from "../clone/target-router.js";
import { scaffoldGitHub, type RunGh } from "../clone/github-scaffold.js";
import type {
  CloneResult,
  CloneTargetKind,
  ReferenceMatch,
  SkillSource,
  SkillSourceLocation,
} from "../clone/types.js";
import { bold, cyan, dim, green, red, yellow } from "../utils/output.js";
import { confirmPrompt, promptInput, promptChoice } from "./clone-prompts.js";

export interface CloneCommandOptions {
  target?: CloneTargetKind;
  path?: string;
  plugin?: string;
  pluginName?: string;
  author?: string;
  namespace?: string;
  github?: boolean;
  force?: boolean;
  source?: SkillSourceLocation;
  dryRun?: boolean;
  /** Auto-confirm all prompts (--yes / -y). */
  yes?: boolean;
  /** Override home — used for tests. */
  home?: string;
  /** Override cwd — used for tests. */
  cwd?: string;
  /** Injectable `gh` adapter for tests. */
  runGh?: RunGh;
  /** When true, error messages are thrown instead of printed (used for tests / whole-plugin path). */
  throwOnError?: boolean;
}

const TARGET_KINDS: ReadonlyArray<CloneTargetKind> = ["standalone", "plugin", "new-plugin"];
const SOURCE_LOCATIONS: ReadonlyArray<SkillSourceLocation> = ["project", "personal", "cache"];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

async function detectGitUserName(cwd: string): Promise<string | undefined> {
  try {
    const { spawn } = await import("node:child_process");
    return await new Promise<string | undefined>((resolveName) => {
      const child = spawn("git", ["config", "user.name"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      child.stdout?.on("data", (c) => {
        stdout += c.toString();
      });
      child.on("error", () => resolveName(undefined));
      child.on("close", () => {
        const trimmed = stdout.trim();
        resolveName(trimmed || undefined);
      });
    });
  } catch {
    return undefined;
  }
}

/**
 * Disambiguate when multiple sources match. When --source is provided, filter
 * to that location; otherwise prompt the user to pick (or take the first match
 * in non-TTY environments).
 */
async function disambiguateSource(
  matches: SkillSource[],
  preferred: SkillSourceLocation | undefined,
): Promise<SkillSource> {
  if (matches.length === 0) {
    throw new Error("no source matches");
  }
  if (preferred) {
    const filtered = matches.filter((m) => m.location === preferred);
    if (filtered.length === 0) {
      throw new Error(
        `--source ${preferred} did not match any installed skill (found locations: ${matches.map((m) => m.location).join(", ")})`,
      );
    }
    return filtered[0];
  }
  if (matches.length === 1) return matches[0];

  if (!process.stdin.isTTY) {
    // Non-interactive: take the first match in deterministic search order.
    return matches[0];
  }

  const labels = matches.map((m) => `${m.location}: ${m.skillDir}`);
  const choice = await promptChoice("Multiple matches found — choose source:", labels);
  return matches[choice];
}

function describeCloneSummary(result: CloneResult): string {
  const lines: string[] = [];
  lines.push(green(`✔ Cloned ${cyan(result.source.skillName)} → ${cyan(result.finalSkillName)}`));
  lines.push(dim(`  source:   ${result.source.skillDir} (${result.source.location})`));
  lines.push(dim(`  target:   ${result.target.targetSkillDir}`));
  lines.push(dim(`  files:    ${result.filesCopied}`));
  if (result.provenance.forkChain && result.provenance.forkChain.length > 0) {
    lines.push(dim(`  fork chain: ${result.provenance.forkChain.join(" → ")}`));
  }
  if (result.referenceReport.length > 0) {
    lines.push("");
    lines.push(yellow(`Cross-skill references found (review manually — NOT auto-rewritten):`));
    for (const m of result.referenceReport) {
      lines.push(dim(`  ${m.file}:${m.line}  [${m.kind}]  ${m.match}`));
    }
  }
  if (result.selfNameMatches.length > 0) {
    lines.push("");
    lines.push(yellow(`Old skill name occurrences in prose (review manually):`));
    for (const m of result.selfNameMatches) {
      lines.push(dim(`  ${m.file}:${m.line}  ${m.match}`));
    }
  }
  if (result.githubRepoUrl) {
    lines.push("");
    lines.push(green(`✔ GitHub repo created: ${result.githubRepoUrl}`));
  }
  return lines.join("\n");
}

/**
 * Recursively scan a skill directory for cross-skill references and
 * self-name occurrences across SKILL.md and any .md files in subdirectories
 * (e.g., agents/*.md). Operates on the staged `.tmp` content so the report
 * reflects what actually got copied.
 */
async function scanCopiedSkill(
  stagingDir: string,
  oldSkillName: string,
): Promise<{ refs: ReferenceMatch[]; selfNames: ReferenceMatch[] }> {
  const refs: ReferenceMatch[] = [];
  const selfNames: ReferenceMatch[] = [];

  async function walk(dir: string, relBase: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const rel = relBase ? `${relBase}/${entry}` : entry;
      const st = await fs.stat(full);
      if (st.isDirectory()) {
        await walk(full, rel);
      } else if (st.isFile() && entry.endsWith(".md")) {
        const content = await fs.readFile(full, "utf-8");
        refs.push(...scanReferences(content, { oldSkillName, file: rel }));
        selfNames.push(...scanSelfNameOccurrences(content, { oldSkillName, file: rel }));
      }
    }
  }

  await walk(stagingDir, "");
  return { refs, selfNames };
}

/**
 * Validate the staged clone: SKILL.md must parse and any `agents/*.md`
 * referenced by frontmatter must exist. Throws on any inconsistency.
 */
async function validateStagedClone(stagingDir: string): Promise<void> {
  const skillMd = join(stagingDir, "SKILL.md");
  if (!existsSync(skillMd)) {
    throw new Error(`staged clone missing SKILL.md at ${skillMd}`);
  }
  const raw = await fs.readFile(skillMd, "utf-8");
  if (!/^---\n[\s\S]*?\n---/.test(raw.replace(/\r\n/g, "\n"))) {
    throw new Error(`staged clone SKILL.md is missing a YAML frontmatter block`);
  }
}

interface ResolvedCloneArgs {
  source: SkillSource;
  targetKind: CloneTargetKind;
  newSkillBase: string;
  newSkillFullName: string;
  author: string;
  namespace: string;
  finalDir: string;
  pluginRoot?: string;
  pluginName?: string;
}

async function resolveArgs(
  positionalSource: string,
  opts: CloneCommandOptions,
  homePath: string,
  cwdPath: string,
): Promise<ResolvedCloneArgs> {
  // 1. locate source
  const matches = await locateSkill(positionalSource, { home: homePath, cwd: cwdPath });
  if (matches.length === 0) {
    throw new Error(
      `no installed skill named "${positionalSource}" found in project (.claude/skills), personal (~/.claude/skills), or plugin cache`,
    );
  }
  const source = await disambiguateSource(matches, opts.source);

  // 2. target kind
  let targetKind: CloneTargetKind | undefined = opts.target;
  if (!targetKind) {
    if (!process.stdin.isTTY) {
      throw new Error(`--target is required (one of ${TARGET_KINDS.join(", ")})`);
    }
    const idx = await promptChoice("Target shape?", TARGET_KINDS as unknown as string[]);
    targetKind = TARGET_KINDS[idx];
  }

  // 3. author / namespace
  let author = opts.author;
  if (!author) {
    author = await detectGitUserName(cwdPath);
  }
  if (!author) {
    if (!process.stdin.isTTY) {
      throw new Error("--author is required (could not detect from `git config user.name`)");
    }
    author = await promptInput("Author name?");
  }
  let namespace = opts.namespace || slugify(author);
  if (!namespace) {
    throw new Error("namespace is empty — pass --namespace explicitly");
  }

  const bareSrc = bareSkillName(source.skillName);
  const newSkillBase = bareSrc;
  const newSkillFullName = `${namespace}/${newSkillBase}`;

  // 4. resolve final destination by target kind
  let finalDir: string;
  let pluginRoot: string | undefined;
  let pluginName: string | undefined;
  switch (targetKind) {
    case "standalone": {
      if (!opts.path) {
        if (!process.stdin.isTTY) throw new Error("--path is required for --target standalone");
        opts.path = await promptInput("Standalone path?");
      }
      finalDir = resolve(opts.path);
      break;
    }
    case "plugin": {
      if (!opts.plugin) {
        if (!process.stdin.isTTY) throw new Error("--plugin is required for --target plugin");
        opts.plugin = await promptInput("Existing plugin path?");
      }
      pluginRoot = resolve(opts.plugin);
      finalDir = join(pluginRoot, "skills", newSkillBase);
      break;
    }
    case "new-plugin": {
      if (!opts.path) {
        if (!process.stdin.isTTY) throw new Error("--path is required for --target new-plugin");
        opts.path = await promptInput("New plugin path?");
      }
      if (!opts.pluginName) {
        if (!process.stdin.isTTY) throw new Error("--plugin-name is required for --target new-plugin");
        opts.pluginName = await promptInput("New plugin name?");
      }
      pluginRoot = resolve(opts.path);
      pluginName = opts.pluginName;
      finalDir = join(pluginRoot, "skills", newSkillBase);
      break;
    }
  }

  return {
    source,
    targetKind,
    newSkillBase,
    newSkillFullName,
    author,
    namespace,
    finalDir,
    pluginRoot,
    pluginName,
  };
}

/**
 * Run the clone pipeline. Returns the CloneResult on success. On failure,
 * cleans up every staged `.tmp` path before propagating the error.
 *
 * The function is exported for use by the whole-plugin path (T-010) and unit
 * tests; the CLI entry point is `cloneCommand` below.
 */
export async function runCloneOnce(
  resolved: ResolvedCloneArgs,
  opts: CloneCommandOptions,
): Promise<CloneResult> {
  const stagingPaths: string[] = [];
  let copy: CopyResult | PluginCopyResult | null = null;
  let pluginRootStaging: string | undefined;

  try {
    // STEP 2 — collision check (real disk). Final rename is the last write step.
    if (existsSync(resolved.finalDir) && !opts.force) {
      throw new Error(
        `target already exists: ${resolved.finalDir} (pass --force to overwrite)`,
      );
    }

    // For new-plugin, the *plugin root* must also be checked for collision
    // since writeNewPlugin stages the entire pluginRoot at <pluginRoot>.tmp.
    if (resolved.targetKind === "new-plugin" && resolved.pluginRoot) {
      if (existsSync(resolved.pluginRoot) && !opts.force) {
        throw new Error(
          `target plugin root already exists: ${resolved.pluginRoot} (pass --force to overwrite)`,
        );
      }
    }

    if (opts.dryRun) {
      console.log(dim(`[dry-run] would clone ${resolved.source.skillName} → ${resolved.newSkillFullName}`));
      console.log(dim(`[dry-run] target: ${resolved.targetKind} ${resolved.finalDir}`));
      // Emit a synthetic CloneResult so callers (whole-plugin path) can iterate without writing.
      return {
        source: resolved.source,
        target: {
          kind: resolved.targetKind,
          targetSkillDir: resolved.finalDir,
        },
        finalSkillName: resolved.newSkillFullName,
        filesCopied: 0,
        referenceReport: [],
        selfNameMatches: [],
        githubRepoUrl: null,
        provenance: {
          promotedFrom: "global",
          sourcePath: resolved.source.skillDir,
          promotedAt: Date.now(),
          forkedFrom: {
            source: resolved.source.skillName,
            version: resolved.source.version,
            clonedAt: new Date().toISOString(),
          },
        },
      };
    }

    // STEP 3 — copy to .tmp
    if (resolved.targetKind === "standalone") {
      copy = await writeStandalone({
        sourceSkillDir: resolved.source.skillDir,
        finalDir: resolved.finalDir,
      });
      stagingPaths.push(copy.stagingDir);
    } else if (resolved.targetKind === "plugin") {
      if (!resolved.pluginRoot) throw new Error("internal: pluginRoot missing for --target plugin");
      copy = await writeToPlugin({
        sourceSkillDir: resolved.source.skillDir,
        pluginRoot: resolved.pluginRoot,
        newSkillName: resolved.newSkillBase,
      });
      stagingPaths.push(copy.stagingDir);
      stagingPaths.push((copy as PluginCopyResult).manifestTmpPath);
    } else {
      // new-plugin
      if (!resolved.pluginRoot || !resolved.pluginName) {
        throw new Error("internal: pluginRoot or pluginName missing for --target new-plugin");
      }
      copy = await writeNewPlugin({
        sourceSkillDir: resolved.source.skillDir,
        pluginRoot: resolved.pluginRoot,
        pluginName: resolved.pluginName,
        newSkillName: resolved.newSkillBase,
        author: resolved.author,
      });
      pluginRootStaging = copy.stagingDir;
      stagingPaths.push(copy.stagingDir);
    }

    // STEP 4 — applyForkMetadata to the staged SKILL.md
    const stagedSkillMd =
      resolved.targetKind === "new-plugin"
        ? join(pluginRootStaging!, "skills", resolved.newSkillBase, "SKILL.md")
        : join(copy.stagingDir, "SKILL.md");

    const skillMdContent = await fs.readFile(stagedSkillMd, "utf-8");
    const rewritten = applyForkMetadata(skillMdContent, {
      name: resolved.newSkillFullName,
      author: resolved.author,
      version: "1.0.0",
      forkedFrom: resolved.source.skillName,
    });
    await fs.writeFile(stagedSkillMd, rewritten, "utf-8");

    // STEP 5 — write fork provenance to staged sidecar
    const provenanceTargetDir =
      resolved.targetKind === "new-plugin"
        ? join(pluginRootStaging!, "skills", resolved.newSkillBase)
        : copy.stagingDir;

    const provenance = await writeForkProvenance({
      targetSkillDir: provenanceTargetDir,
      forkedFrom: {
        source: resolved.source.skillName,
        version: resolved.source.version,
        clonedAt: new Date().toISOString(),
      },
      sourceProvenance: resolved.source.existingProvenance,
      sourcePath: resolved.source.skillDir,
      sourceVersion: resolved.source.version,
    });

    // STEP 6 — validate staged clone
    await validateStagedClone(provenanceTargetDir);

    // STEP 6b — reference scan on the staged content
    const { refs, selfNames } = await scanCopiedSkill(provenanceTargetDir, resolved.source.skillName);

    // STEP 8 — atomic rename(s). If --force, remove the live target only NOW,
    // immediately before the rename, to minimize the window where the user
    // has neither the old nor new copy on disk.
    if (resolved.targetKind === "new-plugin") {
      // Single-rename: <pluginRoot>.tmp → <pluginRoot>
      if (opts.force && existsSync(resolved.pluginRoot!)) {
        await fs.rm(resolved.pluginRoot!, { recursive: true, force: true });
      }
      await fs.rename(pluginRootStaging!, resolved.pluginRoot!);
    } else if (resolved.targetKind === "plugin") {
      // Two-phase commit: rename skill dir, then manifest. If the manifest
      // rename fails, roll back the skill rename.
      const pluginCopy = copy as PluginCopyResult;
      // .bak staging for --force + plugin (AC-US2-01): rename the live target
      // to <finalDir>.bak so a manifest-rename failure can restore the
      // original. Removed via bestEffortRm only after both renames succeed.
      let bakDir: string | undefined;
      if (opts.force && existsSync(resolved.finalDir)) {
        bakDir = `${resolved.finalDir}.bak`;
        bestEffortRm(bakDir);
        await fs.rename(resolved.finalDir, bakDir);
      }
      try {
        await fs.rename(pluginCopy.stagingDir, resolved.finalDir);
        await fs.rename(pluginCopy.manifestTmpPath, pluginCopy.manifestFinalPath);
      } catch (err) {
        // Roll back the skill-dir rename on manifest failure.
        try {
          await fs.rm(resolved.finalDir, { recursive: true, force: true });
        } catch {
          // best-effort
        }
        // Restore original from .bak if we staged it. AC-US2-02: if the
        // restore-rename itself fails, keep .bak on disk and warn loudly so
        // the user can recover manually.
        if (bakDir) {
          try {
            await fs.rename(bakDir, resolved.finalDir);
          } catch {
            process.stderr.write(
              `WARNING: failed to restore from .bak at ${bakDir} — manual recovery needed\n`,
            );
          }
        }
        throw new Error(
          `manifest update failed; rolled back skill copy: ${(err as Error).message}`,
        );
      }
      // Both renames succeeded — drop the .bak.
      if (bakDir) bestEffortRm(bakDir);
    } else {
      // standalone
      if (opts.force && existsSync(resolved.finalDir)) {
        await fs.rm(resolved.finalDir, { recursive: true, force: true });
      }
      await fs.rename(copy.stagingDir, resolved.finalDir);
    }

    // STEP 9 — optional gh
    let githubRepoUrl: string | null = null;
    if (opts.github && resolved.targetKind === "new-plugin") {
      const ghRes = await scaffoldGitHub({
        pluginDir: resolved.pluginRoot!,
        repoName: resolved.pluginName!,
        runGh: opts.runGh,
      });
      if (ghRes.skipped) {
        console.warn(yellow(`[gh] skipped: ${ghRes.reason}`));
      } else {
        githubRepoUrl = ghRes.repoUrl ?? null;
      }
    } else if (opts.github && resolved.targetKind !== "new-plugin") {
      console.warn(
        yellow("[gh] --github is only supported with --target new-plugin; skipping repo creation."),
      );
    }

    return {
      source: resolved.source,
      target: {
        kind: resolved.targetKind,
        targetSkillDir: resolved.finalDir,
        existingPluginManifestPath:
          resolved.targetKind === "plugin"
            ? join(resolved.pluginRoot!, ".claude-plugin", "plugin.json")
            : undefined,
        newPluginRoot: resolved.targetKind === "new-plugin" ? resolved.pluginRoot : undefined,
        newPluginName: resolved.pluginName,
      },
      finalSkillName: resolved.newSkillFullName,
      filesCopied: copy.filesCopied,
      referenceReport: refs,
      selfNameMatches: selfNames,
      githubRepoUrl,
      provenance,
    };
  } catch (err) {
    // Best-effort cleanup of every staged path.
    for (const p of stagingPaths) bestEffortRm(p);
    throw err;
  }
}

/** CLI entry point (Commander action). */
export async function cloneCommand(
  source: string | undefined,
  opts: CloneCommandOptions,
): Promise<void> {
  const homePath = opts.home ?? homedir();
  const cwdPath = opts.cwd ?? process.cwd();

  // Validate flag combinations early.
  if (opts.target && !TARGET_KINDS.includes(opts.target)) {
    console.error(red(`--target must be one of: ${TARGET_KINDS.join(", ")}`));
    process.exit(1);
  }
  if (opts.source && !SOURCE_LOCATIONS.includes(opts.source)) {
    console.error(red(`--source must be one of: ${SOURCE_LOCATIONS.join(", ")}`));
    process.exit(1);
  }

  // Whole-plugin path (T-010): --plugin <name> with no positional source.
  if (!source && opts.plugin) {
    await runWholePluginClone(opts.plugin, opts, homePath, cwdPath);
    return;
  }

  if (!source) {
    console.error(red(`source skill name is required (or pass --plugin <name> for whole-plugin clone)`));
    process.exit(1);
  }

  let resolved: ResolvedCloneArgs;
  try {
    resolved = await resolveArgs(source, opts, homePath, cwdPath);
  } catch (err) {
    console.error(red((err as Error).message));
    process.exit(1);
  }

  let result: CloneResult;
  try {
    result = await runCloneOnce(resolved, opts);
  } catch (err) {
    console.error(red(`clone failed: ${(err as Error).message}`));
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(dim(`[dry-run] no files written.`));
    return;
  }

  console.log(describeCloneSummary(result));
}

/**
 * Whole-plugin clone path (T-010). Delegated to its own module is overkill —
 * the orchestration is small and shares all the same primitives.
 */
async function runWholePluginClone(
  pluginName: string,
  opts: CloneCommandOptions,
  homePath: string,
  cwdPath: string,
): Promise<void> {
  const skills = await enumeratePluginSkills(pluginName, { home: homePath, cwd: cwdPath });
  if (skills.length === 0) {
    console.error(red(`no skills found in plugin "${pluginName}" under ~/.claude/plugins/cache`));
    process.exit(1);
  }

  // Author / namespace defaulting (same logic as resolveArgs).
  let author = opts.author ?? (await detectGitUserName(cwdPath));
  if (!author) {
    if (!process.stdin.isTTY) {
      console.error(red(`--author is required (could not detect from \`git config user.name\`)`));
      process.exit(1);
    }
    author = await promptInput("Author name?");
  }
  const namespace = opts.namespace || slugify(author);
  if (!namespace) {
    console.error(red(`namespace resolved to empty — pass --namespace explicitly`));
    process.exit(1);
  }

  const targetKind: CloneTargetKind = opts.target ?? "standalone";
  if (targetKind === "plugin" && !opts.plugin) {
    console.error(red(`--plugin <name> conflicts with whole-plugin clone target=plugin without an explicit destination plugin`));
    process.exit(1);
  }
  if ((targetKind === "standalone" || targetKind === "new-plugin") && !opts.path) {
    console.error(red(`--path is required for whole-plugin clone (it is the parent directory under which each cloned skill lands)`));
    process.exit(1);
  }

  // Confirmation listing (AC-US4-02).
  console.log(bold(`Whole-plugin clone — ${cyan(pluginName)}:`));
  for (const s of skills) {
    console.log(`  ${dim("→")} ${s.skillName} ${dim(`(${s.location}, ${s.version})`)}`);
  }
  console.log(
    dim(`Each will be cloned under namespace ${cyan(namespace)} as a ${targetKind} target.`),
  );
  if (!opts.dryRun) {
    const ok = await confirmPrompt(`Proceed with ${skills.length} clones?`, { yes: opts.yes });
    if (!ok) {
      console.log(yellow(`Aborted.`));
      return;
    }
  }

  // Per-skill resolution; rolls back already-cloned siblings on failure.
  const completed: { finalDir: string }[] = [];
  // Tracks the live plugin root scaffolded by iter 1 of a `new-plugin` bulk clone.
  // When `targetKind === "new-plugin"` and a later iteration fails, this entire
  // root is removed in the rollback (AC-US1-01). For `targetKind === "plugin"`,
  // the user's existing root is preserved (AC-US1-03).
  let scaffoldedPluginRoot: string | undefined;
  for (const s of skills) {
    const newSkillBase = bareSkillName(s.skillName);
    const newSkillFullName = `${namespace}/${newSkillBase}`;
    let finalDir: string;
    let pluginRoot: string | undefined;
    let resolvedPluginName: string | undefined;
    switch (targetKind) {
      case "standalone": {
        finalDir = resolve(opts.path!, newSkillBase);
        break;
      }
      case "plugin": {
        pluginRoot = resolve(opts.plugin!);
        finalDir = join(pluginRoot, "skills", newSkillBase);
        break;
      }
      case "new-plugin": {
        // For whole-plugin → new-plugin, scaffold the same plugin once and add subsequent skills via writeToPlugin.
        // To keep this implementation simple and consistent with the spec, treat each skill as standalone-inside-the-plugin-root:
        // use writeToPlugin for skills 2..N after the first writeNewPlugin.
        pluginRoot = resolve(opts.path!);
        resolvedPluginName = opts.pluginName ?? pluginName;
        finalDir = join(pluginRoot, "skills", newSkillBase);
        break;
      }
    }

    const resolved: ResolvedCloneArgs = {
      source: s,
      targetKind:
        targetKind === "new-plugin" && completed.length > 0 ? "plugin" : targetKind,
      newSkillBase,
      newSkillFullName,
      author,
      namespace,
      finalDir,
      pluginRoot,
      pluginName: resolvedPluginName,
    };

    try {
      const result = await runCloneOnce(resolved, opts);
      completed.push({ finalDir: result.target.targetSkillDir });
      // After iter 1 of a new-plugin bulk clone, the plugin root has been
      // committed to disk. Capture it so the rollback path can also remove it
      // (AC-US1-01). For target=plugin, leave the user's plugin root alone.
      if (
        targetKind === "new-plugin" &&
        scaffoldedPluginRoot === undefined &&
        pluginRoot
      ) {
        scaffoldedPluginRoot = pluginRoot;
      }
      console.log(green(`✔ ${s.skillName} → ${newSkillFullName}`));
    } catch (err) {
      console.error(red(`✗ ${s.skillName}: ${(err as Error).message}`));
      // Roll back every previously-completed clone.
      for (const c of completed) {
        try {
          if (existsSync(c.finalDir)) {
            await fs.rm(c.finalDir, { recursive: true, force: true });
          }
        } catch {
          // best-effort
        }
      }
      // Also clean any stray .tmp from this iteration.
      bestEffortRm(tmpSibling(finalDir));
      // For new-plugin bulk clone, also remove the parent root scaffolded by
      // iter 1 — otherwise re-running the clone fails on a half-built plugin
      // (AC-US1-01). Skipped when no iteration succeeded (AC-US1-02) or when
      // target=plugin (AC-US1-03).
      if (scaffoldedPluginRoot && completed.length > 0) {
        bestEffortRm(scaffoldedPluginRoot);
      }
      console.error(red(`Rolled back ${completed.length} prior clone(s) — target left clean.`));
      process.exit(1);
      return;
    }
  }

  console.log(green(`✔ Cloned ${completed.length} skill(s) under namespace ${namespace}.`));
}

/** Re-exports for tests. */
export { resolveArgs, validateStagedClone, scanCopiedSkill, slugify, runWholePluginClone };
export type { ResolvedCloneArgs };
