#!/usr/bin/env npx tsx
/**
 * 0679 — scripts/validate-skills-spec.ts
 *
 * CI gate that validates every SKILL.md in the repo against the canonical
 * agentskills.io specification:
 *
 *   https://agentskills.io/specification
 *
 * Specifically:
 *   - `tags` and `target-agents` MUST be nested under a `metadata:` block.
 *     Top-level `tags:` or `target-agents:` keys are a spec violation.
 *
 * Behavior:
 *   - If the `skills-ref` CLI is available on PATH, this script delegates to
 *     `skills-ref validate <path>` for each SKILL.md and aggregates results.
 *   - Otherwise, it runs a minimal built-in check that covers the one rule
 *     0679 is about (root-level tags / target-agents). This keeps CI
 *     deterministic even before `skills-ref` is published.
 *
 * Fixtures under `src/**\/__tests__/fixtures/` are EXCLUDED — they contain
 * intentional "before" samples that demonstrate the old non-compliant shape.
 *
 * Exit codes:
 *   0 — every SKILL.md is spec-compliant
 *   1 — one or more files violate the spec (each printed with path + reason)
 *   2 — configuration error (no files found is fine; exit 0 with a notice)
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";

interface Violation {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

const REPO_ROOT = process.cwd();
const EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "test-results",
  "coverage",
]);
// Fixtures that intentionally demonstrate the non-compliant "before" shape.
const EXCLUDE_PATH_SUBSTRINGS = [
  `__tests__${sep}fixtures`,
];

/**
 * Hidden directories we always skip (deny-list). Agent-specific hidden dirs
 * (`.claude`, `.cursor`, `.continue`, `.zed`, `.gemini`, `.roo`, etc.) are
 * intentionally NOT in this list — those are where ecosystem skills live.
 *
 * 0679 review F-002: previous logic used a hardcoded allow-list of known
 * agent dirs, which silently dropped SKILL.md files from any newer agent
 * ecosystem. The deny-list approach inverts the default to "scan unless
 * explicitly noisy" so future ecosystems are covered automatically.
 */
const HIDDEN_DENY_LIST = new Set([
  ".git",
  ".vscode",
  ".idea",
  ".cache",
  ".turbo",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".docusaurus",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  ".tox",
]);

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // Skip noisy hidden dirs only; descend into agent-specific hidden dirs
    // like `.claude` / `.cursor` / `.continue` / `.zed` / `.gemini` etc.
    if (entry.name.startsWith(".") && HIDDEN_DENY_LIST.has(entry.name)) {
      continue;
    }
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      out.push(full);
    }
  }
}

function findSkillFiles(): string[] {
  const out: string[] = [];
  walk(REPO_ROOT, out);
  return out.filter((p) => !EXCLUDE_PATH_SUBSTRINGS.some((sub) => p.includes(sub)));
}

function isSkillsRefAvailable(): boolean {
  const res = spawnSync("skills-ref", ["--version"], { stdio: "ignore" });
  return res.status === 0 && res.error === undefined;
}

function validateWithSkillsRef(file: string): Violation[] {
  const res = spawnSync("skills-ref", ["validate", file], { encoding: "utf-8" });
  if (res.status === 0) return [];
  return [{
    file,
    line: 0,
    rule: "skills-ref",
    detail: (res.stderr || res.stdout || "").trim() || `skills-ref exited ${res.status}`,
  }];
}

/**
 * Minimal built-in check — only the one rule 0679 introduces:
 * root-level `tags:` and `target-agents:` are forbidden. Nested
 * `metadata.tags` / `metadata.target-agents` are required when present.
 *
 * Heuristic only; for full schema coverage, install skills-ref.
 */
function validateBuiltin(file: string): Violation[] {
  const content = readFileSync(file, "utf-8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return []; // No frontmatter — out of scope for this rule.
  const fm = fmMatch[1];
  const lines = fm.split("\n");
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^tags:\s*/.test(line)) {
      violations.push({
        file,
        line: i + 2, // account for leading "---\n"
        rule: "root-level-tags",
        detail: "`tags:` must be nested under a `metadata:` block per agentskills.io/specification.",
      });
    }
    if (/^target-agents:\s*/.test(line)) {
      violations.push({
        file,
        line: i + 2,
        rule: "root-level-target-agents",
        detail: "`target-agents:` must be nested under a `metadata:` block per agentskills.io/specification.",
      });
    }
  }

  return violations;
}

function main(): number {
  const files = findSkillFiles();
  if (files.length === 0) {
    console.log("[validate-skills-spec] No SKILL.md files found. Nothing to check.");
    return 0;
  }

  const useRef = isSkillsRefAvailable();
  if (useRef) {
    console.log(`[validate-skills-spec] Validator: skills-ref (external)`);
  } else {
    // 0679 F-003: built-in fallback only enforces the tags/target-agents
    // nesting rule. Loud warning so CI maintainers don't mistake a green
    // run for full agentskills.io/specification coverage.
    console.warn(`[validate-skills-spec] WARNING: skills-ref not installed — only the tags/target-agents nesting rule is enforced.`);
    console.warn(`[validate-skills-spec] WARNING: install skills-ref for full spec coverage: npm i -D skills-ref`);
    console.log(`[validate-skills-spec] Validator: built-in (agentskills.io/specification — tags/target-agents nesting only)`);
  }
  console.log(`[validate-skills-spec] Files: ${files.length}`);

  const allViolations: Violation[] = [];
  for (const file of files) {
    const violations = useRef ? validateWithSkillsRef(file) : validateBuiltin(file);
    allViolations.push(...violations);
  }

  if (allViolations.length === 0) {
    console.log("[validate-skills-spec] OK — every SKILL.md is spec-compliant.");
    return 0;
  }

  console.error(`[validate-skills-spec] ${allViolations.length} violation(s):`);
  for (const v of allViolations) {
    const rel = relative(REPO_ROOT, v.file);
    console.error(`  ${rel}:${v.line} — [${v.rule}] ${v.detail}`);
  }
  console.error("");
  console.error("Fix: move top-level `tags` / `target-agents` under a `metadata:` block. See https://agentskills.io/specification");
  return 1;
}

// Only run main() when invoked as a script. Exported for unit tests.
const invokedAsScript = (() => {
  try {
    const entry = process.argv[1] ?? "";
    return entry.endsWith("validate-skills-spec.ts") || entry.endsWith("validate-skills-spec.js");
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  process.exit(main());
}

export { findSkillFiles, validateBuiltin, validateWithSkillsRef, isSkillsRefAvailable, main };
