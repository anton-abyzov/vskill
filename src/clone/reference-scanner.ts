// ---------------------------------------------------------------------------
// vskill clone — reference-scanner (READ-ONLY)
// ---------------------------------------------------------------------------
// Detects cross-skill reference patterns and self-name occurrences in
// SKILL.md prose. **Reports only — never rewrites anything.** The orchestrator
// appends the report to the success summary so the user can decide what to do.
//
// Patterns:
//   - backtick:       `sw:foo`             (single-backtick inline code)
//   - skill-call:     Skill({ skill: "sw:foo" })  /  Skill({ skill: 'sw:foo' })
//   - slash-command:  /sw:foo
//   - self-name:      literal occurrence of the OLD skill name in prose
//
// False-positive guard: matches inside fenced code blocks (```...```) are
// excluded for the slash-command and self-name patterns. Backtick and
// Skill({...}) patterns are themselves code-shaped, so they are reported
// unconditionally — that's the user's signal that an actual cross-skill
// dependency exists in the source.
//
// See spec.md AC-US1-04, plan.md §6.
// ---------------------------------------------------------------------------

import type { ReferenceMatch } from "./types.js";

export interface ScanOptions {
  /** Old fully-qualified skill name (e.g. "sw/ado-mapper" or "ado-mapper"). */
  oldSkillName: string;
  /** Logical filename (relative to skill root) — recorded in each match. */
  file?: string;
}

const BACKTICK_RE = /`([a-z][a-z0-9-]*:[a-z][a-z0-9-]*)`/g;
const SKILL_CALL_RE = /Skill\s*\(\s*\{\s*skill\s*:\s*["']([^"']+)["']/g;
const SLASH_COMMAND_RE = /(?:^|\s)(\/[a-z][a-z0-9-]*:[a-z][a-z0-9-]*)\b/g;

/**
 * Build a regex that matches the OLD skill name as a whole "word", where word
 * boundaries here mean the surrounding chars are not [A-Za-z0-9-/] (so
 * "ado-mapper" matches but "ado-mapperx" or "my-ado-mapper-thing" do not).
 *
 * The `oldSkillName` is escaped before being embedded in the pattern so any
 * regex metacharacters in the skill name are treated literally.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect lines covered by fenced code blocks (triple-backtick). Returns a Set
 * of 1-indexed line numbers that are INSIDE a fence. Used to suppress
 * slash-command and self-name false positives that live in code samples.
 *
 * The opening/closing fence lines themselves are also considered "inside"
 * for the purpose of suppression — they don't contain meaningful prose
 * references, so this is a deliberate slight overreach.
 */
function computeFencedLines(lines: string[]): Set<number> {
  const fenced = new Set<number>();
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("```")) {
      // The fence-opening line and fence-closing line are both fenced.
      fenced.add(i + 1);
      inFence = !inFence;
      continue;
    }
    if (inFence) fenced.add(i + 1);
  }
  return fenced;
}

/**
 * Scan SKILL.md content for cross-skill references and self-name occurrences.
 * Returns matches in document order with line numbers (1-indexed).
 */
export function scanReferences(content: string, opts: ScanOptions): ReferenceMatch[] {
  const file = opts.file ?? "SKILL.md";
  const normalized = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const fenced = computeFencedLines(lines);

  const out: ReferenceMatch[] = [];

  // Pattern 1: backtick `sw:foo` — reported unconditionally (already code-shaped).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    BACKTICK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BACKTICK_RE.exec(line)) !== null) {
      out.push({ file, line: i + 1, match: m[1], kind: "backtick" });
    }
  }

  // Pattern 2: Skill({ skill: "sw:foo" }) — reported unconditionally.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    SKILL_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SKILL_CALL_RE.exec(line)) !== null) {
      out.push({ file, line: i + 1, match: m[1], kind: "skill-call" });
    }
  }

  // Pattern 3: /sw:foo — slash-command. Suppressed inside fenced code blocks.
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i + 1)) continue;
    const line = lines[i];
    SLASH_COMMAND_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SLASH_COMMAND_RE.exec(line)) !== null) {
      // Strip the leading "/" so the recorded match is the bare slash-command name.
      const matched = m[1];
      out.push({ file, line: i + 1, match: matched, kind: "slash-command" });
    }
  }

  return out;
}

/**
 * Scan for literal occurrences of the OLD skill name in prose.
 * Suppressed inside fenced code blocks. Returned as a separate array because
 * it's informational at a different level (manual rename candidates, not
 * cross-skill dependencies).
 */
export function scanSelfNameOccurrences(
  content: string,
  opts: ScanOptions,
): ReferenceMatch[] {
  const file = opts.file ?? "SKILL.md";
  const normalized = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const fenced = computeFencedLines(lines);

  // The full name may contain "/" (e.g. "sw/ado-mapper") — we scan for both
  // the bare skill segment and the full name. Bare segment first ensures we
  // catch occurrences like "the ado-mapper does X" in prose.
  const slashIdx = opts.oldSkillName.indexOf("/");
  const bareSkill = slashIdx >= 0 ? opts.oldSkillName.slice(slashIdx + 1) : opts.oldSkillName;
  const patterns = new Set<string>();
  patterns.add(opts.oldSkillName);
  if (bareSkill !== opts.oldSkillName) patterns.add(bareSkill);

  const out: ReferenceMatch[] = [];
  for (const pattern of patterns) {
    const escaped = escapeRegex(pattern);
    // Word-boundary that treats letters, digits, hyphen, slash as part of the "word".
    // (?<![A-Za-z0-9-/])  — preceded by neither a name char nor a slash
    // (?![A-Za-z0-9-/])   — followed by neither a name char nor a slash
    const re = new RegExp(`(?<![A-Za-z0-9\\-/])${escaped}(?![A-Za-z0-9\\-/])`, "g");

    for (let i = 0; i < lines.length; i++) {
      if (fenced.has(i + 1)) continue;
      const line = lines[i];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        out.push({ file, line: i + 1, match: m[0], kind: "self-name" });
      }
    }
  }

  return out;
}
