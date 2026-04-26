// ---------------------------------------------------------------------------
// 0759 Phase 7 (B1) — `vskill stamp-versions` command.
//
// Walks local skill installation roots and injects `version: "1.0.0"` into the
// frontmatter of any SKILL.md that is missing a version field. Opt-in only —
// never runs automatically. Defaults to dry-run; pass `--write` to actually
// modify files.
//
// Default scopes (when no --root passed):
//   - ~/.claude/skills/                       (Claude Code personal skills)
//   - ~/.claude/plugins/cache/*/skills/       (plugin-cached skills)
//
// Skips files whose frontmatter already declares a version (idempotent).
// Skips files outside the user's home dir as a safety check.
// ---------------------------------------------------------------------------

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;
const VERSION_LINE_RE = /^version:\s*["']?([^"'\n]+?)["']?\s*$/m;

interface StampOptions {
  /** Roots to walk. When omitted, defaults to ~/.claude/skills + ~/.claude/plugins/cache. */
  root?: string[];
  /** Default version to stamp when missing. */
  version?: string;
  /** When true, write changes to disk; otherwise dry-run (just report). */
  write?: boolean;
  /** When true, emit one path per line instead of human report. */
  json?: boolean;
}

interface FileResult {
  path: string;
  action: "stamped" | "skipped-has-version" | "skipped-no-frontmatter" | "error";
  current?: string | null;
  next?: string;
  error?: string;
}

async function findSkillMdFiles(roots: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const root of roots) {
    try {
      await walk(root, found);
    } catch {
      // Missing root — silently skip.
    }
  }
  return found;
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

function injectVersion(content: string, version: string): string {
  const versionLine = `version: "${version}"`;
  const fm = content.match(FRONTMATTER_RE);
  if (!fm) {
    // No frontmatter at all — prepend a minimal one.
    return `---\n${versionLine}\n---\n${content}`;
  }
  if (VERSION_LINE_RE.test(fm[1])) {
    return content; // already has version → no-op
  }
  const newBlock = `${versionLine}\n${fm[1]}`;
  const closer = fm[0].endsWith("---\n") ? "---\n" : "---";
  const before = content.slice(0, fm.index ?? 0);
  const after = content.slice((fm.index ?? 0) + fm[0].length);
  return `${before}---\n${newBlock}\n${closer}${after}`;
}

export async function stampVersionsCommand(opts: StampOptions = {}): Promise<{
  scanned: number;
  stamped: number;
  alreadyHadVersion: number;
  errors: number;
  results: FileResult[];
}> {
  const home = homedir();
  const defaultRoots = [
    join(home, ".claude", "skills"),
    join(home, ".claude", "plugins", "cache"),
  ];
  const roots = (opts.root && opts.root.length > 0 ? opts.root : defaultRoots).map((r) =>
    resolve(r),
  );
  const version = opts.version ?? "1.0.0";
  const write = !!opts.write;

  // Safety: refuse to walk a root that isn't under $HOME (prevents ./. or /).
  const safeRoots: string[] = [];
  for (const r of roots) {
    if (r === home || r === resolve(home)) {
      // Refuse a literal home root — would scan EVERYTHING.
      console.error(`vskill stamp-versions: refusing to walk full home dir: ${r}`);
      continue;
    }
    if (!r.startsWith(home + sep)) {
      console.error(`vskill stamp-versions: refusing to walk outside home: ${r}`);
      continue;
    }
    safeRoots.push(r);
  }

  const files = await findSkillMdFiles(safeRoots);
  const results: FileResult[] = [];
  let stamped = 0;
  let already = 0;
  let errors = 0;

  for (const path of files) {
    try {
      const content = await fs.readFile(path, "utf8");
      const fm = content.match(FRONTMATTER_RE);
      if (!fm) {
        // No frontmatter — we'd be creating one. That's invasive; skip in dry-run
        // by default and only act on existing-frontmatter cases for stamp-versions.
        // The full publish flow stamps unconditionally; this CLI is conservative.
        results.push({ path, action: "skipped-no-frontmatter" });
        continue;
      }
      if (VERSION_LINE_RE.test(fm[1])) {
        const m = fm[1].match(VERSION_LINE_RE);
        results.push({ path, action: "skipped-has-version", current: m?.[1] ?? null });
        already++;
        continue;
      }
      const next = injectVersion(content, version);
      if (write) {
        await fs.writeFile(path, next, "utf8");
      }
      results.push({ path, action: "stamped", next: version });
      stamped++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ path, action: "error", error: msg });
      errors++;
    }
  }

  // Reporting
  if (opts.json) {
    process.stdout.write(JSON.stringify({ scanned: files.length, stamped, alreadyHadVersion: already, errors, results, dryRun: !write, version }, null, 2) + "\n");
  } else {
    const dryNote = write ? "(applied)" : "(dry-run — pass --write to apply)";
    process.stdout.write(`vskill stamp-versions ${dryNote}\n`);
    process.stdout.write(`  scanned: ${files.length}\n`);
    process.stdout.write(`  stamped: ${stamped} (with version "${version}")\n`);
    process.stdout.write(`  already had version: ${already}\n`);
    process.stdout.write(`  errors: ${errors}\n`);
    if (stamped > 0) {
      process.stdout.write(`\nFiles ${write ? "stamped" : "would stamp"}:\n`);
      for (const r of results.filter((r) => r.action === "stamped")) {
        process.stdout.write(`  + ${r.path}\n`);
      }
    }
    if (errors > 0) {
      process.stdout.write(`\nErrors:\n`);
      for (const r of results.filter((r) => r.action === "error")) {
        process.stdout.write(`  ! ${r.path}: ${r.error}\n`);
      }
    }
  }

  return { scanned: files.length, stamped, alreadyHadVersion: already, errors, results };
}
