// ---------------------------------------------------------------------------
// Hidden-content detection — instructions a human reviewer cannot see but an
// agent reads verbatim: Unicode tag smuggling, variation-selector and
// zero-width steganography, bidi overrides, directives inside HTML comments,
// printable text hidden in base64, and look-alike domains.
//
// Ported from vskill-platform src/lib/scanner/hidden-content.ts; keep the two
// in step when rules change.
// ---------------------------------------------------------------------------

import type { PatternSeverity } from "./patterns.js";

export interface HiddenRule {
  id: string;
  name: string;
  severity: PatternSeverity;
  description: string;
}

export const HIDDEN_CONTENT_RULES: HiddenRule[] = [
  { id: "HC-001", name: "Unicode tag smuggling", severity: "critical", description: "Invisible Unicode tag characters (U+E0000-E007F) that spell out hidden ASCII text" },
  { id: "HC-002", name: "Bidirectional override", severity: "high", description: "Bidi embedding/override/isolate controls that make text render differently from what an agent reads (Trojan Source)" },
  { id: "HC-003", name: "Zero-width steganography", severity: "high", description: "Runs of zero-width characters that can encode hidden data" },
  { id: "HC-004", name: "Variation-selector smuggling", severity: "high", description: "Runs of variation selectors that encode hidden bytes" },
  { id: "HC-005", name: "Hidden directive in comment", severity: "high", description: "HTML or markdown comment containing instructions, secrecy demands, or commands that render invisibly" },
  { id: "HC-006", name: "Encoded text payload", severity: "medium", description: "Long base64 blob that decodes to readable text" },
  { id: "HC-007", name: "Look-alike domain", severity: "medium", description: "URL host with non-ASCII or punycode labels (IDN homograph)" },
  { id: "HC-008", name: "Mixed-script word", severity: "low", description: "Word mixing Latin with Cyrillic or Greek letters (homoglyph)" },
  { id: "HC-009", name: "Scanner manipulation", severity: "high", description: "Text that forges the review prompt's delimiters or addresses the automated security reviewer" },
  { id: "HC-010", name: "Unscanned oversized file", severity: "medium", description: "A file exceeded the scanner's size limit; the remainder was not scanned" },
  { id: "HC-011", name: "Opaque binary in bundle", severity: "high", description: "Compiled or binary file (.pyc, .exe, .so, ...) shipped with the skill; its behavior cannot be reviewed" },
];

const RULES = new Map(HIDDEN_CONTENT_RULES.map((r) => [r.id, r]));

export type HiddenPayloadKind = "unicode-tags" | "variation-selectors" | "zero-width" | "base64";

/** Decoded hidden text, rescanned by scanContent and shown to the Tier 2 judge. */
export interface HiddenPayload {
  kind: HiddenPayloadKind;
  lineNumber: number;
  text: string;
}

export interface HiddenFinding {
  patternId: string;
  patternName: string;
  severity: PatternSeverity;
  category: "prompt-injection";
  match: string;
  lineNumber: number;
  context: string;
}

export interface HiddenScanResult {
  findings: HiddenFinding[];
  payloads: HiddenPayload[];
}

const MAX_MATCH = 200;
const MAX_PAYLOAD = 4000;

const TAG_RUN_RE = /[\u{E0000}-\u{E007F}]+/gu;
const VS_RUN_RE = /[︀-️\u{E0100}-\u{E01EF}]{4,}/gu;
const ZW_RUN_RE = /[​‌‍⁠-⁤﻿]{4,}/g;
const BIDI_RE = /[‪-‮⁦-⁩]/g;
const BASE64_RE = /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/]{120,}={0,2}(?![A-Za-z0-9+/=_-])/g;
const URL_HOST_RE = /\bhttps?:\/\/([^\s/?#)"'<>\]]+)/gi;
const WORD_RE = /[\p{L}]{4,}/gu;
const LATIN_RE = /\p{Script=Latin}/u;
const CONFUSABLE_SCRIPT_RE = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const INVISIBLE_RE = /[​-‏‪-‮⁠-⁩﻿︀-️\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

// Comment bodies that address the agent rather than the human reader.
const DIRECTIVE_RES: RegExp[] = [
  /\b(?:ignore|disregard|override|forget|bypass)\b[^.\n]{0,60}\b(?:instructions?|prompts?|rules?|guidelines?|polic(?:y|ies)|restrictions?|safety)\b/i,
  /\b(?:do\s+not|don'?t|never)\s+(?:tell|inform|mention|reveal|show|notify|alert|ask)\b[^.\n]{0,40}\b(?:user|human|operator|anyone)\b/i,
  /\bwithout\s+(?:telling|informing|asking|notifying|alerting)\b/i,
  /\b(?:silently|secretly|covertly|quietly)\s+(?:run|execute|send|upload|post|copy|read|install|fetch|download|exfiltrate)\b/i,
  /\b(?:curl|wget)\b[^\n]*\|\s*(?:ba|z)?sh\b/i,
  /\b(?:curl|wget|nc|ncat|netcat|Invoke-WebRequest|iwr)\b[^\n]*\bhttps?:\/\//i,
  /\b(?:send|upload|post|exfiltrate|forward)\b[^.\n]{0,60}\b(?:to|at)\s+https?:\/\//i,
  /\b(?:system\s+prompt|new\s+instructions|you\s+are\s+now|from\s+now\s+on)\b/i,
  /\b(?:~\/\.ssh|id_rsa|\.aws\/credentials|\.env\b|api[_-]?keys?|access[_-]?tokens?|private\s+keys?)\b[^.\n]{0,60}\b(?:send|upload|post|read|copy|cat)\b/i,
  /\b(?:send|upload|post|read|copy|cat)\b[^.\n]{0,60}(?:~\/\.ssh|id_rsa|\.aws\/credentials|\.env\b|api[_-]?keys?|access[_-]?tokens?|private\s+keys?)/i,
];

// Text aimed at the LLM judge rather than the agent: forged prompt
// delimiters, or pleas to the automated reviewer to pass the skill.
const JUDGE_MANIPULATION_RES: RegExp[] = [
  /-{2,}\s*END\s+(?:OF\s+)?(?:SKILL\s+)?(?:SOURCE\s+CODE|SKILL(?:\s+CONTENT)?|FINDINGS|CRITICAL\s+FINDINGS|UNTRUSTED(?:\s+CONTENT)?)\s*-{2,}/i,
  /<<<\s*END_?(?:SKILL|UNTRUSTED)/i,
  /\b(?:security\s+scanner|LLM\s+(?:judge|reviewer)|AI\s+(?:security\s+)?reviewer|automated\s+(?:security\s+)?review(?:er)?)\b[^.\n]{0,60}\b(?:must|should|will)\s+(?:pass|approve|mark\s+(?:this|it)\s+(?:as\s+)?safe|rate\s+(?:this|it)|score\s+(?:this|it))\b/i,
  /\b(?:note|message|instructions?)\s+(?:to|for)\s+(?:the\s+)?(?:AI\s+|LLM\s+|automated\s+)?(?:security\s+)?(?:scanner|auditor|grader|judge)\b/i,
];

/** Make invisible characters visible so findings can be read and logged safely. */
export function revealInvisible(text: string): string {
  return text.replace(INVISIBLE_RE, (ch) => `\\u{${ch.codePointAt(0)!.toString(16).toUpperCase()}}`);
}

function clip(text: string, max = MAX_MATCH): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function decodeTags(run: string): string {
  let out = "";
  for (const ch of run) {
    const cp = ch.codePointAt(0)! - 0xe0000;
    if (cp >= 0x20 && cp <= 0x7e) out += String.fromCharCode(cp);
    else if (cp === 0x0a || cp === 0x0d || cp === 0x09) out += " ";
  }
  return out;
}

function decodeVariationSelectors(run: string): string {
  const bytes: number[] = [];
  for (const ch of run) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xfe00 && cp <= 0xfe0f) bytes.push(cp - 0xfe00);
    else if (cp >= 0xe0100 && cp <= 0xe01ef) bytes.push(cp - 0xe0100 + 16);
  }
  return printableOrEmpty(new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes)));
}

function decodeZeroWidthBinary(run: string): string {
  const chars = [...run];
  const distinct = [...new Set(chars)];
  if (distinct.length !== 2 || chars.length % 8 !== 0) return "";
  const [zero, one] = distinct.includes("​") ? ["​", distinct.find((c) => c !== "​")!] : distinct;
  const bytes: number[] = [];
  for (let i = 0; i < chars.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (chars[i + j] === one ? 1 : chars[i + j] === zero ? 0 : 0);
    bytes.push(b);
  }
  return printableOrEmpty(new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes)));
}

/** Returns the text when it is mostly printable, otherwise "". */
function printableOrEmpty(text: string): string {
  if (!text) return "";
  let printable = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d || (cp >= 0x20 && cp !== 0x7f && cp !== 0xfffd)) printable++;
  }
  return printable / [...text].length >= 0.9 ? text : "";
}

function decodeBase64Text(blob: string): string {
  try {
    const bin = atob(blob);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const text = printableOrEmpty(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
    // Readable prose or commands contain spaces; hashes and keys do not.
    return /\s/.test(text) ? text : "";
  } catch {
    return "";
  }
}

function lineOf(content: string, index: number, lineStarts: number[]): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Scan for hidden channels. Line numbers are 1-based and global (before file
 * boundary mapping). Decoded payloads are returned for rescanning.
 */
export function scanHiddenContent(content: string): HiddenScanResult {
  const findings: HiddenFinding[] = [];
  const payloads: HiddenPayload[] = [];
  if (!content) return { findings, payloads };

  const lines = content.split("\n");
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) lineStarts.push(i + 1);

  const context = (lineNumber: number): string =>
    clip(
      revealInvisible(lines.slice(Math.max(0, lineNumber - 2), Math.min(lines.length, lineNumber + 1)).join("\n")),
      600,
    );

  const add = (id: string, match: string, lineNumber: number): void => {
    const rule = RULES.get(id)!;
    findings.push({
      patternId: rule.id,
      patternName: rule.name,
      severity: rule.severity,
      category: "prompt-injection",
      match: clip(match),
      lineNumber,
      context: context(lineNumber),
    });
  };

  // Fast path: ASCII-only content cannot carry invisible Unicode.
  // eslint-disable-next-line no-control-regex
  const asciiOnly = !/[^\x00-\x7F]/.test(content);

  if (!asciiOnly) {
    for (const m of content.matchAll(TAG_RUN_RE)) {
      const line = lineOf(content, m.index!, lineStarts);
      const decoded = decodeTags(m[0]);
      add("HC-001", decoded ? `hidden text: "${decoded}"` : `${[...m[0]].length} tag characters`, line);
      if (decoded) payloads.push({ kind: "unicode-tags", lineNumber: line, text: decoded.slice(0, MAX_PAYLOAD) });
    }

    for (const m of content.matchAll(VS_RUN_RE)) {
      const line = lineOf(content, m.index!, lineStarts);
      const decoded = decodeVariationSelectors(m[0]);
      add("HC-004", decoded ? `hidden text: "${decoded}"` : `${[...m[0]].length} variation selectors`, line);
      if (decoded) payloads.push({ kind: "variation-selectors", lineNumber: line, text: decoded.slice(0, MAX_PAYLOAD) });
    }

    for (const m of content.matchAll(ZW_RUN_RE)) {
      const line = lineOf(content, m.index!, lineStarts);
      const decoded = decodeZeroWidthBinary(m[0]);
      add("HC-003", decoded ? `hidden text: "${decoded}"` : `${[...m[0]].length} zero-width characters`, line);
      if (decoded) payloads.push({ kind: "zero-width", lineNumber: line, text: decoded.slice(0, MAX_PAYLOAD) });
    }

    const bidiLines = new Set<number>();
    for (const m of content.matchAll(BIDI_RE)) {
      const line = lineOf(content, m.index!, lineStarts);
      if (bidiLines.has(line)) continue;
      bidiLines.add(line);
      add("HC-002", revealInvisible(lines[line - 1].trim()), line);
    }

    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(WORD_RE)) {
        if (LATIN_RE.test(m[0]) && CONFUSABLE_SCRIPT_RE.test(m[0])) {
          add("HC-008", m[0], i + 1);
          break;
        }
      }
    }
  }

  // HTML comments and markdown comment idioms render invisibly.
  const commentRes = [/<!--([\s\S]*?)-->/g, /^\s*\[(?:\/\/|comment)\]:\s*(?:#|<>)\s*\(([^\n]*)\)\s*$/gm];
  for (const re of commentRes) {
    for (const m of content.matchAll(re)) {
      const body = m[1] ?? "";
      if (body.trim().length < 8) continue;
      if (DIRECTIVE_RES.some((d) => d.test(body))) {
        const offset = m.index! + Math.max(0, m[0].indexOf(body.trimStart().slice(0, 1)));
        add("HC-005", revealInvisible(body.trim().replace(/\s+/g, " ")), lineOf(content, offset, lineStarts));
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (JUDGE_MANIPULATION_RES.some((re) => re.test(lines[i]))) add("HC-009", lines[i].trim(), i + 1);
    // Markers written by the platform's fetcher (truncated files) and bundle
    // scanner (binary files). The CLI does not emit them yet; content that
    // carries them was fetched through the platform.
    if (lines[i].startsWith("[vskill: file truncated at ")) add("HC-010", lines[i], i + 1);
    if (lines[i].startsWith("[vskill: opaque binary file ")) add("HC-011", lines[i], i + 1);
  }

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (lineText.length < 120) continue;
    for (const m of lineText.matchAll(BASE64_RE)) {
      const before = lineText.slice(Math.max(0, m.index! - 40), m.index!);
      if (/data:[\w.+-]+\/[\w.+-]+(?:;[\w=-]+)*;base64,$/i.test(before)) continue;
      const decoded = decodeBase64Text(m[0]);
      if (!decoded) continue;
      add("HC-006", `decodes to: "${revealInvisible(decoded)}"`, i + 1);
      payloads.push({ kind: "base64", lineNumber: i + 1, text: decoded.slice(0, MAX_PAYLOAD) });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(URL_HOST_RE)) {
      const host = m[1].replace(/:\d+$/, "").replace(/^[^@]*@/, "");
      // eslint-disable-next-line no-control-regex
      if (/[^\x00-\x7F]/.test(host) || /(?:^|\.)xn--/i.test(host)) {
        add("HC-007", revealInvisible(host), i + 1);
      }
    }
  }

  return { findings, payloads };
}
