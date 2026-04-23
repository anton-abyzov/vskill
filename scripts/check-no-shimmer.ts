#!/usr/bin/env npx tsx
/**
 * check-no-shimmer — CI gate that fails the build if shimmer animations or
 * skeleton classes slip back into the studio sources. ADR-0674-01 requires
 * static `.placeholder` rows only; the moving-gradient pattern was rejected
 * for its "generic AI loading" feel.
 *
 * Scans:
 *   <root>/src/eval-ui/**\/*.(css|ts|tsx)
 *   <root>/src/eval-ui/src/**\/*.(css|ts|tsx)
 *
 * Violations (each case-insensitive):
 *   - "@keyframes shimmer"
 *   - ".skeleton {" (class definition — usage like `className="skeleton"` is
 *      tolerated if the class itself is not defined)
 *
 * Exits with code 1 when any violation is found, 0 otherwise.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export interface ShimmerViolation {
  file: string;
  line: number;
  pattern: string;
}

const SCAN_ROOTS = ["src/eval-ui", "src/eval-ui/src"] as const;
const ALLOWED_EXTENSIONS = [".css", ".ts", ".tsx"] as const;
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "__tests__",
  ".git",
  "e2e",
  "test-results",
]);

const PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "@keyframes shimmer", re: /@keyframes\s+shimmer\b/i },
  // `.skeleton` class alone is allowed as a legacy alias of `.placeholder`
  // (static, no animation). Only flag `.skeleton` rules that include
  // `animation:` — those would resurrect the shimmer pattern.
  {
    label: ".skeleton { ... animation: ... }",
    re: /\.skeleton\s*\{[^}]*animation:/,
  },
];

export function scanForShimmer(rootDir: string): ShimmerViolation[] {
  const violations: ShimmerViolation[] = [];
  const seen = new Set<string>();
  for (const root of SCAN_ROOTS) {
    const abs = resolve(rootDir, root);
    try {
      statSync(abs);
    } catch {
      continue;
    }
    walk(abs, (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      scanFile(file, violations);
    });
  }
  return violations;
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

function scanFile(abs: string, out: ShimmerViolation[]) {
  // Skip files that legitimately contain the patterns as text fixtures:
  //   - scripts/check-no-shimmer.ts (this file defines the patterns)
  //   - __tests__/** (tests assert the patterns behave correctly)
  if (abs.includes(`${sep}__tests__${sep}`)) return;
  if (abs.endsWith("check-no-shimmer.ts")) return;
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
    for (const { label, re } of PATTERNS) {
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
  // import.meta.url is a file:// URL; process.argv[1] is a path.
  const argv1 = process.argv[1] ?? "";
  return import.meta.url.endsWith(argv1.replace(/\\/g, "/"));
}

if (isMain()) {
  const root = resolve(process.cwd());
  const violations = scanForShimmer(root);
  if (violations.length > 0) {
    for (const v of violations) {
      // eslint-disable-next-line no-console
      console.error(`${v.file}:${v.line} — ${v.pattern}`);
    }
    // eslint-disable-next-line no-console
    console.error(
      `\ncheck-no-shimmer: ${violations.length} violation(s). See ADR-0674-01.`,
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("check-no-shimmer: clean.");
  process.exit(0);
}
