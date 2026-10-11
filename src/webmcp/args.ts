// ---------------------------------------------------------------------------
// vskill audit-webmcp -- argument parsing (pure, unit-tested).
// ---------------------------------------------------------------------------

import { SEVERITIES, type Severity } from "./types.js";

export interface AuditWebmcpRawOptions {
  urlsFile?: string;
  json?: boolean;
  out?: string;
  concurrency?: string | number;
  timeout?: string | number;
  failOn?: string;
  executablePath?: string;
}

export interface AuditWebmcpOptions {
  urls: string[];
  json: boolean;
  out?: string;
  /** "jsonl" when the run covers more than one URL or --out ends in .jsonl. */
  outFormat: "json" | "jsonl";
  concurrency: number;
  timeoutMs: number;
  failOn?: Severity;
  executablePath?: string;
}

export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_TIMEOUT_MS = 30_000;

export class ArgError extends Error {}

/** One URL per line; blank lines and # comments (whole-line or trailing " #") are ignored. */
export function parseUrlList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const hash = line.search(/\s#/);
    if (hash !== -1) line = line.slice(0, hash).trim();
    if (line) out.push(line);
  }
  return out;
}

/** Accept "example.com" as https://example.com/; reject anything that is not http(s). */
export function normalizeUrl(input: string): string {
  const s = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new ArgError(`Invalid URL: ${input}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ArgError(`Only http(s) URLs can be audited: ${input}`);
  }
  if (!u.hostname) throw new ArgError(`Invalid URL: ${input}`);
  return u.toString();
}

function positiveInt(name: string, v: string | number | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ArgError(`Invalid ${name} value: ${v}. Must be a positive integer.`);
  return n;
}

/**
 * Combine positional URLs and --urls-file contents (already read) into
 * validated options. Throws ArgError with a user-facing message.
 */
export function resolveOptions(
  positional: string[],
  raw: AuditWebmcpRawOptions,
  urlsFileText?: string,
): AuditWebmcpOptions {
  const inputs = [...positional, ...(urlsFileText !== undefined ? parseUrlList(urlsFileText) : [])];
  const urls: string[] = [];
  for (const i of inputs) {
    const u = normalizeUrl(i);
    if (!urls.includes(u)) urls.push(u);
  }
  if (urls.length === 0) {
    throw new ArgError("No URLs to audit. Pass URLs as arguments or use --urls-file <path>.");
  }

  let failOn: Severity | undefined;
  if (raw.failOn !== undefined) {
    const s = raw.failOn.toLowerCase() as Severity;
    if (!SEVERITIES.includes(s)) {
      throw new ArgError(`Invalid --fail-on severity: ${raw.failOn}. Valid: ${SEVERITIES.join(", ")}`);
    }
    failOn = s;
  }

  const concurrency = positiveInt("--concurrency", raw.concurrency, DEFAULT_CONCURRENCY);
  const timeoutMs = positiveInt("--timeout", raw.timeout, DEFAULT_TIMEOUT_MS);
  const outFormat = urls.length > 1 || /\.jsonl$/i.test(raw.out ?? "") ? "jsonl" : "json";

  return {
    urls,
    json: !!raw.json,
    out: raw.out,
    outFormat,
    concurrency: Math.min(concurrency, urls.length),
    timeoutMs,
    failOn,
    executablePath: raw.executablePath,
  };
}
