#!/usr/bin/env npx tsx
/**
 * T-036 — check-strings-voice
 *
 * CI gate that enforces Anthropic/vSkill voice rules on the single source of
 * truth for user-facing copy: `src/eval-ui/src/strings.ts`.
 *
 * Forbidden patterns (case-insensitive where applicable):
 *   - "oops"
 *   - "uh-oh"
 *   - "awesome"
 *   - "blazing-fast" / "blazing fast"
 *   - Celebration emoji (🎉 ✨ 🚀 ✅ 🎊 🔥 🙌 ⭐ 💫 🥳)
 *   - `!!` (two or more consecutive exclamation marks)
 *
 * Exit codes:
 *   0 — clean
 *   1 — one or more violations (each printed with `path:line — pattern`)
 *   2 — target file missing (configuration error)
 *
 * ADR refs: US-010 (tone/voice), tasks.md T-035/T-036.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, sep, join } from "node:path";

export interface VoiceViolation {
  file: string;
  line: number;
  column: number;
  label: string;
  snippet: string;
}

const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: "oops", re: /\boops\b/gi },
  { label: "uh-oh", re: /\buh[- ]?oh\b/gi },
  { label: "awesome", re: /\bawesome\b/gi },
  { label: "blazing-fast", re: /\bblazing[ -]?fast\b/gi },
  // Celebration emoji — match any single codepoint from the banned set.
  {
    label: "celebration-emoji",
    re: /[\u{1F389}\u{2728}\u{1F680}\u{2705}\u{1F38A}\u{1F525}\u{1F64C}\u{2B50}\u{1F4AB}\u{1F973}]/gu,
  },
  { label: "multi-exclamation (!!)", re: /!{2,}/g },
  // 0682 AC-US5-01 — Anthropic April 2026 ToS reframe. "Max/Pro" /
  // "Pro/Max" / "subscription" are banned in user-facing copy. The single
  // legitimate use is `models.subscriptionBilling` (a price-row suffix);
  // that line is allowlisted via `VOICE_ALLOW` per-line markers below.
  { label: "Max/Pro", re: /\bMax\/Pro\b/gi },
  { label: "Pro/Max", re: /\bPro\/Max\b/gi },
  { label: "subscription", re: /\bsubscription\b/gi },
];

// Lines containing one of these literal substrings are exempt from the
// banned-word scan. Each entry corresponds to a documented carve-out.
const LINE_ALLOWLIST = [
  // models.subscriptionBilling — billing-mode token, AC-US2-03.
  'subscriptionBilling: "· subscription"',
];

// 0682 F-003 — Scan the entire `src/eval-ui/src/**` and `src/eval-server/**`
// subtrees, not just `strings.ts`. AC-US5-01(f) requires lint failure when
// `Max/Pro` / `subscription` appear anywhere in those subtrees, with allowance
// for `README.md` and `docs/**`.
//
// Pre-fix TARGETS was just ["src/eval-ui/src/strings.ts"], which silently
// passed even if a regression introduced "Max/Pro" in StatusBar.tsx or
// api-routes.ts.
const TARGETS = ["src/eval-ui/src/strings.ts"];
const TARGET_DIRS = ["src/eval-ui/src", "src/eval-server"];
const SCAN_EXTENSIONS = [".ts", ".tsx"];
const SCAN_EXCLUDED_DIRS = new Set(["node_modules", "__tests__", "dist", ".turbo"]);

function listFiles(dir: string, out: string[]): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Missing directory — fine for fixtures or partial repos.
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_EXCLUDED_DIRS.has(entry.name)) continue;
      listFiles(abs, out);
      continue;
    }
    if (entry.isFile() && SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(abs);
    }
  }
}

function scanFile(abs: string, violations: VoiceViolation[]): void {
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (LINE_ALLOWLIST.some((needle) => line.includes(needle))) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const { label, re } of FORBIDDEN) {
      const localRe = new RegExp(re.source, re.flags);
      let m: RegExpExecArray | null;
      while ((m = localRe.exec(line)) !== null) {
        violations.push({
          file: abs,
          line: i + 1,
          column: m.index + 1,
          label,
          snippet: line.trim().slice(0, 200),
        });
        if (m.index === localRe.lastIndex) localRe.lastIndex++;
      }
    }
  }
}

export function scanForVoiceViolations(rootDir: string): VoiceViolation[] {
  const violations: VoiceViolation[] = [];
  // Required-target gate — strings.ts must exist (configuration error
  // surfaces as exit code 2 from the CLI path). Once verified, fall through
  // to the full-tree scan.
  for (const rel of TARGETS) {
    const abs = resolve(rootDir, rel);
    try {
      statSync(abs);
    } catch {
      throw new Error(
        `check-strings-voice: target file not found: ${abs}. Expected ${rel} relative to repo root.`,
      );
    }
  }
  const seen = new Set<string>();
  for (const rel of TARGET_DIRS) {
    const abs = resolve(rootDir, rel);
    const files: string[] = [];
    listFiles(abs, files);
    for (const f of files) {
      if (seen.has(f)) continue;
      seen.add(f);
      scanFile(f, violations);
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
function isMain(): boolean {
  const argv1 = process.argv[1] ?? "";
  const normalized = argv1.replace(/\\/g, "/");
  return import.meta.url.endsWith(normalized) || normalized.endsWith("check-strings-voice.ts");
}

if (isMain()) {
  const root = resolve(process.cwd());
  try {
    const violations = scanForVoiceViolations(root);
    if (violations.length > 0) {
      for (const v of violations) {
        // eslint-disable-next-line no-console
        console.error(
          `${v.file}:${v.line}:${v.column} — ${v.label} — ${v.snippet}`,
        );
      }
      // eslint-disable-next-line no-console
      console.error(
        `\ncheck-strings-voice: ${violations.length} violation(s). See US-010 in spec.md.`,
      );
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log("check-strings-voice: clean.");
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `check-strings-voice: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }
}

// Expose helpers for unit tests without invoking the CLI path.
export const __TEST_ONLY__ = { FORBIDDEN, TARGETS, sep };
