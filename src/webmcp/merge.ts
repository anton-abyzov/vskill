// ---------------------------------------------------------------------------
// vskill audit-webmcp -- merge the three enumeration sources by tool name.
//
//   capture   our init script wraps document.modelContext.registerTool and
//             records the raw descriptor plus the calling script URL
//   cdp       WebMCP.toolsAdded / toolsRemoved events (annotations arrive as
//             readOnly / untrustedContent)
//   getTools  document.modelContext.getTools() after the page settles
//             (inputSchema arrives as a JSON string)
//
// Chrome 153 drops consequentialHint from both getTools() and CDP, so the
// captured descriptor is the only place it survives. Pure module: no browser.
// ---------------------------------------------------------------------------

import { originOf, parseSchema, siteOf } from "./score.js";
import type { ToolAnnotations, ToolSource, WebmcpTool } from "./types.js";

export interface CapturedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
  exposedTo?: unknown;
  scriptUrl?: string | null;
  unregistered?: boolean;
}

export interface CdpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
  stackTrace?: { callFrames?: Array<{ url?: string }> };
  removed?: boolean;
}

export interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
  origin?: string;
  exposedTo?: unknown;
}

export interface MergeInput {
  pageUrl: string;
  captured: CapturedTool[];
  cdp: CdpTool[];
  /** null when getTools() was unavailable or threw. */
  listed: ListedTool[] | null;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** Map readOnly/readOnlyHint, consequential/consequentialHint, untrustedContent/untrustedContentHint. */
export function normalizeAnnotations(raw: unknown): ToolAnnotations {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: ToolAnnotations = {};
  const readOnly = bool(r.readOnlyHint) ?? bool(r.readOnly);
  const consequential = bool(r.consequentialHint) ?? bool(r.consequential);
  const untrusted = bool(r.untrustedContentHint) ?? bool(r.untrustedContent);
  if (readOnly !== undefined) out.readOnlyHint = readOnly;
  if (consequential !== undefined) out.consequentialHint = consequential;
  if (untrusted !== undefined) out.untrustedContentHint = untrusted;
  return out;
}

function nonEmpty(s: unknown): string | undefined {
  return typeof s === "string" && s.length > 0 ? s : undefined;
}

function stringList(v: unknown): string[] | undefined {
  if (typeof v === "string" && v) return [v];
  if (Array.isArray(v)) {
    const xs = v.filter((x): x is string => typeof x === "string" && x.length > 0);
    return xs.length ? xs : undefined;
  }
  return undefined;
}

/** First http(s) frame in a CDP stack trace. */
export function cdpRegistrar(t: CdpTool): string | undefined {
  for (const f of t.stackTrace?.callFrames ?? []) {
    if (f.url && originOf(f.url)) return f.url;
  }
  return undefined;
}

/** First http(s) URL in a V8 Error().stack that is not our probe script. */
export function scriptUrlFromStack(stack: string | undefined, probeName = "vskill-webmcp-probe"): string | null {
  if (!stack) return null;
  for (const line of stack.split("\n")) {
    if (line.includes(probeName)) continue;
    const m = /(https?:\/\/[^\s)]+?):\d+(?::\d+)?\)?\s*$/.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}

function normalizeSchema(raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const p = parseSchema(raw);
  return p.ok ? p.value : raw;
}

export function mergeTools(input: MergeInput): WebmcpTool[] {
  const pageSite = siteOf(input.pageUrl);

  // Latest event per name wins (a tool can be removed and re-registered).
  const cdpLive = new Map<string, CdpTool>();
  for (const t of input.cdp) {
    if (t.removed) cdpLive.delete(t.name);
    else cdpLive.set(t.name, t);
  }
  const captured = new Map<string, CapturedTool>();
  for (const t of input.captured) {
    if (t.unregistered) captured.delete(t.name);
    else captured.set(t.name, t);
  }
  // Keep the registering script even if the descriptor was later replaced.
  const firstScript = new Map<string, string>();
  for (const t of input.captured) {
    if (t.scriptUrl && !firstScript.has(t.name)) firstScript.set(t.name, t.scriptUrl);
  }
  const listed = new Map<string, ListedTool>();
  for (const t of input.listed ?? []) listed.set(t.name, t);

  const names: string[] = [];
  const add = (n: string) => {
    if (n && !names.includes(n)) names.push(n);
  };
  if (input.listed !== null) {
    for (const n of listed.keys()) add(n);
  } else {
    for (const n of captured.keys()) add(n);
  }
  for (const n of cdpLive.keys()) add(n);

  return names.map((name) => {
    const c = captured.get(name);
    const d = cdpLive.get(name);
    const l = listed.get(name);
    const sources: ToolSource[] = [];
    if (c) sources.push("registerTool");
    if (d) sources.push("cdp");
    if (l) sources.push("getTools");

    const ac = normalizeAnnotations(c?.annotations);
    const al = normalizeAnnotations(l?.annotations);
    const ad = normalizeAnnotations(d?.annotations);
    const annotations: ToolAnnotations = {};
    for (const k of ["readOnlyHint", "consequentialHint", "untrustedContentHint"] as const) {
      const v = ac[k] ?? al[k] ?? ad[k];
      if (v !== undefined) annotations[k] = v;
    }

    const registeredBy = firstScript.get(name) ?? c?.scriptUrl ?? (d ? cdpRegistrar(d) : undefined) ?? undefined;
    const regSite = siteOf(registeredBy);
    const thirdParty = !!(regSite && pageSite && regSite !== pageSite);

    const tool: WebmcpTool = {
      name,
      annotations,
      thirdParty,
      sources,
    };
    const title = nonEmpty(l?.title) ?? nonEmpty(c?.title) ?? nonEmpty(d?.title);
    if (title) tool.title = title;
    const description = nonEmpty(l?.description) ?? nonEmpty(c?.description) ?? nonEmpty(d?.description);
    if (description) tool.description = description;
    const schema = normalizeSchema(l?.inputSchema) ?? normalizeSchema(c?.inputSchema) ?? normalizeSchema(d?.inputSchema);
    if (schema !== undefined) tool.inputSchema = schema;
    if (registeredBy) tool.registeredBy = registeredBy;
    const exposedTo = stringList(c?.exposedTo) ?? stringList(l?.exposedTo);
    if (exposedTo) tool.exposedTo = exposedTo;
    return tool;
  });
}
