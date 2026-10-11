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
/** Base64 characters decoded per blob; bounds work on large embedded binaries. */
const MAX_BASE64_DECODE = 200_000;
const MIN_BASE64 = 120;

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
  /\b(?:ignore|disregard|override|forget|bypass)\b[^.\n]{0,60}\b(?:instructions?|prompts?|rules?|guidelines?|polic(?:y|ies)|restrictions?|safety)\b/i,
  /\b(?:do\s+not|don'?t|never)\s+(?:tell|inform|mention|reveal|show|notify|alert|ask)\b[^.\n]{0,40}\b(?:user|human|operator|anyone)\b/i,
  /\bwithout\s+(?:telling|informing|asking|notifying|alerting)\b/i,
  /\b(?:silently|secretly|covertly|quietly)\s+(?:run|execute|send|upload|post|copy|read|install|fetch|download|exfiltrate)\b/i,
  /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n]{0,300}\|\s*(?:(?:ba|z|da)?sh|iex|Invoke-Expression)\b/i,
  // Network tools uploading a local file or command output, not plain fetches.
  /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^\n]{0,300}?(?:\s(?:-T|--upload-file|--post-file|-InFile)\b|\s(?:-d|--data(?:-[a-z]+)?|-F|--form)[\s=]*['"]?(?:[^\s'"]*@|\$\())/i,
  /\b(?:nc|ncat|netcat)\s[^\n]{0,100}?(?:<\s*[~/.$\w]|\s-e\s)/i,
  /\b(?:send|upload|post|exfiltrate|forward)\b[^.\n]{0,60}\b(?:to|at)\s+https?:\/\//i,
  /\b(?:system\s+prompt|new\s+instructions|you\s+are\s+now|from\s+now\s+on)\b/i,
  new RegExp(`${SECRET_REF}[^.\\n]{0,60}\\b(?:send|upload|post|read|copy|cat)\\b`, "i"),
  new RegExp(`\\b(?:send|upload|post|read|copy|cat)\\b[^.\\n]{0,60}${SECRET_REF}`, "i"),
];

const JUDGE_SUBJECT = String.raw`(?:security\s+scanner|(?:LLM|AI|automated)\s+(?:security\s+)?(?:review(?:er)?|judge|grader|auditor|scanner))`;
const SKILL_OBJECT = String.raw`(?:skill|plugin|package|file|code)`;

// Text aimed at the LLM judge rather than the agent: the judge prompt's own
// section markers (tier2.ts, judge-guard.ts, and the source-code markers of
// earlier prompts), or pleas to the automated reviewer to pass this skill.
const JUDGE_MANIPULATION_RES: RegExp[] = [
  /--\s*(?:END\s+CRITICAL\s+FINDINGS|(?:CRITICAL|TIER\s+1)\s+FINDINGS\s+TO\s+VALIDATE|(?:END\s+(?:OF\s+)?)?SKILL\s+SOURCE\s+CODE|END\s+(?:OF\s+)?SOURCE\s+CODE)\s*--/i,
  /UNTRUSTED_SKILL_|DECODED\s+HIDDEN\s+CONTENT/i,
  new RegExp(
    `\\b${JUDGE_SUBJECT}\\b[^.\\n]{0,60}\\b(?:must|should|will|shall)\\s+(?:(?:approve|pass|clear|accept|allow|whitelist)\\s+(?:this|the)\\s+${SKILL_OBJECT}|(?:mark|rate|score|treat|classify|consider)\\s+(?:this|it|the)(?:\\s+${SKILL_OBJECT})?\\s+(?:as\\s+)?(?:safe|clean|benign|harmless|trusted|verified|pass|\\d{2,3})\\b)`,
    "i",
  ),
  new RegExp(`\\b(?:note|message|instructions?)\\s+(?:to|for)\\s+(?:the\\s+)?${JUDGE_SUBJECT}\\b`, "i"),
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
      const decoded = decodeTags(run);
      add("HC-001", decoded ? `hidden text: "${decoded}"` : `${[...run].length} tag characters`, line);
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
      if (hasBidiTrick(lines[line - 1])) add("HC-002", revealInvisible(lines[line - 1].trim()), line);
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

  // HTML comments and link reference definitions render invisibly.
  const { bodies, covered } = findHiddenComments(content, lines, lineStarts);
  for (const { text: body, offset } of bodies) {
    if (body.trim().length < 8) continue;
    if (DIRECTIVE_RES.some((d) => d.test(body))) {
      const first = offset + (body.length - body.trimStart().length);
      add("HC-005", revealInvisible(body.trim().replace(/\s+/g, " ")), lineOf(content, first, lineStarts));
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (covered[i] || !/^ {0,3}\[/.test(lines[i])) continue;
    const body = linkDefinitionText(lines, i, covered);
    if (body.trim().length >= 8 && DIRECTIVE_RES.some((d) => d.test(body))) {
      add("HC-005", revealInvisible(body.trim().replace(/\s+/g, " ")), i + 1);
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

  // Base64 on one line, or wrapped across consecutive lines (PEM/MIME style).
  const trimmed = lines.map((l) => l.trim());
  const pure = trimmed.map((t) => t.length > 0 && BASE64_LINE_RE.test(t));
  const addBase64 = (candidates: string[], lineNumber: number): void => {
    for (const blob of candidates) {
      if (blob.length < MIN_BASE64) continue;
      const decoded = decodeBase64Text(blob);
      if (!decoded) continue;
      add("HC-006", `decodes to: "${revealInvisible(decoded)}"`, lineNumber);
      payloads.push({ kind: "base64", lineNumber, text: decoded.slice(0, MAX_PAYLOAD) });
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
          addBase64([m[0]], i + 1);
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
        add("HC-007", revealInvisible(host), i + 1);
      }
    }
  }

  return { findings, payloads };
}
