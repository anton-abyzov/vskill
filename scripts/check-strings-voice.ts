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

import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

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
];

const TARGETS = ["src/eval-ui/src/strings.ts"];

export function scanForVoiceViolations(rootDir: string): VoiceViolation[] {
  const violations: VoiceViolation[] = [];
  for (const rel of TARGETS) {
    const abs = resolve(rootDir, rel);
    try {
      statSync(abs);
    } catch {
      // Surface as a separate condition (exit code 2) in CLI path.
      throw new Error(
        `check-strings-voice: target file not found: ${abs}. Expected ${rel} relative to repo root.`,
      );
    }
    const content = readFileSync(abs, "utf8");
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const { label, re } of FORBIDDEN) {
        // Use a fresh RegExp with global flag; `re.lastIndex` would leak.
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
