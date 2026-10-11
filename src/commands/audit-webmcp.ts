/**
 * vskill audit-webmcp -- audit the WebMCP tools a website registers.
 *
 * Loads each URL once in headless Chromium with the WebMCP feature on,
 * enumerates document.modelContext tools (registerTool capture, CDP WebMCP
 * domain, getTools), and scores them. Never invokes a tool or submits a form.
 *
 * Exit codes: 0 done, 1 a finding at or above --fail-on, 2 bad arguments or
 * no browser available.
 */

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { ArgError, resolveOptions, type AuditWebmcpOptions, type AuditWebmcpRawOptions } from "../webmcp/args.js";
import { enumerateSite, launchBrowser, userAgentFor, type PwBrowser } from "../webmcp/enumerate.js";
import { formatBatchFooter, formatSiteTerminal } from "../webmcp/format.js";
import { atOrAbove, buildReport } from "../webmcp/score.js";
import type { SiteReport } from "../webmcp/types.js";
import { red } from "../utils/output.js";

export interface AuditSitesOptions {
  concurrency: number;
  timeoutMs: number;
  settleMs?: number;
  userAgent?: string;
  /** Called when the browser has crashed or disconnected; returns a fresh one for the remaining sites. */
  relaunch?: () => Promise<PwBrowser>;
}

/** Scan URLs with a bounded pool; per-site failures become reports with `error`. */
export async function auditSites(
  browser: PwBrowser,
  urls: string[],
  opts: AuditSitesOptions,
  onReport?: (r: SiteReport, index: number) => void,
): Promise<SiteReport[]> {
  const reports: SiteReport[] = new Array(urls.length);
  let current = browser;
  let relaunching: Promise<void> | null = null;
  const ensureBrowser = async () => {
    if (current.isConnected() || !opts.relaunch) return;
    relaunching ??= opts
      .relaunch()
      .then((b) => {
        current = b;
      })
      .catch(() => {})
      .finally(() => {
        relaunching = null;
      });
    await relaunching;
  };
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const url = urls[i];
      await ensureBrowser();
      const hardLimit = opts.timeoutMs + (opts.settleMs ?? 5000) + 15_000;
      let timer: NodeJS.Timeout | undefined;
      // On the hard limit, abort: enumerateSite closes its context so a hung page stops using CPU.
      const abort = new AbortController();
      const enumeration = await Promise.race([
        enumerateSite(current, url, {
          timeoutMs: opts.timeoutMs,
          settleMs: opts.settleMs,
          userAgent: opts.userAgent,
          signal: abort.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new Error(`site scan exceeded ${hardLimit}ms`));
          }, hardLimit);
        }),
      ])
        .catch((e: unknown) => ({
          url,
          finalUrl: null,
          documentModelContext: false,
          navigatorModelContext: false,
          permissionsPolicy: null,
          tools: [],
          error: e instanceof Error ? e.message.split("\n")[0] : String(e),
        }))
        .finally(() => clearTimeout(timer));
      const report = buildReport(enumeration);
      reports[i] = report;
      onReport?.(report, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, urls.length)) }, worker));
  return reports;
}

export function shouldFail(reports: SiteReport[], failOn: AuditWebmcpOptions["failOn"]): boolean {
  if (!failOn) return false;
  return reports.some((r) => r.findings.some((f) => atOrAbove(f.severity, failOn)));
}

export async function auditWebmcpCommand(positional: string[], raw: AuditWebmcpRawOptions): Promise<void> {
  let opts: AuditWebmcpOptions;
  try {
    let fileText: string | undefined;
    if (raw.urlsFile) {
      try {
        fileText = readFileSync(raw.urlsFile, "utf8");
      } catch (e) {
        throw new ArgError(`Cannot read --urls-file ${raw.urlsFile}: ${(e as Error).message}`);
      }
    }
    opts = resolveOptions(positional, raw, fileText);
  } catch (e) {
    if (e instanceof ArgError) {
      console.error(red(e.message));
      process.exit(2);
      return;
    }
    throw e;
  }

  // Fail on an unwritable --out before starting a browser.
  if (opts.out) {
    try {
      writeFileSync(opts.out, "");
    } catch (e) {
      console.error(red(`Cannot write --out ${opts.out}: ${(e as Error).message}`));
      process.exit(2);
      return;
    }
  }

  let browser: PwBrowser;
  try {
    browser = await launchBrowser({ executablePath: opts.executablePath });
  } catch (e) {
    const err = e as Error & { code?: string };
    console.error(err.code === "VSKILL_NO_PLAYWRIGHT" ? err.message : red(`Could not launch headless Chromium: ${err.message.split("\n")[0]}`));
    if (err.code !== "VSKILL_NO_PLAYWRIGHT") {
      console.error("Install one with `npx playwright install chromium-headless-shell` or pass --executable-path <path>.");
    }
    process.exit(2);
    return;
  }

  const batch = opts.urls.length > 1;

  let reports: SiteReport[];
  try {
    // Identify the crawler in the UA; fall back to the browser default if that probe fails.
    const userAgent = await userAgentFor(browser).catch(() => undefined);
    const relaunch = async () => {
      await browser.close().catch(() => {});
      browser = await launchBrowser({ executablePath: opts.executablePath });
      return browser;
    };
    const auditOpts = { concurrency: opts.concurrency, timeoutMs: opts.timeoutMs, userAgent, relaunch };
    reports = await auditSites(browser, opts.urls, auditOpts, (r, i) => {
      if (opts.out && opts.outFormat === "jsonl") appendFileSync(opts.out, JSON.stringify(r) + "\n");
      if (opts.json) {
        if (batch) console.log(JSON.stringify(r));
      } else {
        if (batch) process.stderr.write(`[${i + 1}/${opts.urls.length}] ${r.url}\n`);
        console.log(formatSiteTerminal(r) + "\n");
      }
    });
  } finally {
    await browser.close().catch(() => {});
  }

  if (opts.out && opts.outFormat === "json") writeFileSync(opts.out, JSON.stringify(reports[0], null, 2) + "\n");
  if (opts.json && !batch) console.log(JSON.stringify(reports[0], null, 2));
  if (!opts.json && batch) console.log(formatBatchFooter(reports));

  // process.exit can drop buffered stdout when it is a pipe (`| jq`): flush first.
  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
  process.exit(shouldFail(reports, opts.failOn) ? 1 : 0);
}
