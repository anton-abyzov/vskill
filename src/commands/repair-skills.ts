// ---------------------------------------------------------------------------
// `vskill repair-skills` — detects and restores corrupted SKILL.md files in
// local skill installations.
//
// Background: a bug in `ensureFrontmatter(forceName=true)` produced two
// corruption patterns when installing skills via `vskill add`:
//   1. Duplicated name token   →  `name: foo foo`
//   2. Duplicated description  →  two `^description:` lines in the same block
// The frontend-design Anthropic skill was the canonical reproducer.
//
// This command:
//   - Walks the known cross-tool skill install dirs.
//   - Flags any SKILL.md with the corruption signatures above.
//   - Looks for a pristine source in ~/.claude/plugins/marketplaces/**/SKILL.md.
//   - Restores from source when --write is passed; otherwise reports only.
//
// Conservative by default: dry-run, only restores when an exact-name match is
// found in a marketplace cache. Never touches files outside the user's $HOME.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const NAME_LINE_RE = /^name:\s*(.*)$/m;
const DESCRIPTION_LINE_RE = /^description:.*$/gm;

interface RepairOptions {
  /** Roots to walk. When omitted, defaults to all known cross-tool skill dirs. */
  root?: string[];
  /** Where to look for pristine sources. Defaults to ~/.claude/plugins/marketplaces. */
  sourceRoot?: string;
  /** When true, write restored content to disk; otherwise dry-run (report only). */
  write?: boolean;
  /** When true, emit JSON instead of human report. */
  json?: boolean;
}

type Action =
  | "restored"
  | "would-restore"
  | "corrupted-no-source"
  | "ok";

interface FileResult {
  path: string;
  action: Action;
  reasons: string[];
  source?: string;
}

function defaultInstallRoots(home: string): string[] {
  return [
    join(home, ".claude", "skills"),
    join(home, ".cursor", "skills"),
    join(home, ".config", "opencode", "skills"),
    join(home, ".codex", "skills"),
    join(home, ".config", "codex", "skills"),
    join(home, ".aider", "skills"),
    join(home, ".config", "aider", "skills"),
    join(home, ".continue", "skills"),
    join(home, ".junie", "skills"),
    join(home, ".trae", "skills"),
    join(home, ".windsurf", "skills"),
    join(home, ".config", "windsurf", "skills"),
  ];
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      out.push(full);
    }
  }
}

/** Detects the two corruption patterns. Returns reasons when corrupt, [] when clean. */
export function detectCorruption(content: string): string[] {
  const normalized = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const fm = normalized.match(FRONTMATTER_RE);
  if (!fm) return [];
  const block = fm[1];
  const reasons: string[] = [];

  const nameMatch = block.match(NAME_LINE_RE);
  if (nameMatch) {
    const value = nameMatch[1].trim();
    const tokens = value.split(/\s+/);
    if (tokens.length >= 2 && tokens[0] === tokens[1]) {
      reasons.push(`duplicated-name-value: ${JSON.stringify(value)}`);
    }
  }

  const descLines = block.match(DESCRIPTION_LINE_RE) ?? [];
  if (descLines.length > 1) {
    reasons.push(`${descLines.length}× description: lines`);
  }

  return reasons;
}

/** Find a pristine SKILL.md whose containing dir matches the given skill name. */
async function findPristineSource(
  sourceRoot: string,
  skillName: string,
): Promise<string | null> {
  const candidates: string[] = [];
  await walk(sourceRoot, candidates);
  // Prefer paths whose immediate parent dir name equals the skill name.
  for (const c of candidates) {
    const parent = basename(c.slice(0, c.length - "/SKILL.md".length));
    if (parent === skillName) {
      // Skip self-references (e.g. if user pointed sourceRoot to an install dir).
      // Rough heuristic: require the path to contain `marketplaces` or `plugins`.
      if (/\b(marketplaces|plugins)\b/.test(c)) {
        return c;
      }
    }
  }
  return null;
}

export async function repairSkillsCommand(opts: RepairOptions = {}): Promise<{
  scanned: number;
  corrupted: number;
  restored: number;
  unresolvable: number;
  results: FileResult[];
}> {
  const home = homedir();
  const roots = (opts.root && opts.root.length > 0
    ? opts.root
    : defaultInstallRoots(home)
  ).map((r) => resolve(r));
  const sourceRoot = resolve(
    opts.sourceRoot ?? join(home, ".claude", "plugins", "marketplaces"),
  );
  const write = !!opts.write;

  // Safety: refuse to walk roots outside $HOME.
  const safeRoots: string[] = [];
  for (const r of roots) {
    if (r === home || !r.startsWith(home + sep)) {
      console.error(`vskill repair-skills: refusing to walk outside $HOME: ${r}`);
      continue;
    }
    safeRoots.push(r);
  }

  const files: string[] = [];
  for (const r of safeRoots) {
    await walk(r, files);
  }

  const results: FileResult[] = [];
  let corrupted = 0;
  let restored = 0;
  let unresolvable = 0;

  for (const path of files) {
    let content: string;
    try {
      content = await fs.readFile(path, "utf8");
    } catch {
      continue;
    }
    const reasons = detectCorruption(content);
    if (reasons.length === 0) {
      results.push({ path, action: "ok", reasons: [] });
      continue;
    }
    corrupted++;
    const skillDirName = basename(path.slice(0, path.length - "/SKILL.md".length));
    const source = await findPristineSource(sourceRoot, skillDirName);
    if (!source) {
      unresolvable++;
      results.push({ path, action: "corrupted-no-source", reasons });
      continue;
    }
    if (write) {
      const pristine = await fs.readFile(source, "utf8");
      await fs.writeFile(path, pristine, "utf8");
      restored++;
      results.push({ path, action: "restored", reasons, source });
    } else {
      results.push({ path, action: "would-restore", reasons, source });
    }
  }

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        { scanned: files.length, corrupted, restored, unresolvable, dryRun: !write, results },
        null,
        2,
      ) + "\n",
    );
  } else {
    const dryNote = write ? "(applied)" : "(dry-run — pass --write to apply)";
    process.stdout.write(`vskill repair-skills ${dryNote}\n`);
    process.stdout.write(`  scanned: ${files.length}\n`);
    process.stdout.write(`  corrupted: ${corrupted}\n`);
    process.stdout.write(`  ${write ? "restored" : "would restore"}: ${write ? restored : corrupted - unresolvable}\n`);
    process.stdout.write(`  corrupted but no pristine source: ${unresolvable}\n`);
    if (corrupted > 0) {
      process.stdout.write(`\nCorrupted files:\n`);
      for (const r of results.filter((r) => r.action !== "ok")) {
        process.stdout.write(`  ! ${r.path}\n`);
        for (const reason of r.reasons) {
          process.stdout.write(`      ${reason}\n`);
        }
        if (r.source) {
          process.stdout.write(`      source: ${r.source}\n`);
        } else {
          process.stdout.write(`      source: <not found in ${sourceRoot}>\n`);
        }
      }
    }
  }

  return {
    scanned: files.length,
    corrupted,
    restored,
    unresolvable,
    results,
  };
}
