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
  { id: "HC-009", name: "Scanner manipulation", severity: "high", description: "Text that forges the review prompt's delimiters, or addresses the automated reviewer from a comment, link definition, or invisible or encoded text" },
  { id: "HC-010", name: "Unscanned oversized file", severity: "medium", description: "A file exceeded the scanner's size limit; the remainder was not scanned" },
  { id: "HC-011", name: "Opaque binary in bundle", severity: "high", description: "Compiled or binary file (.pyc, .exe, .so, ...) shipped with the skill; its behavior cannot be reviewed" },
  // HC-012 and HC-013 are platform-only (VirusTotal findings).
  { id: "HC-014", name: "Text addressed to an AI reviewer", severity: "medium", description: "Visible text that addresses an AI or LLM reviewer, judge or grader; the judge reviews it, but it does not cap the score" },
];

const RULES = new Map(HIDDEN_CONTENT_RULES.map((r) => [r.id, r]));

export type HiddenPayloadKind = "unicode-tags" | "variation-selectors" | "zero-width" | "base64";

/** Decoded hidden text, rescanned by scanContent and shown to the Tier 2 judge. */
export interface HiddenPayload {
  kind: HiddenPayloadKind;
  lineNumber: number;
  /** Decoded text kept for display and the judge, at most MAX_PAYLOAD characters. */
  text: string;
  /**
   * CLI: the whole decoded text (bounded by MAX_BASE64_DECODE), which is what
   * scanContent rescans, so a payload cannot hide past the display cap.
   */
  fullText?: string;
}

export interface HiddenFinding {
  patternId: string;
  patternName: string;
  severity: PatternSeverity;
  category: "prompt-injection";
  match: string;
  lineNumber: number;
  context: string;
  /** CLI: findings of this rule folded into this one on the same line, when more than one. */
  occurrences?: number;
}

export interface HiddenScanResult {
  findings: HiddenFinding[];
  payloads: HiddenPayload[];
}

const MAX_MATCH = 200;
const MAX_PAYLOAD = 4000;
/** Base64 characters decoded per blob; bounds work on large embedded binaries. */
const MAX_BASE64_DECODE = 200_000;
const MIN_BASE64 = 120;
/** Characters of each context line kept around the match column. */
const CONTEXT_WINDOW = 200;
/**
 * Longest context kept on a finding, after invisible characters are revealed
 * (CLI-only bound: an escaped character is up to ten times longer than the
 * raw one). Each of the three context lines gets a third.
 */
const MAX_CONTEXT = 600;
const MAX_CONTEXT_LINE = Math.floor((MAX_CONTEXT - 2) / 3);
/** Findings listed per rule; the rest are counted on the last one listed. */
const MAX_FINDINGS_PER_RULE = 100;

const TAG_RUN_RE = /[\u{E0000}-\u{E007F}]+/gu;
// Subdivision flag emoji: U+1F3F4, a lowercase region + subdivision code in
// tag letters/digits, then CANCEL TAG (England, Scotland, Wales).
const FLAG_TAG_SEQ_RE = /^[\u{E0061}-\u{E007A}]{2}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,4}\u{E007F}/u;
const BLACK_FLAG = 0x1f3f4;
const VS_RUN_RE = /[︀-️\u{E0100}-\u{E01EF}]{4,}/gu;
const ZW_RUN_RE = /[​‌‍⁠-⁤﻿]{4,}/g;
const BIDI_RE = /[‪-‮⁦-⁩]/g;
const BIDI_OVERRIDE_RE = /[‪-‮]/;
const BASE64_RE = /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/_-]{120,}={0,2}(?![A-Za-z0-9+/=_-])/g;
const BASE64_LINE_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;
const DATA_URI_TAIL_RE = /data:[\w.+-]+\/[\w.+-]+(?:;[\w=-]+)*;base64,$/i;
const URL_HOST_RE = /\bhttps?:\/\/([^\s/?#)"'<>\]]+)/gi;
const WORD_RE = /[\p{L}]{4,}/gu;
const LATIN_RE = /\p{Script=Latin}/u;
const CONFUSABLE_SCRIPT_RE = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const INVISIBLE_RE = /[​-‏‪-‮⁠-⁩﻿︀-️\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

// Markdown structure that decides whether `<!--` opens a hidden comment.
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HTML_BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
// HTML blocks pass through raw: backticks and fences inside them are literal.
const HTML_BLOCK_RE = new RegExp(
  `^ {0,3}(?:<\\/?(?:${HTML_BLOCK_TAGS})(?:[\\s/>]|$)|<[A-Za-z][A-Za-z0-9-]*(?:\\s[^<>]*)?\\/?>[ \\t]*$|<\\/[A-Za-z][A-Za-z0-9-]*\\s*>[ \\t]*$|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`,
  "i",
);
const HTML_RAW_RE = /^ {0,3}<(?:pre|script|style|textarea)(?:[\s>]|$)/i;
const HTML_RAW_END_RE = /<\/(?:pre|script|style|textarea)>/i;
// Link reference definitions never render; their titles hide text.
const LINK_DEF_RE = /^ {0,3}\[[^\]]{1,999}\]:[ \t]*(?:<([^<>\n]*)>|(\S+))?(.*)$/;
const LINK_DEST_RE = /^\s*(?:<([^<>\n]*)>|(\S+))/;
const LINK_TITLE_RE = /^\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|\(((?:[^()\\]|\\[\s\S])*)\))[ \t]*(?:\n|$)/;
const LINK_TITLE_LOOSE_RE = /^[ \t]+(?:"(.*)"|'(.*)'|\((.*)\))[ \t]*$/;

const SECRET_REF = String.raw`(?:~\/\.ssh\b|\bid_rsa\b|\.aws\/credentials\b|\.env(?!\.(?:example|sample|template|dist)\b)(?:\.\w[\w-]*)?(?!\w|\.\w)|\bapi[_-]?keys?\b|\baccess[_-]?tokens?\b|\bprivate\s+keys?\b)`;

// Comment bodies that address the agent rather than the human reader.
const DIRECTIVE_RES: RegExp[] = [
  // Addressed to an agent: only qualifiers such as "all previous" or "your
  // safety" may stand between the verb and the noun, so linter and TODO
  // comments ("ignore the line-length rules", "ignore any previous lint
  // rules") do not match.
  /\b(?:ignore|disregard|override|forget|bypass)\s+(?:(?:all|any|the|your|my|its|these|those|every|each|of|previous|prior|above|earlier|preceding|original|initial|system|safety|security|ethical|content|given|provided|other|existing|current|developer|operator|user)\s+){0,5}(?:instructions?|prompts?|rules?|guidelines?|polic(?:y|ies)|restrictions?|safety|directives?|guardrails?)\b/i,
  /\b(?:do\s+not|don'?t|never)\s+(?:tell|inform|mention|reveal|show|notify|alert|ask)\b[^.\n]{0,40}\b(?:user|human|operator|anyone)\b/i,
  /\bwithout\s+(?:telling|informing|asking|notifying|alerting)\b/i,
  /\b(?:silently|secretly|covertly|quietly)\s+(?:run|execute|send|upload|post|copy|read|install|fetch|download|exfiltrate)\b/i,
  /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n]{0,300}\|\s*(?:(?:ba|z|da)?sh|iex|Invoke-Expression)\b/i,
  // Network tools uploading a local file or command output, not plain fetches.
  /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^\n]{0,300}?(?:\s(?:-T|--upload-file|--post-file|-InFile)\b|\s(?:-d|--data(?:-[a-z]+)?|-F|--form)[\s=]*['"]?(?:[^\s'"]*@|\$\())/i,
  /\b(?:nc|ncat|netcat)\s[^\n]{0,100}?(?:<\s*[~/.$\w]|\s-e\s)/i,
  /\b(?:send|upload|post|exfiltrate|forward)\b[^.\n]{0,60}\b(?:to|at)\s+https?:\/\//i,
  // "system prompt", "new instructions" and "from now on" only as orders to
  // an agent, not in "TODO: from now on generate this" or "the system prompt
  // lives below".
  /\b(?:reveal|print|show|output|leak|repeat|dump|disclose|ignore|disregard|forget|override|replace)\s+(?:(?:the|your|my|its|this|that|entire|full|original|hidden|whole)\s+){0,3}system\s+prompts?\b|\b(?:new|updated|real|actual|true|override)\s+system\s+prompt\b|\bsystem\s+prompt\s*(?::|=|override\b|is\s+now\b)/i,
  /\b(?:your|here\s+are\s+(?:your|the)|these\s+are\s+(?:your|the)|the\s+following\s+are\s+(?:your|the))\s+new\s+instructions\b|\bnew\s+instructions\s*:/i,
  /\byou\s+are\s+now\b/i,
  /\bfrom\s+now\s+on\s*[,:]?\s+(?:you|your|ignore|disregard|always|never|do\s+not|don'?t|respond|reply|answer|act|behave|pretend|only|treat|obey|follow)\b|\byou(?:'ll|\s+will|\s+must|\s+should|\s+shall|\s+are\s+to)\b[^.\n]{0,40}\bfrom\s+now\s+on\b/i,
  new RegExp(`${SECRET_REF}[^.\\n]{0,60}\\b(?:send|upload|post|read|copy|cat)\\b`, "i"),
  new RegExp(`\\b(?:send|upload|post|read|copy|cat)\\b[^.\\n]{0,60}${SECRET_REF}`, "i"),
];

// Reviewers that are named as automated ("AI reviewers", "LLM-judge",
// "security analyst"), and bare roles that only count next to a verdict.
const AI_JUDGE = String.raw`(?:(?:LLM|AI|automated|automatic)[\s-]+(?:security[\s-]+)?(?:code[\s-]+)?(?:review(?:er)?s?|judges?|graders?|auditors?|scanners?|analy[sz]ers?|analysts?|evaluators?)|security[\s-]+(?:scanners?|analysts?))`;
const ROLE = String.raw`(?:reviewers?|graders?|judges?|evaluators?|analysts?)`;
const SAFE_WORD = String.raw`(?:safe|clean|benign|harmless|trusted|legitimate|non-?malicious|not\s+malicious)`;
// The thing under review: "it", "this skill", "the submitted package".
const SELF = String.raw`(?:it|this(?:\s+[\w-]+)?|the\s+(?:[\w-]+\s+)?(?:skill|plugin|package|file|code|submission|repo(?:sitory)?|content))`;
// Verdict or score requests: "classify this skill as benign", "rate it 100",
// "return score 97", "return PASS".
const VERDICT = String.raw`(?:(?:mark|rate|score|grade|treat|classify|consider|label|report|deem|flag)\s+${SELF}\s+as\s+(?:an?\s+)?${SAFE_WORD}\b|(?:score|rate|grade)\s+${SELF}\s+(?:at\s+|an?\s+)?\d{2,3}\b|(?:return|give|assign|output|report)\s+(?:it\s+|this(?:\s+[\w-]+)?\s+)?(?:an?\s+)?(?:score|rating)(?:\s+of)?\s*[:=]?\s*\d{2,3}\b|(?:return|output|respond\s+with)\s+(?:an?\s+)?(?:verdict\s*(?:of\s*)?[:=]?\s*)?["'\x60]?PASS\b)`;
// Only an automated reviewer is asked to approve or pass a skill.
const APPROVAL = String.raw`(?:(?:approve|pass|clear|accept|allow|whitelist|trust)\s+(?:this|the)\s+(?:skill|plugin|package|file|code|submission)\b|(?:mark|rate|treat|classify|consider|label|report)\s+${SELF}\s+as\s+(?:verified|approved|pass(?:ed|ing)?)\b)`;

// The judge prompt's own section markers (tier2.ts, judge-guard.ts, and the
// source-code markers of earlier prompts). Forging them is always HC-009.
const JUDGE_FORGERY_RES: RegExp[] = [
  /--\s*(?:END\s+CRITICAL\s+FINDINGS|(?:CRITICAL|TIER\s+1)\s+FINDINGS\s+TO\s+VALIDATE|(?:END\s+(?:OF\s+)?)?SKILL\s+SOURCE\s+CODE|END\s+(?:OF\s+)?SOURCE\s+CODE)\s*--/i,
  /UNTRUSTED_SKILL_|DECODED\s+HIDDEN\s+CONTENT/i,
  // CLI judge prompt (tier2-llm.ts): Markdown section headings, not dashes.
  /^[ \t]{0,3}#{1,6}[ \t]*(?:CRITICAL\s+FINDINGS\s+TO\s+VALIDATE|TIER\s+1\s+SCANNER\s+FINDINGS)\b/im,
  /\bReturn\s+one\s+criticalValidation\s+entry\b/i,
];

// Text aimed at an AI reviewer or judge. Code-review and eval skills write
// this in plain sight, so visible text is HC-014 (the judge must run, the
// score is not capped); in a comment, link definition, or invisible or
// encoded text it is HC-009. Multiline so `^` anchors in comment bodies.
const JUDGE_PROSE_RES: RegExp[] = [
  new RegExp(String.raw`\b${AI_JUDGE}\b[^.\n]{0,80}?\b(?:${VERDICT}|${APPROVAL})`, "im"),
  new RegExp(String.raw`\b${ROLE}\b[^.\n]{0,80}?\b${VERDICT}`, "im"),
  new RegExp(String.raw`\b(?:notes?|messages?|instructions?|directions?|reminders?|guidance|hints?)\s+(?:to|for)\s+(?:the\s+|all\s+|any\s+|an?\s+)?${AI_JUDGE}\b`, "im"),
  new RegExp(String.raw`\b${AI_JUDGE}\s+(?:notes?|messages?|instructions?|directions?|reminders?)\b`, "im"),
  new RegExp(String.raw`\b(?:dear|hey|hello|attention)\s*,?\s+(?:the\s+|all\s+|any\s+)?${AI_JUDGE}\b|^[ \t#>*_-]*(?:to\s+(?:the\s+|all\s+|any\s+)?)?${AI_JUDGE}\s*[:,]`, "im"),
];
const JUDGE_PROSE_GLOBAL_RES = JUDGE_PROSE_RES.map((re) => new RegExp(re.source, "gim"));

/** Make invisible characters visible so findings can be read and logged safely. */
export function revealInvisible(text: string): string {
  return text.replace(INVISIBLE_RE, (ch) => `\\u{${ch.codePointAt(0)!.toString(16).toUpperCase()}}`);
}

/**
 * A flat copy of a short string. Slices of a large string keep the whole
 * parent alive; findings must not pin a multi-megabyte line.
 */
function flat(text: string): string {
  return text.length < 16 ? text : text.split("").join("");
}

function isHighSurrogate(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}

/** `text.slice(start, end)` without splitting a surrogate pair at either end. */
function safeSlice(text: string, start: number, end: number): string {
  let s = Math.max(0, start);
  let e = Math.min(text.length, end);
  if (s > 0 && s < text.length && isHighSurrogate(text.charCodeAt(s - 1))) s++;
  if (e < text.length && e > s && isHighSurrogate(text.charCodeAt(e - 1))) e--;
  return text.slice(s, e);
}

function clip(text: string, max = MAX_MATCH): string {
  return flat(text.length > max ? `${safeSlice(text, 0, max)}…` : text);
}

/** clip(revealInvisible(text)) without revealing more of the text than is kept. */
function revealClip(text: string, max = MAX_MATCH): string {
  const head = text.length > max ? safeSlice(text, 0, max) : text;
  const shown = revealInvisible(head);
  return shown.length > max || head.length < text.length ? flat(`${safeSlice(shown, 0, max)}…`) : flat(shown);
}

/** About `CONTEXT_WINDOW` characters of a line around `column`. */
function windowAround(text: string, column: number): string {
  if (text.length <= CONTEXT_WINDOW) return text;
  const start = Math.max(0, Math.min(column - CONTEXT_WINDOW / 2, text.length - CONTEXT_WINDOW));
  return safeSlice(text, start, start + CONTEXT_WINDOW);
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

/**
 * Decode standard or URL-safe base64 to readable text. Tries all four
 * alignments so a few glued-on characters in front cannot hide the payload.
 */
function decodeBase64Text(blob: string): string {
  const norm = blob.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/").slice(0, MAX_BASE64_DECODE);
  for (let offset = 0; offset < 4 && norm.length - offset >= 4; offset++) {
    let s = norm.slice(offset);
    if (s.length % 4 === 1) s = s.slice(0, -1);
    s += "=".repeat((4 - (s.length % 4)) % 4);
    try {
      const bin = atob(s);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const text = printableOrEmpty(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
      // Readable prose or commands contain spaces; hashes and keys do not.
      if (/\s/.test(text)) return text;
    } catch {
      // not base64 at this alignment
    }
  }
  return "";
}

function isBase64Char(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 45 || c === 95;
}

/** Trailing base64 characters of a line that may continue on the next lines. */
function base64Tail(text: string): string {
  if (text.endsWith("=")) return "";
  let i = text.length;
  while (i > 0 && isBase64Char(text.charCodeAt(i - 1))) i--;
  return text.slice(i);
}

function joinCapped(parts: string[], from: number, prefix = ""): string {
  let out = prefix;
  for (let k = from; k < parts.length && out.length < MAX_BASE64_DECODE + 4; k++) out += parts[k];
  return out;
}

/** Balanced isolates around non-Latin text are how RTL words are embedded; anything else can reorder code. */
function hasBidiTrick(line: string): boolean {
  if (BIDI_OVERRIDE_RE.test(line)) return true;
  const latin: boolean[] = [];
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c >= 0x2066 && c <= 0x2068) latin.push(false);
    else if (c === 0x2069) {
      if (latin.length === 0) return true;
      if (latin.pop()) return true;
    } else if (latin.length > 0 && ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) {
      latin[latin.length - 1] = true;
    }
  }
  return latin.length > 0;
}

const RTL_LETTER_RE = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g;

/**
 * Bidi controls in right-to-left prose: Arabic or Hebrew text whose
 * embeddings and isolates all close, with no overrides. This is how mixed
 * RTL/LTR text is written; Trojan Source reordering needs an override or an
 * unclosed control.
 */
export function isNaturalRtlBidi(text: string): boolean {
  if ((text.match(RTL_LETTER_RE) ?? []).length < 3) return false;
  const open: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    if (c === 0x202d || c === 0x202e) return false;
    if (c === 0x202a || c === 0x202b) open.push(0x202c);
    else if (c >= 0x2066 && c <= 0x2068) open.push(0x2069);
    else if ((c === 0x202c || c === 0x2069) && open.pop() !== c) return false;
  }
  return open.length === 0;
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

function leadingSpaces(text: string): number {
  let n = 0;
  while (n < text.length && (text[n] === " " || text[n] === "\t")) n += text[n] === "\t" ? 4 : 1;
  return n;
}

interface TickRun {
  at: number;
  len: number;
  /** Index of the next run with the same length, or -1. */
  next: number;
}

function backtickRuns(text: string): TickRun[] {
  const runs: TickRun[] = [];
  for (let i = text.indexOf("`"); i >= 0; i = text.indexOf("`", i)) {
    let n = 1;
    while (text.charCodeAt(i + n) === 96) n++;
    runs.push({ at: i, len: n, next: -1 });
    i += n;
  }
  const lastByLen = new Map<number, number>();
  for (let k = runs.length - 1; k >= 0; k--) {
    runs[k].next = lastByLen.get(runs[k].len) ?? -1;
    lastByLen.set(runs[k].len, k);
  }
  return runs;
}

function escapedAt(text: string, i: number): boolean {
  let n = 0;
  while (i - n - 1 >= 0 && text.charCodeAt(i - n - 1) === 92) n++;
  return n % 2 === 1;
}

interface CommentBody {
  text: string;
  offset: number;
}

/**
 * HTML comment bodies that render invisibly. `<!--` inside fenced code or an
 * inline code span is shown as text, so it opens nothing; inside an HTML block
 * backticks are literal, so it does. An unclosed `<!--` hides the rest of the
 * document. `covered` marks lines inside code or comments.
 */
function findHiddenComments(content: string, lines: string[], lineStarts: number[]): { bodies: CommentBody[]; covered: Uint8Array } {
  const bodies: CommentBody[] = [];
  const covered = new Uint8Array(lines.length);
  let fence: { ch: string; len: number; indent: number } | null = null;
  let html: "blank" | "raw" | null = null;
  let i = 0;
  let col = 0;
  let raw = false;

  while (i < lines.length) {
    const text = lines[i].endsWith("\r") ? lines[i].slice(0, -1) : lines[i];
    if (col === 0) {
      const blank = text.trim() === "";
      if (fence) {
        const close = FENCE_CLOSE_RE.exec(text);
        if (close && close[1][0] === fence.ch && close[1].length >= fence.len) {
          covered[i] = 1;
          fence = null;
          i++;
          continue;
        }
        if (blank || leadingSpaces(text) >= fence.indent) {
          covered[i] = 1;
          i++;
          continue;
        }
        // A less-indented line ends the list item holding the fence.
        fence = null;
      }
      if (html === "blank" && blank) {
        html = null;
        i++;
        continue;
      }
      if (html === null) {
        if (blank) {
          i++;
          continue;
        }
        const open = FENCE_OPEN_RE.exec(text);
        if (open && !(open[2][0] === "`" && open[3].includes("`"))) {
          fence = { ch: open[2][0], len: open[2].length, indent: open[1].length };
          covered[i] = 1;
          i++;
          continue;
        }
        if (text.trimStart().startsWith("<")) {
          if (HTML_RAW_RE.test(text)) html = "raw";
          else if (HTML_BLOCK_RE.test(text)) html = "blank";
        }
      }
      raw = html !== null;
    }

    const runs = raw || !text.includes("`") ? [] : backtickRuns(text);
    let r = 0;
    let resume = -1;
    let c = col;
    while (c < text.length) {
      const open = text.indexOf("<!--", c);
      while (r < runs.length && runs[r].at < c) r++;
      const tick = r < runs.length ? runs[r].at : -1;
      if (open < 0 && tick < 0) break;
      if (tick >= 0 && (open < 0 || tick < open)) {
        const run = runs[r];
        const close = escapedAt(text, run.at) ? -1 : run.next;
        c = close < 0 ? run.at + run.len : runs[close].at + run.len;
        continue;
      }
      const start = lineStarts[i] + open + 4;
      // `<!-->` and `<!--->` are empty comments.
      if (content.startsWith(">", start)) {
        c = open + 5;
        continue;
      }
      if (content.startsWith("->", start)) {
        c = open + 6;
        continue;
      }
      const blockLevel: boolean = raw || text.slice(0, open).trim() === "";
      const end = content.indexOf("-->", start);
      if (end < 0) {
        bodies.push({ text: content.slice(start), offset: start });
        covered.fill(1, i);
        return { bodies, covered };
      }
      bodies.push({ text: content.slice(start, end), offset: start });
      resume = end + 3;
      raw = blockLevel;
      break;
    }

    if (resume < 0) {
      if (html === "raw" && HTML_RAW_END_RE.test(text)) html = null;
      i++;
      col = 0;
      continue;
    }
    let j = i;
    while (j + 1 < lineStarts.length && lineStarts[j + 1] <= resume) j++;
    covered.fill(1, i, j + 1);
    if (j !== i) html = null;
    i = j;
    col = resume - lineStarts[j];
  }
  return { bodies, covered };
}

/** Hidden text of a link reference definition starting on line `i`, or "". */
function linkDefinitionText(lines: string[], i: number, covered: Uint8Array): string {
  const m = LINK_DEF_RE.exec(lines[i]);
  if (!m) return "";
  let dest = m[1];
  let hasDest = m[1] !== undefined || m[2] !== undefined;
  let rest = m[3];
  let tail = "";
  for (let k = i + 1; k < lines.length && k <= i + 10 && !covered[k] && lines[k].trim() !== ""; k++) tail += `\n${lines[k]}`;
  if (!hasDest) {
    const d = LINK_DEST_RE.exec(tail);
    if (!d) return "";
    dest = d[1];
    hasDest = true;
    rest = "";
    tail = tail.slice(d[0].length);
  }
  let title: string | undefined;
  const strict = LINK_TITLE_RE.exec(rest.trim() === "" ? tail : rest + tail);
  if (strict) title = strict[1] ?? strict[2] ?? strict[3];
  else if (rest.trim() !== "") {
    const loose = LINK_TITLE_LOOSE_RE.exec(rest);
    if (!loose) return "";
    title = loose[1] ?? loose[2] ?? loose[3];
  }
  return [dest, title].filter((s): s is string => !!s).join(" ");
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

  // Each context line is windowed before it is revealed, so a finding on a
  // huge line costs O(window), not O(line).
  const context = (lineNumber: number, column: number): string => {
    const parts: string[] = [];
    for (let k = Math.max(0, lineNumber - 2); k < Math.min(lines.length, lineNumber + 1); k++) {
      // No ellipsis: the middle line must stay a substring of the revealed
      // line, which is how judge-guard locates the finding.
      parts.push(safeSlice(revealInvisible(windowAround(lines[k], column)), 0, MAX_CONTEXT_LINE));
    }
    return flat(parts.join("\n"));
  };

  // One finding per rule per line, and at most MAX_FINDINGS_PER_RULE per
  // rule; the rest are counted. Capping per rule keeps a flood of one kind
  // from crowding out another.
  const byLine = new Map<string, { finding: HiddenFinding; more: number }>();
  const perRule = new Map<string, { listed: number; last: HiddenFinding | null; unlisted: number }>();
  const add = (id: string, match: string, lineNumber: number, column = 0, severity?: HiddenFinding["severity"]): void => {
    const key = `${id}:${lineNumber}`;
    const seen = byLine.get(key);
    if (seen) {
      seen.more++;
      return;
    }
    const tally = perRule.get(id) ?? { listed: 0, last: null, unlisted: 0 };
    perRule.set(id, tally);
    if (tally.listed >= MAX_FINDINGS_PER_RULE) {
      tally.unlisted++;
      return;
    }
    const rule = RULES.get(id)!;
    const finding: HiddenFinding = {
      patternId: rule.id,
      patternName: rule.name,
      severity: severity ?? rule.severity,
      category: "prompt-injection",
      // Revealed here too (CLI): decoded selector text can carry invisibles.
      match: revealClip(match),
      lineNumber,
      context: context(lineNumber, column),
    };
    findings.push(finding);
    byLine.set(key, { finding, more: 0 });
    tally.listed++;
    tally.last = finding;
  };

  // Decoded text from the same line and channel is merged into one payload.
  const payloadAt = new Map<string, HiddenPayload>();
  const addPayload = (kind: HiddenPayloadKind, lineNumber: number, text: string): void => {
    const key = `${kind}:${lineNumber}`;
    const prev = payloadAt.get(key);
    if (!prev) {
      const full = safeSlice(text, 0, MAX_BASE64_DECODE);
      const payload: HiddenPayload = { kind, lineNumber, text: safeSlice(full, 0, MAX_PAYLOAD), fullText: full };
      payloadAt.set(key, payload);
      payloads.push(payload);
    } else if ((prev.fullText ?? prev.text).length < MAX_BASE64_DECODE) {
      prev.fullText = safeSlice(`${prev.fullText ?? prev.text}\n${text}`, 0, MAX_BASE64_DECODE);
      prev.text = safeSlice(prev.fullText, 0, MAX_PAYLOAD);
    }
  };

  // Binary bytes decoded as text (an image in a bundle) can form tag,
  // selector, zero-width or bidi characters by chance. A line holding NUL or
  // U+FFFD is undecodable data, not text an agent reads as instructions.
  const junkLines = new Map<number, boolean>();
  const isJunkLine = (lineNumber: number): boolean => {
    let junk = junkLines.get(lineNumber);
    if (junk === undefined) {
      // eslint-disable-next-line no-control-regex
      junk = /[\u0000\uFFFD]/.test(lines[lineNumber - 1] ?? "");
      junkLines.set(lineNumber, junk);
    }
    return junk;
  };

  // Fast path: ASCII-only content cannot carry invisible Unicode.
  // eslint-disable-next-line no-control-regex
  const asciiOnly = !/[^\x00-\x7F]/.test(content);

  if (!asciiOnly) {
    for (const m of content.matchAll(TAG_RUN_RE)) {
      let run = m[0];
      let at = m.index!;
      if (content.codePointAt(at - 2) === BLACK_FLAG) {
        const flag = FLAG_TAG_SEQ_RE.exec(run);
        if (flag) {
          run = run.slice(flag[0].length);
          at += flag[0].length;
        }
      }
      if (!run) continue;
      const line = lineOf(content, at, lineStarts);
      if (isJunkLine(line)) continue;
      const decoded = decodeTags(run);
      add("HC-001", decoded ? `hidden text: "${decoded}"` : `${[...run].length} tag characters`, line, at - lineStarts[line - 1]);
      if (decoded) addPayload("unicode-tags", line, decoded);
    }

    for (const m of content.matchAll(VS_RUN_RE)) {
      const line = lineOf(content, m.index!, lineStarts);
      if (isJunkLine(line)) continue;
      const decoded = decodeVariationSelectors(m[0]);
      add("HC-004", decoded ? `hidden text: "${decoded}"` : `${[...m[0]].length} variation selectors`, line, m.index! - lineStarts[line - 1]);
      if (decoded) addPayload("variation-selectors", line, decoded);
    }

    for (const m of content.matchAll(ZW_RUN_RE)) {
      const line = lineOf(content, m.index!, lineStarts);
      if (isJunkLine(line)) continue;
      const decoded = decodeZeroWidthBinary(m[0]);
      add("HC-003", decoded ? `hidden text: "${decoded}"` : `${[...m[0]].length} zero-width characters`, line, m.index! - lineStarts[line - 1]);
      if (decoded) addPayload("zero-width", line, decoded);
    }

    const bidiLines = new Set<number>();
    for (const m of content.matchAll(BIDI_RE)) {
      const line = lineOf(content, m.index!, lineStarts);
      if (bidiLines.has(line)) continue;
      bidiLines.add(line);
      if (isJunkLine(line)) continue;
      const text = lines[line - 1];
      // Balanced isolates in RTL prose are how mixed-direction text is
      // written; report them as info so they neither score nor hold.
      if (hasBidiTrick(text)) {
        add("HC-002", revealClip(text.trim()), line, m.index! - lineStarts[line - 1], isNaturalRtlBidi(text) ? "info" : undefined);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(WORD_RE)) {
        if (LATIN_RE.test(m[0]) && CONFUSABLE_SCRIPT_RE.test(m[0])) {
          add("HC-008", m[0], i + 1, m.index!);
          break;
        }
      }
    }
  }

  // HTML comments and link reference definitions render invisibly. Text in
  // them aimed at the judge is HC-009; `judgeHidden` marks those lines.
  const judgeHidden = new Set<number>();
  const addHiddenJudge = (text: string, offset: number): void => {
    for (const re of JUDGE_PROSE_GLOBAL_RES) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const line = lineOf(content, offset + m.index, lineStarts);
        if (m[0].length === 0) re.lastIndex++;
        if (judgeHidden.has(line)) continue;
        judgeHidden.add(line);
        add("HC-009", revealClip(m[0].trim()), line, offset + m.index - lineStarts[line - 1]);
      }
    }
  };
  const { bodies, covered } = findHiddenComments(content, lines, lineStarts);
  for (const { text: body, offset } of bodies) {
    if (body.trim().length < 8) continue;
    if (DIRECTIVE_RES.some((d) => d.test(body))) {
      const lead = body.length - body.trimStart().length;
      const first = offset + lead;
      const line = lineOf(content, first, lineStarts);
      add("HC-005", revealClip(safeSlice(body, lead, lead + 4 * MAX_MATCH).replace(/\s+/g, " ").trim()), line, first - lineStarts[line - 1]);
    }
    addHiddenJudge(body, offset);
  }
  for (let i = 0; i < lines.length; i++) {
    if (covered[i] || !/^ {0,3}\[/.test(lines[i])) continue;
    const body = linkDefinitionText(lines, i, covered);
    if (body.trim().length >= 8 && DIRECTIVE_RES.some((d) => d.test(body))) {
      add("HC-005", revealClip(safeSlice(body.trim(), 0, 4 * MAX_MATCH).replace(/\s+/g, " ")), i + 1);
    }
    if (JUDGE_PROSE_RES.some((re) => re.test(body))) {
      judgeHidden.add(i + 1);
      add("HC-009", revealClip(body.trim()), i + 1);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Invisible characters inside the words only hide them from this check.
    const probe = asciiOnly ? line : line.replace(INVISIBLE_RE, "");
    if (JUDGE_FORGERY_RES.some((re) => re.test(probe))) add("HC-009", revealClip(line.trim()), i + 1);
    else if (!judgeHidden.has(i + 1) && JUDGE_PROSE_RES.some((re) => re.test(probe))) {
      const plain = probe === line || JUDGE_PROSE_RES.some((re) => re.test(line));
      add(plain ? "HC-014" : "HC-009", revealClip(line.trim()), i + 1);
    }
    // Markers written by the platform's fetcher (truncated files) and bundle
    // scanner (binary files). The CLI does not emit them yet; content that
    // carries them was fetched through the platform.
    if (line.startsWith("[vskill: file truncated at ")) add("HC-010", line, i + 1);
    if (line.startsWith("[vskill: opaque binary file ")) add("HC-011", line, i + 1);
  }

  // Base64 on one line, or wrapped across consecutive lines (PEM/MIME style).
  const trimmed = lines.map((l) => l.trim());
  const pure = trimmed.map((t) => t.length > 0 && BASE64_LINE_RE.test(t));
  const addBase64 = (candidates: string[], lineNumber: number, column = 0): void => {
    for (const blob of candidates) {
      if (blob.length < MIN_BASE64) continue;
      const decoded = decodeBase64Text(blob);
      if (!decoded) continue;
      add("HC-006", `decodes to: "${revealClip(decoded)}"`, lineNumber, column);
      addPayload("base64", lineNumber, decoded);
      return;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    let tail = "";
    if (!pure[i]) {
      const lineText = lines[i];
      if (i + 1 < lines.length && pure[i + 1]) tail = base64Tail(trimmed[i]);
      const lineEnd = lineText.trimEnd().length;
      if (lineText.length >= MIN_BASE64) {
        for (const m of lineText.matchAll(BASE64_RE)) {
          // A blob that runs on into the next lines is decoded as one below.
          if (tail && m.index! + m[0].length === lineEnd) continue;
          const before = lineText.slice(Math.max(0, m.index! - 100), m.index!);
          if (DATA_URI_TAIL_RE.test(before)) continue;
          addBase64([m[0]], i + 1, m.index!);
        }
      }
      if (!tail) continue;
    } else if (i > 0 && DATA_URI_TAIL_RE.test(trimmed[i - 1].slice(-100))) {
      while (i + 1 < lines.length && pure[i + 1]) i++;
      continue;
    }

    const parts: string[] = [];
    let j = pure[i] ? i : i + 1;
    for (; j < lines.length && pure[j]; j++) {
      parts.push(trimmed[j]);
      if (trimmed[j].endsWith("=")) {
        j++;
        break;
      }
    }
    const before = tail ? trimmed[i].slice(0, trimmed[i].length - tail.length) : "";
    if (!DATA_URI_TAIL_RE.test(before.slice(-100))) {
      const candidates: string[] = [];
      if (tail) candidates.push(joinCapped(parts, 0, tail), tail);
      // Also try from the next few lines, in case a junk line leads the blob.
      for (let k = 0; k < Math.min(parts.length, 4); k++) candidates.push(joinCapped(parts, k));
      addBase64(candidates, i + 1);
    }
    i = j - 1;
  }

  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(URL_HOST_RE)) {
      const host = m[1].replace(/:\d+$/, "").replace(/^[^@]*@/, "");
      // eslint-disable-next-line no-control-regex
      if (/[^\x00-\x7F]/.test(host) || /(?:^|\.)xn--/i.test(host)) {
        add("HC-007", revealClip(host), i + 1, m.index!);
      }
    }
  }

  // Judge manipulation in decoded invisible or encoded text.
  for (const payload of payloads) {
    const full = payload.fullText ?? payload.text;
    if (JUDGE_FORGERY_RES.some((re) => re.test(full)) || JUDGE_PROSE_RES.some((re) => re.test(full))) {
      add("HC-009", `[hidden ${payload.kind}] ${revealClip(payload.text.trim())}`, payload.lineNumber);
    }
  }

  for (const { finding, more } of byLine.values()) {
    if (more > 0) {
      finding.match = `${finding.match} (+${more} more on this line)`;
      finding.occurrences = more + 1;
    }
  }
  for (const [id, tally] of perRule) {
    if (tally.unlisted > 0 && tally.last) tally.last.match = `${tally.last.match} (+${tally.unlisted} more ${id} findings not listed)`;
  }
  for (const payload of payloads) {
    payload.text = flat(payload.text);
    if (payload.fullText !== undefined) payload.fullText = flat(payload.fullText);
  }
  return { findings, payloads };
}
