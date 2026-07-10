#!/usr/bin/env npx tsx
/**
 * check-serif-scope — CI gate enforcing ADR-0674-03 typography discipline.
 *
 * Source Serif 4 (the `--font-serif` token) is reserved for the few editorial
 * surfaces in the studio (detail card titles, empty-state headlines). It must
 * NOT leak into workspace pages, panels, sidebar rows, etc., which would
 * undermine the restrained serif-for-titles-only aesthetic.
 *
 * Allow list (raw serif usage tolerated):
 *   - src/eval-ui/src/styles/globals.css (token definition + base rules)
 *   - src/eval-ui/src/components/DetailHeader.tsx
 *   - src/eval-ui/src/components/DetailHeader.css
 *   - src/eval-ui/src/components/EmptyState.tsx
 *   - src/eval-ui/src/components/EmptyState.css
 *
 * Violation ranges (any raw serif usage here fails the gate):
 *   - src/eval-ui/src/pages/workspace/**
 *   - src/eval-ui/src/pages/editor/**  (future — placeholder scoping)
 *   - src/eval-ui/src/components/sidebar/**
 *
 * Exits 1 on any violation, 0 otherwise.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export interface SerifViolation {
  file: string;
  line: number;
  pattern: string;
}

const RESTRICTED_PREFIXES = [
  join("src", "eval-ui", "src", "pages", "workspace"),
  join("src", "eval-ui", "src", "pages", "editor"),
  join("src", "eval-ui", "src", "components", "sidebar"),
] as const;

const ALLOWED_EXTENSIONS = [".css", ".ts", ".tsx"] as const;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "__tests__",
  ".git",
  "e2e",
  "test-results",
]);

const SERIF_REFS: Array<{ label: string; re: RegExp }> = [
  { label: "var(--font-serif)", re: /var\(\s*--font-serif\s*\)/ },
  { label: "Source Serif 4", re: /source\s+serif\s+4/i },
];

export function scanForSerifScope(rootDir: string): SerifViolation[] {
  const violations: SerifViolation[] = [];
  const abs = resolve(rootDir, "src/eval-ui");
  try {
    statSync(abs);
  } catch {
    return violations;
  }

  walk(abs, (file) => {
    const rel = file.slice(rootDir.length + 1);
    if (!isRestricted(rel)) return;
    scanFile(file, violations);
  });
  return violations;
}

function isRestricted(relPath: string): boolean {
  return RESTRICTED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function walk(dir: string, onFile: (abs: string) => void) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    let s;
    try {
      s = statSync(abs);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(abs, onFile);
    } else if (s.isFile()) {
      if (ALLOWED_EXTENSIONS.some((ext) => abs.endsWith(ext))) {
        onFile(abs);
      }
    }
  }
}

function scanFile(abs: string, out: SerifViolation[]) {
  // Scripts and tests contain the patterns as literals for matching /
  // asserting. Exclude them.
  if (abs.includes(`${sep}__tests__${sep}`)) return;
  if (abs.endsWith("check-serif-scope.ts")) return;

  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const { label, re } of SERIF_REFS) {
      if (re.test(line)) {
        out.push({ file: abs, line: i + 1, pattern: label });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
function isMain(): boolean {
  const argv1 = process.argv[1] ?? "";
  return import.meta.url.endsWith(argv1.replace(/\\/g, "/"));
}

if (isMain()) {
  const root = resolve(process.cwd());
  const violations = scanForSerifScope(root);
  if (violations.length > 0) {
    for (const v of violations) {
      // eslint-disable-next-line no-console
      console.error(`${v.file}:${v.line} — ${v.pattern}`);
    }
    // eslint-disable-next-line no-console
    console.error(
      `\ncheck-serif-scope: ${violations.length} violation(s). See ADR-0674-03.`,
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("check-serif-scope: clean.");
  process.exit(0);
}
