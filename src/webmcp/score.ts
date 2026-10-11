// ---------------------------------------------------------------------------
// vskill audit-webmcp -- scoring. Pure functions: no browser, no network.
//
// Rules
//   WMCP-001  prompt-injection / tool-poisoning text in name, title,
//             description or parameter descriptions (scanContent + WebMCP
//             specific patterns)
//   WMCP-002  write-shaped tool without consequentialHint
//   WMCP-003  write-shaped tool marked readOnlyHint:true
//   WMCP-004  PII-shaped parameters the tool's purpose does not need
//   WMCP-005  tool registered by a script from another origin
//   WMCP-006  description over 500 chars, or more than 40 tools on the page
//   WMCP-007  inputSchema missing or not a JSON Schema object
//   WMCP-008  tools registered but no Permissions-Policy mentioning tools
//   WMCP-009  tool exposed to other origins via exposedTo
// ---------------------------------------------------------------------------

import { scanContent, type ScanVerdict } from "../scanner/patterns.js";
import {
  SEVERITIES,
  type EnumerationResult,
  type Severity,
  type SiteReport,
  type SiteSummary,
  type WebmcpFinding,
  type WebmcpTool,
} from "./types.js";

export const MAX_DESCRIPTION_CHARS = 500;
export const MAX_TOOLS_PER_PAGE = 40;

// ---- Helpers ---------------------------------------------------------------

/** Split a tool name into lowercase words: "proceedToCheckout" -> [proceed, to, checkout]. */
export function tokenizeName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s);
}

/** True when `s` is at or above `threshold` (critical is highest). */
export function atOrAbove(s: Severity, threshold: Severity): boolean {
  return severityRank(s) <= severityRank(threshold);
}

function capSeverity(s: Severity, cap: Severity): Severity {
  return severityRank(s) < severityRank(cap) ? cap : s;
}

export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Parse a schema that may arrive as a JSON string (Chrome's getTools does this). */
export function parseSchema(raw: unknown): { ok: boolean; value: unknown } {
  if (raw === undefined || raw === null || raw === "") return { ok: false, value: undefined };
  if (typeof raw === "string") {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false, value: raw };
    }
  }
  return { ok: true, value: raw };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface SchemaParam {
  path: string;
  key: string;
  description?: string;
}

/** Walk object properties (nested objects and array items) of a JSON Schema. */
export function schemaParams(schema: unknown, prefix = "", depth = 0): SchemaParam[] {
  if (!isPlainObject(schema) || depth > 6) return [];
  const out: SchemaParam[] = [];
  const props = schema.properties;
  if (isPlainObject(props)) {
    for (const [key, sub] of Object.entries(props)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const desc = isPlainObject(sub) && typeof sub.description === "string" ? sub.description : undefined;
      out.push({ path, key, description: desc });
      out.push(...schemaParams(sub, path, depth + 1));
    }
  }
  if (isPlainObject(schema.items)) {
    out.push(...schemaParams(schema.items, prefix ? `${prefix}[]` : "[]", depth + 1));
  }
  return out;
}

// ---- WMCP-002/003: write shape ---------------------------------------------

export type WriteTier = "high" | "medium" | "low";

export interface WriteShape {
  tier: WriteTier;
  reason: string;
}

const READ_VERBS = new Set([
  "get", "list", "search", "find", "view", "show", "lookup", "look", "check", "read",
  "fetch", "query", "browse", "describe", "preview", "estimate", "calculate", "compare",
  "track", "retrieve", "count", "explore", "filter", "sort", "recommend", "suggest",
  "validate", "verify", "inspect", "summarize", "explain", "is", "has", "can",
]);

const HIGH_WORDS = new Set([
  "checkout", "pay", "payment", "purchase", "buy", "order", "delete", "destroy",
  "erase", "transfer", "withdraw", "charge", "donate",
]);

const MEDIUM_WORDS = new Set([
  "remove", "cancel", "submit", "book", "reserve", "rsvp", "register", "signup",
  "subscribe", "unsubscribe", "send", "post", "publish", "enroll",
]);

const CART_NOUNS = new Set(["cart", "bag", "basket"]);
const CART_VERBS = new Set(["add", "update", "remove", "set", "empty", "clear", "modify", "change", "edit", "cancel"]);
/** "order" used as a noun in a name like order_status is a read. */
const ORDER_NOUN_CONTEXT = new Set(["status", "history", "details", "detail", "tracking", "info", "summary"]);

const DESCRIPTION_WRITE_PATTERNS: Array<{ tier: WriteTier; re: RegExp }> = [
  { tier: "high", re: /\b(?:place|submit|complete|finali[sz]e|confirm)s?\s+(?:an?\s+|the\s+|your\s+|their\s+)?(?:order|purchase|payment|checkout)\b/i },
  { tier: "high", re: /\b(?:proceed|go|continue)s?\s+to\s+(?:the\s+)?checkout\b/i },
  { tier: "high", re: /\bmakes?\s+(?:a\s+)?payments?\b/i },
  { tier: "high", re: /\b(?:purchase|buy)s?\s+(?:an?|the|this|these|your)\b/i },
  { tier: "high", re: /\bpermanently\s+(?:delete|remove)s?\b|\bdeletes?\s+(?:an?|the|this|your|all)\b/i },
  { tier: "high", re: /\btransfers?\s+(?:funds|money)\b/i },
  { tier: "high", re: /\bcharges?\s+(?:the\s+)?(?:card|customer|user)\b/i },
  { tier: "low", re: /\badds?\s+(?:an?\s+|the\s+)?(?:\w+\s+){0,2}to\s+(?:the\s+|your\s+|a\s+)?(?:cart|bag|basket)\b/i },
  { tier: "low", re: /\b(?:updates?|modif(?:y|ies)|changes?|empt(?:y|ies)|clears?)\s+(?:the\s+|your\s+)?(?:shopping\s+)?(?:cart|bag|basket)\b/i },
  { tier: "medium", re: /\bcancels?\s+(?:an?|the|this|your)\b/i },
  { tier: "medium", re: /\bsends?\s+(?:an?\s+|the\s+)?(?:email|message|sms|text|invite|invitation)\b/i },
  { tier: "medium", re: /\b(?:subscribes?|signs?\s+up|registers?)\s+(?:the\s+user\s+)?(?:to|for)\b/i },
  { tier: "medium", re: /\b(?:books?|reserves?)\s+(?:an?|the)\s+\w+/i },
  { tier: "medium", re: /\bpublish(?:es)?\s+(?:an?|the|this|your)\b/i },
  { tier: "medium", re: /\bsubmits?\s+(?:an?|the|this|your)\b/i },
  { tier: "medium", re: /\brsvps?\b/i },
  { tier: "medium", re: /\bposts?\s+(?:an?\s+)?(?:comment|review|message|reply)\b/i },
  { tier: "medium", re: /\bremoves?\s+(?:an?|the|this)\b/i },
];

/** Does the tool look like it changes state (buys, deletes, sends, books ...)? */
export function classifyWriteShape(tool: Pick<WebmcpTool, "name" | "description">): WriteShape | null {
  const tokens = tokenizeName(tool.name);
  if (tokens.length === 0) return null;
  if (READ_VERBS.has(tokens[0])) return null;

  const joined = tokens.join("_");
  const words = new Set(tokens);
  if (joined.includes("sign_up")) words.add("signup");
  if (joined.includes("add_to_cart") || joined.includes("add_to_bag")) words.add("add");

  for (const t of tokens) {
    if (!HIGH_WORDS.has(t)) continue;
    if (t === "order" && tokens.some((x) => ORDER_NOUN_CONTEXT.has(x))) continue;
    return { tier: "high", reason: t };
  }
  const hasCartNoun = tokens.some((t) => CART_NOUNS.has(t));
  const cartVerb = tokens.find((t) => CART_VERBS.has(t));
  if (hasCartNoun && cartVerb) return { tier: "low", reason: `${cartVerb} cart` };
  for (const t of words) {
    if (MEDIUM_WORDS.has(t)) return { tier: "medium", reason: t };
  }

  const desc = tool.description ?? "";
  for (const { tier, re } of DESCRIPTION_WRITE_PATTERNS) {
    const m = re.exec(desc);
    if (m) return { tier, reason: `description: "${m[0]}"` };
  }
  return null;
}

// ---- WMCP-001: poisoning text ----------------------------------------------

interface PoisonPattern {
  id: string;
  name: string;
  severity: Severity;
  re: RegExp;
}

/** WebMCP-specific tool-poisoning shapes not covered by scanContent. */
export const POISON_PATTERNS: PoisonPattern[] = [
  { id: "WP-01", name: "hidden instruction tag", severity: "high", re: /<\s*\/?\s*(?:important|system|instructions?|secret|hidden)\s*>/i },
  { id: "WP-02", name: "conceals actions from the user", severity: "high", re: /\b(?:do\s+not|don['’]?t|never)\s+(?:tell|inform|mention|reveal|show|notify|disclose)\s+(?:this\s+)?(?:to\s+)?(?:the\s+)?user\b/i },
  { id: "WP-03", name: "overrides prior instructions", severity: "high", re: /\b(?:disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|earlier|other|your)\s+(?:instructions|rules|guidelines|tools)\b/i },
  { id: "WP-04", name: "tool shadowing", severity: "medium", re: /\b(?:instead\s+of|rather\s+than)\s+(?:using\s+)?(?:any\s+)?other\s+tools?\b|\balways\s+(?:call|use|invoke|run)\s+this\s+tool\s+(?:first|before)\b/i },
  { id: "WP-05", name: "invisible or bidi characters", severity: "high", re: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]|[\u{E0000}-\u{E007F}]/u },
  { id: "WP-07", name: "tells the agent to skip user confirmation", severity: "medium", re: /\b(?:do\s+not|don['\u2019]?t|never|no\s+need\s+to)\s+(?:ask|prompt|check\s+with)\s+(?:the\s+user\s+)?(?:to\s+|for\s+)?confirm(?:ation)?\b|\bwithout\s+(?:asking|confirming\s+with|checking\s+with)\s+(?:the\s+)?user\b/i },
  { id: "WP-06", name: "asks for conversation or secrets", severity: "high", re: /\b(?:include|send|pass|append|attach)\s+(?:the\s+)?(?:user['’]?s?\s+)?(?:full\s+)?(?:conversation|chat\s+history|previous\s+messages|system\s+prompt|cookies?|session\s+tokens?|api\s+keys?|passwords?)\b/i },
];

interface TextField {
  field: string;
  text: string;
}

function toolTextFields(tool: WebmcpTool): TextField[] {
  const fields: TextField[] = [{ field: "name", text: tool.name }];
  if (tool.title) fields.push({ field: "title", text: tool.title });
  if (tool.description) fields.push({ field: "description", text: tool.description });
  const parsed = parseSchema(tool.inputSchema);
  if (parsed.ok) {
    for (const p of schemaParams(parsed.value)) {
      if (p.description) fields.push({ field: `param ${p.path}`, text: p.description });
    }
  }
  return fields;
}

function poisoningFindings(tool: WebmcpTool): WebmcpFinding[] {
  const out: WebmcpFinding[] = [];
  const seen = new Set<string>();
  for (const { field, text } of toolTextFields(tool)) {
    for (const f of scanContent(text)) {
      const key = `${f.patternId}|${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Code-shaped patterns are rarely meaningful in prose; keep prompt
      // injection and credential theft at full strength, cap the rest.
      const severity =
        f.category === "prompt-injection" || f.category === "credential-theft"
          ? f.severity
          : capSeverity(f.severity, "medium");
      out.push({
        id: "WMCP-001",
        severity,
        tool: tool.name,
        message: `${field}: ${f.patternName} (${f.patternId}) matched "${truncate(f.match, 60)}"`,
      });
    }
    for (const p of POISON_PATTERNS) {
      const m = p.re.exec(text);
      if (!m) continue;
      const key = `${p.id}|${field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: "WMCP-001",
        severity: p.severity,
        tool: tool.name,
        message: `${field}: ${p.name} (${p.id}) matched "${truncate(visible(m[0]), 60)}"`,
      });
    }
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function visible(s: string): string {
  return s.replace(/[^\x20-\x7E]/gu, (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
}

// ---- WMCP-004: PII parameters ----------------------------------------------

interface PiiKind {
  kind: string;
  severity: Severity;
  key: RegExp;
  /** Words in name/description that make the parameter expected. */
  purpose: RegExp;
}

const PII_KINDS: PiiKind[] = [
  { kind: "email", severity: "info", key: /e-?mail/i, purpose: /e-?mail|newsletter|subscri|sign\s*up|signup|register|contact|account|login|notify|invite|receipt|checkout|order|share|send|booking|book|reserv|rsvp|ticket/i },
  { kind: "phone", severity: "info", key: /phone|mobile|msisdn|^tel$/i, purpose: /phone|sms|text|call|contact|whatsapp|book|reserv|deliver|ship|checkout|order|verify|appointment/i },
  { kind: "address", severity: "info", key: /address|street|postal|zip_?code|postcode/i, purpose: /address|ship|deliver|checkout|order|store|locat|near|map|direction|tax|shipping|quote|rate/i },
  { kind: "date of birth", severity: "low", key: /\bdob\b|^dob|birth/i, purpose: /birth|age|dob|insur|ticket|regist|account|verif|kyc|passport|visa|travel/i },
  { kind: "government id", severity: "low", key: /\bssn\b|^ssn|social_?security|passport|national_?id|tax_?id|driver'?s?_?licen/i, purpose: /ssn|passport|identity|kyc|verif|visa|travel|tax|licen/i },
  { kind: "payment card or bank", severity: "low", key: /card_?number|\bcard\b|^card|cvv|cvc|\biban\b|^iban|account_?number|routing/i, purpose: /pay|card|bank|checkout|billing|purchase|donat|wallet|refund|iban/i },
];

function piiFindings(tool: WebmcpTool): WebmcpFinding[] {
  const parsed = parseSchema(tool.inputSchema);
  if (!parsed.ok) return [];
  const purposeText = `${tool.name} ${tool.title ?? ""} ${tool.description ?? ""}`.replace(/_/g, " ");
  const out: WebmcpFinding[] = [];
  const reported = new Set<string>();
  for (const p of schemaParams(parsed.value)) {
    for (const k of PII_KINDS) {
      if (!k.key.test(p.key)) continue;
      // "giftcard_message" is not a card number: require the key to look like a field name for the kind.
      if (k.kind === "payment card or bank" && /gift|discount|business|card_?type|card_?style|rate_?card/i.test(p.key)) continue;
      if (k.kind === "address" && /e-?mail|ip_?address|wallet/i.test(p.key)) continue;
      if (k.purpose.test(purposeText)) continue;
      if (reported.has(k.kind)) continue;
      reported.add(k.kind);
      out.push({
        id: "WMCP-004",
        severity: k.severity,
        tool: tool.name,
        message: `asks for ${k.kind} (parameter "${p.path}") although its name and description do not need it`,
      });
    }
  }
  return out;
}

// ---- Per-tool and per-page rules -------------------------------------------

export function scoreTool(tool: WebmcpTool): WebmcpFinding[] {
  const findings: WebmcpFinding[] = [];
  findings.push(...poisoningFindings(tool));

  const shape = classifyWriteShape(tool);
  if (shape) {
    if (tool.annotations.readOnlyHint === true) {
      findings.push({
        id: "WMCP-003",
        severity: "high",
        tool: tool.name,
        message: `looks like a write action (${shape.reason}) but is marked readOnlyHint: true`,
      });
    } else if (tool.annotations.consequentialHint !== true) {
      findings.push({
        id: "WMCP-002",
        severity: shape.tier,
        tool: tool.name,
        message: `looks like a write action (${shape.reason}) but has no consequentialHint, so agents may run it without asking`,
      });
    }
  }

  findings.push(...piiFindings(tool));

  if (tool.thirdParty) {
    findings.push({
      id: "WMCP-005",
      severity: "medium",
      tool: tool.name,
      message: `registered by a third-party script (${tool.registeredBy})`,
    });
  }

  if ((tool.description ?? "").length > MAX_DESCRIPTION_CHARS) {
    findings.push({
      id: "WMCP-006",
      severity: "low",
      tool: tool.name,
      message: `description is ${tool.description!.length} chars (guidance: ${MAX_DESCRIPTION_CHARS} or fewer)`,
    });
  }

  const schema = parseSchema(tool.inputSchema);
  if (tool.inputSchema === undefined || tool.inputSchema === null || tool.inputSchema === "") {
    findings.push({ id: "WMCP-007", severity: "low", tool: tool.name, message: "has no inputSchema" });
  } else if (!schema.ok) {
    findings.push({ id: "WMCP-007", severity: "medium", tool: tool.name, message: "inputSchema is not valid JSON" });
  } else if (!isPlainObject(schema.value)) {
    findings.push({ id: "WMCP-007", severity: "medium", tool: tool.name, message: "inputSchema is not a JSON Schema object" });
  } else if (schema.value.type !== undefined && schema.value.type !== "object") {
    findings.push({
      id: "WMCP-007",
      severity: "low",
      tool: tool.name,
      message: `inputSchema has type "${String(schema.value.type)}"; tool inputs should be type "object"`,
    });
  }

  if (tool.exposedTo && tool.exposedTo.length > 0) {
    findings.push({
      id: "WMCP-009",
      severity: "info",
      tool: tool.name,
      message: `exposed to other origins: ${tool.exposedTo.join(", ")}`,
    });
  }

  return findings;
}

export function scorePage(input: Pick<EnumerationResult, "tools" | "permissionsPolicy">): WebmcpFinding[] {
  const findings: WebmcpFinding[] = [];
  for (const tool of input.tools) findings.push(...scoreTool(tool));

  if (input.tools.length > MAX_TOOLS_PER_PAGE) {
    findings.push({
      id: "WMCP-006",
      severity: "medium",
      tool: null,
      message: `page registers ${input.tools.length} tools (guidance: ${MAX_TOOLS_PER_PAGE} or fewer)`,
    });
  }

  if (input.tools.length > 0 && !/tool|model-?context|webmcp/i.test(input.permissionsPolicy ?? "")) {
    findings.push({
      id: "WMCP-008",
      severity: "info",
      tool: null,
      message: input.permissionsPolicy
        ? "Permissions-Policy does not mention tools; embedded frames inherit the default"
        : "no Permissions-Policy header; embedded frames inherit the default tool policy",
    });
  }

  return findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

// ---- Summary and verdict ---------------------------------------------------

/** Same weights as the Tier 1 skill scanner (src/scanner/tier1.ts). */
const SEVERITY_DEDUCTIONS: Record<Severity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 0,
};

/**
 * Score starts at 100. Each rule deducts per finding, capped at twice the
 * weight of its worst finding, so a site with 30 similar tools is not
 * punished 30 times for one design choice. Thresholds match Tier 1
 * (>= 80 PASS, 50-79 CONCERNS, < 50 FAIL), with two floors: any critical
 * finding is FAIL, and any high finding is at least CONCERNS.
 */
export function computeVerdict(findings: WebmcpFinding[]): { score: number; verdict: ScanVerdict } {
  const byRule = new Map<string, { total: number; worst: number }>();
  for (const f of findings) {
    const w = SEVERITY_DEDUCTIONS[f.severity];
    const cur = byRule.get(f.id) ?? { total: 0, worst: 0 };
    cur.total += w;
    cur.worst = Math.max(cur.worst, w);
    byRule.set(f.id, cur);
  }
  let score = 100;
  for (const { total, worst } of byRule.values()) score -= Math.min(total, worst * 2);
  score = Math.max(0, Math.min(100, score));

  let verdict: ScanVerdict = score >= 80 ? "PASS" : score >= 50 ? "CONCERNS" : "FAIL";
  if (findings.some((f) => f.severity === "critical")) verdict = "FAIL";
  else if (verdict === "PASS" && findings.some((f) => f.severity === "high")) verdict = "CONCERNS";
  return { score, verdict };
}

export function summarize(tools: WebmcpTool[], findings: WebmcpFinding[]): SiteSummary {
  const findingsBySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  for (const f of findings) findingsBySeverity[f.severity]++;
  const { score, verdict } = computeVerdict(findings);
  return {
    toolCount: tools.length,
    readOnlyCount: tools.filter((t) => t.annotations.readOnlyHint === true).length,
    consequentialCount: tools.filter((t) => t.annotations.consequentialHint === true).length,
    writeShapedCount: tools.filter((t) => classifyWriteShape(t) !== null).length,
    thirdPartyCount: tools.filter((t) => t.thirdParty).length,
    findingsBySeverity,
    score,
    verdict,
  };
}

/** Turn an enumeration into the schemaVersion 1 report. */
export function buildReport(e: EnumerationResult, scannedAt: Date = new Date()): SiteReport {
  const findings = scorePage(e);
  const report: SiteReport = {
    schemaVersion: 1,
    url: e.url,
    finalUrl: e.finalUrl,
    scannedAt: scannedAt.toISOString(),
    webmcp: {
      documentModelContext: e.documentModelContext,
      navigatorModelContext: e.navigatorModelContext,
    },
    headers: { permissionsPolicy: e.permissionsPolicy },
    tools: e.tools,
    findings,
    summary: summarize(e.tools, findings),
  };
  if (e.error) report.error = e.error;
  return report;
}

/** Highest severity in a report, or null when there are no findings. */
export function worstSeverity(findings: WebmcpFinding[]): Severity | null {
  let worst: Severity | null = null;
  for (const f of findings) {
    if (worst === null || severityRank(f.severity) < severityRank(worst)) worst = f.severity;
  }
  return worst;
}
