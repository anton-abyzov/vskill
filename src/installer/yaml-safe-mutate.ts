// 0845 T-010 — safeAppendYamlList: idempotent, backup-protected list mutation.
//
// Why hand-rolled instead of js-yaml:
//   - vskill has no js-yaml dependency today; the surface here is tiny
//     (append one string to ONE top-level block-sequence key) so the cost
//     of pulling in a YAML library is not justified.
//   - Line-based mutation preserves user comments, formatting, ordering,
//     and indent style — js-yaml's round-trip drops all of those.
//   - The four "what does the user's YAML look like?" cases below are the
//     only shapes the Aider conf.yml mutation needs to handle.
//
// Algorithm (ADR-0845-03):
//   1. File missing                       → write `<key>:\n  - <value>\n`, status="created"
//   2. Key missing in file                → append `<key>:\n  - <value>\n`, status="appended"
//   3. Key present, empty value           → replace with full list, status="appended"
//   4. Key present, block list:
//        - value already present          → no-op, status="already-present"
//        - value absent                   → insert `<indent>- <value>` at end of block, status="appended"
//   5. Key present, inline list / scalar  → throw IncompatibleConfigError
//   6. Malformed YAML (tab indent, unclosed quoted string, etc.) → throw MalformedConfigError
//
// Mutations always go through a backup-write: write `<file>.bak` (or
// `.bak.1`, `.bak.2`, … if `.bak` is already taken) BEFORE rewriting the
// original. Backup is skipped on the "created" path (no prior content
// to preserve).

import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";

export class MalformedConfigError extends Error {
  constructor(msg: string) {
    super(`Malformed YAML config: ${msg}`);
    this.name = "MalformedConfigError";
  }
}

export class IncompatibleConfigError extends Error {
  constructor(msg: string) {
    super(`Incompatible YAML shape: ${msg}`);
    this.name = "IncompatibleConfigError";
  }
}

export type SafeAppendStatus = "created" | "appended" | "already-present";

export interface SafeAppendResult {
  status: SafeAppendStatus;
  /** Path of the backup written before mutation. Undefined for status="created"
   *  and status="already-present" (no mutation occurred). */
  backupPath?: string;
}

const DEFAULT_INDENT = "  "; // 2-space when we have nothing else to copy.

/**
 * Append `value` to the YAML block-sequence under top-level `key` in `filePath`.
 * Idempotent; backs up the original before any mutation; throws on malformed
 * input or incompatible shape (file is never touched on error).
 */
export function safeAppendYamlList(
  filePath: string,
  key: string,
  value: string,
): SafeAppendResult {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${key}:\n${DEFAULT_INDENT}- ${value}\n`);
    return { status: "created" };
  }

  const original = readFileSync(filePath, "utf8");
  validateNoMalformedYaml(original);

  const keyLineIdx = findTopLevelKeyLine(original, key);

  if (keyLineIdx === -1) {
    const updated = appendKeyAtEnd(original, key, value);
    return mutateWithBackup(filePath, original, updated);
  }

  const lines = original.split("\n");
  const block = readListBlock(lines, keyLineIdx);

  if (block.shape === "inline-list" || block.shape === "scalar") {
    throw new IncompatibleConfigError(
      `key "${key}" is not a block-sequence (found ${block.shape})`,
    );
  }

  if (block.shape === "empty-value") {
    const replacement = `${key}:\n${DEFAULT_INDENT}- ${value}`;
    const next = [...lines.slice(0, keyLineIdx), replacement, ...lines.slice(keyLineIdx + 1)];
    return mutateWithBackup(filePath, original, next.join("\n"));
  }

  // block.shape === "block-list" — explicit guard keeps TS narrowing happy
  // after the prior `===` checks against the discriminant.
  if (block.shape !== "block-list") {
    // Should be unreachable; treated as a defensive cast.
    throw new Error(`internal: unexpected block shape "${(block as { shape: string }).shape}"`);
  }
  if (block.items.includes(value)) {
    return { status: "already-present" };
  }

  const indent = block.indent;
  const insertAt = block.endLineIdx + 1; // line after the last list item
  const newLine = `${indent}- ${value}`;
  const next = [...lines.slice(0, insertAt), newLine, ...lines.slice(insertAt)];
  return mutateWithBackup(filePath, original, next.join("\n"));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function validateNoMalformedYaml(text: string): void {
  // Tab indentation is illegal in YAML; flag any line that begins with a tab
  // before its first non-whitespace char.
  const lines = text.split("\n");
  for (const line of lines) {
    if (/^\t/.test(line)) {
      throw new MalformedConfigError(
        "tab indentation detected (YAML requires spaces)",
      );
    }
  }
  // Unclosed double-quoted string: count unescaped `"` chars in the body.
  // Odd count → unclosed. Backslash-escaped quotes are ignored.
  const stripped = text.replace(/\\"/g, "");
  const dq = (stripped.match(/"/g) ?? []).length;
  if (dq % 2 === 1) {
    throw new MalformedConfigError("unclosed double-quoted string");
  }
  const stripped2 = text.replace(/\\'/g, "");
  const sq = (stripped2.match(/'/g) ?? []).length;
  if (sq % 2 === 1) {
    throw new MalformedConfigError("unclosed single-quoted string");
  }
}

function findTopLevelKeyLine(text: string, key: string): number {
  const lines = text.split("\n");
  // Top-level == zero indent. Tolerate optional trailing whitespace.
  const re = new RegExp(`^${escapeRegex(key)}\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

interface BlockListShape {
  shape: "block-list";
  items: string[];
  indent: string;
  /** Line index of the LAST `- item` line in the block. */
  endLineIdx: number;
}

interface OtherShape {
  shape: "empty-value" | "inline-list" | "scalar";
}

function readListBlock(
  lines: string[],
  keyLineIdx: number,
): BlockListShape | OtherShape {
  const keyLine = lines[keyLineIdx];
  const afterColon = keyLine.split(":").slice(1).join(":").trim();

  if (afterColon === "") {
    // `key:` with nothing after → may be block-list OR empty.
    // Look ahead for `<indent>- ` lines.
    for (let i = keyLineIdx + 1; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.trim() === "") continue;
      const m = ln.match(/^(\s+)- (.*)$/);
      if (m) {
        // Found first item — parse the entire block.
        const indent = m[1];
        const items: string[] = [];
        let end = i;
        for (let j = i; j < lines.length; j++) {
          const item = lines[j].match(new RegExp(`^${indent}- (.*)$`));
          if (!item) {
            // Stop at first non-list line. Blank lines inside a block are
            // unusual but tolerated — they don't advance `end`.
            if (lines[j].trim() === "") continue;
            break;
          }
          items.push(item[1].trim());
          end = j;
        }
        return { shape: "block-list", items, indent, endLineIdx: end };
      }
      // First non-blank line after `key:` is not a list item → empty value.
      return { shape: "empty-value" };
    }
    return { shape: "empty-value" };
  }

  if (afterColon.startsWith("[")) {
    return { shape: "inline-list" };
  }
  return { shape: "scalar" };
}

function appendKeyAtEnd(original: string, key: string, value: string): string {
  const needsLeadingNewline = original.length > 0 && !original.endsWith("\n");
  const prefix = needsLeadingNewline ? `${original}\n` : original;
  return `${prefix}${key}:\n${DEFAULT_INDENT}- ${value}\n`;
}

function mutateWithBackup(
  filePath: string,
  _original: string,
  next: string,
): SafeAppendResult {
  const backupPath = pickBackupPath(filePath);
  copyFileSync(filePath, backupPath);
  // Normalize: ensure exactly one trailing newline.
  const normalized = next.endsWith("\n") ? next : `${next}\n`;
  writeFileSync(filePath, normalized);
  return { status: "appended", backupPath };
}

function pickBackupPath(filePath: string): string {
  const base = `${filePath}.bak`;
  if (!existsSync(base)) return base;
  for (let n = 1; n < 1000; n++) {
    const candidate = `${filePath}.bak.${n}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a free backup path for ${filePath}`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
