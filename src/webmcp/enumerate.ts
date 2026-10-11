// ---------------------------------------------------------------------------
// vskill audit-webmcp -- headless Chromium enumeration of WebMCP tools.
//
// Playwright is an optional peer: we import 'playwright-core' or 'playwright'
// at runtime and never add it as a dependency. Each URL loads once in its own
// browser context. We read tool descriptors only: no tool is invoked or
// executed, no form is submitted, downloads are refused and dialogs dismissed.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mergeTools, scriptUrlFromStack, type CapturedTool, type CdpTool, type ListedTool } from "./merge.js";
import type { EnumerationResult } from "./types.js";

/** Playwright always passes CDPScreenshotNewSurface; a second --enable-features would override it. */
export const CHROMIUM_ARGS = ["--enable-features=CDPScreenshotNewSurface,WebMCP"];
export const UA_SUFFIX = "vskill-audit-webmcp (+https://verified-skill.com)";
export const PROBE_NAME = "vskill-webmcp-probe";

// ---- Minimal structural types (playwright is not a compile-time dependency) ----

interface PwResponse {
  headers(): Record<string, string>;
}
interface PwCdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: any) => void): void;
  detach(): Promise<void>;
}
interface PwPage {
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<PwResponse | null>;
  url(): string;
  evaluate<T>(fn: (...args: any[]) => T | Promise<T>, arg?: unknown): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
  on(event: string, handler: (arg: any) => void): void;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  newCDPSession(page: PwPage): Promise<PwCdpSession>;
  addInitScript(script: { content: string }): Promise<void>;
  close(): Promise<void>;
}
export interface PwBrowser {
  newContext(opts?: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
  version(): string;
}
interface PwChromium {
  launch(opts: Record<string, unknown>): Promise<PwBrowser>;
  executablePath(): string;
}

/**
 * Import playwright-core, then playwright: first from vskill's own install,
 * then from the current project (so `npm i -D playwright-core` works with npx).
 * Returns null when neither resolves.
 */
export async function loadChromium(cwd: string = process.cwd()): Promise<PwChromium | null> {
  const projectRequire = createRequire(join(cwd, "noop.js"));
  for (const specifier of ["playwright-core", "playwright"]) {
    const attempts: Array<() => Promise<any>> = [
      () => import(specifier),
      () => import(pathToFileURL(projectRequire.resolve(specifier)).href),
    ];
    for (const attempt of attempts) {
      try {
        const mod: any = await attempt();
        const chromium = mod.chromium ?? mod.default?.chromium;
        if (chromium) return chromium as PwChromium;
      } catch {
        // try the next one
      }
    }
  }
  return null;
}

export const PLAYWRIGHT_INSTALL_HINT = [
  "audit-webmcp needs Playwright and a Chromium build. Install them with:",
  "  npm i -D playwright-core        (in the project you run vskill from; or npm i -g alongside a global vskill)",
  "  npx playwright install chromium-headless-shell",
  "Or point at an existing build with --executable-path <path> or VSKILL_CHROMIUM=<path>.",
].join("\n");

// ---- Finding a Chromium build ----------------------------------------------

function browserCacheDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== "0") {
    dirs.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  }
  const home = homedir();
  dirs.push(join(home, "Library", "Caches", "ms-playwright"));
  dirs.push(join(home, ".cache", "ms-playwright"));
  if (process.env.LOCALAPPDATA) dirs.push(join(process.env.LOCALAPPDATA, "ms-playwright"));
  dirs.push("/opt/pw-browsers");
  return dirs;
}

const BINARY_CANDIDATES: Array<{ prefix: string; paths: string[][] }> = [
  {
    prefix: "chromium_headless_shell-",
    paths: [
      ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
      ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
      ["chrome-headless-shell-linux64", "chrome-headless-shell"],
      ["chrome-headless-shell-linux-arm64", "chrome-headless-shell"],
      ["chrome-linux", "headless_shell"],
      ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
    ],
  },
  {
    prefix: "chromium-",
    paths: [
      ["chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"],
      ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
      ["chrome-linux64", "chrome"],
      ["chrome-linux", "chrome"],
      ["chrome-win64", "chrome.exe"],
      ["chrome-win", "chrome.exe"],
    ],
  },
];

/** Newest Chromium (headless shell preferred) in the usual Playwright cache dirs. */
export function findCachedChromium(dirs: string[] = browserCacheDirs()): string | null {
  for (const { prefix, paths } of BINARY_CANDIDATES) {
    const found: Array<{ rev: number; path: string }> = [];
    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.startsWith(prefix)) continue;
        const rev = parseInt(e.slice(prefix.length), 10);
        if (Number.isNaN(rev)) continue;
        for (const segs of paths) {
          const p = join(dir, e, ...segs);
          if (existsSync(p)) found.push({ rev, path: p });
        }
      }
    }
    found.sort((a, b) => b.rev - a.rev);
    if (found.length) return found[0].path;
  }
  return null;
}

/**
 * Resolve the executable: explicit flag, then VSKILL_CHROMIUM, then
 * Playwright's own pinned build, then the newest cached build.
 * Returns undefined when Playwright's default should be used.
 */
export function resolveExecutablePath(chromium: PwChromium, explicit?: string): string | undefined {
  if (explicit) return explicit;
  if (process.env.VSKILL_CHROMIUM) return process.env.VSKILL_CHROMIUM;
  try {
    const def = chromium.executablePath();
    if (def && existsSync(def)) return undefined;
  } catch {
    // fall through
  }
  return findCachedChromium() ?? undefined;
}

export async function launchBrowser(opts: { executablePath?: string } = {}): Promise<PwBrowser> {
  const chromium = await loadChromium();
  if (!chromium) {
    const err = new Error(PLAYWRIGHT_INSTALL_HINT);
    (err as Error & { code?: string }).code = "VSKILL_NO_PLAYWRIGHT";
    throw err;
  }
  const executablePath = resolveExecutablePath(chromium, opts.executablePath);
  return chromium.launch({
    headless: true,
    args: CHROMIUM_ARGS,
    ...(executablePath ? { executablePath } : {}),
  });
}

// ---- In-page probe ---------------------------------------------------------

/**
 * Runs before any page script in every frame. Wraps registerTool to record
 * the descriptor (minus execute) and the caller's stack. The page's own
 * registerTool still runs unchanged.
 */
export const INIT_SCRIPT = `(() => {
  const KEY = Symbol.for("vskill.webmcp");
  if (window[KEY]) return;
  const log = [];
  try { Object.defineProperty(window, KEY, { value: log, enumerable: false }); } catch (e) { return; }
  let proto = null;
  try {
    proto = (typeof ModelContext !== "undefined" && ModelContext.prototype) ||
      (document.modelContext && Object.getPrototypeOf(document.modelContext));
  } catch (e) {}
  if (!proto || typeof proto.registerTool !== "function") return;
  const safe = (v) => { try { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); } catch (e) { return undefined; } };
  const str = (v) => (typeof v === "string" ? v : undefined);
  const orig = proto.registerTool;
  const wrapped = function registerTool(tool, options) {
    try {
      const t = tool || {};
      const rec = {
        name: String(t.name == null ? "" : t.name),
        title: str(t.title),
        description: str(t.description),
        inputSchema: typeof t.inputSchema === "string" ? t.inputSchema : safe(t.inputSchema),
        annotations: safe(t.annotations),
        exposedTo: safe((options && options.exposedTo) !== undefined ? options.exposedTo : t.exposedTo),
        stack: String(new Error().stack || ""),
      };
      log.push(rec);
      const signal = options && options.signal;
      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", () => log.push({ name: rec.name, unregistered: true }), { once: true });
      }
    } catch (e) {}
    return orig.apply(this, arguments);
  };
  try { Object.defineProperty(proto, "registerTool", { value: wrapped, writable: true, configurable: true }); } catch (e) {}
  if (typeof proto.unregisterTool === "function") {
    const origUn = proto.unregisterTool;
    try {
      Object.defineProperty(proto, "unregisterTool", {
        value: function unregisterTool(name) {
          try { log.push({ name: String(name), unregistered: true }); } catch (e) {}
          return origUn.apply(this, arguments);
        },
        writable: true,
        configurable: true,
      });
    } catch (e) {}
  }
})();
//# sourceURL=${PROBE_NAME}.js`;

interface PageSnapshot {
  documentModelContext: boolean;
  navigatorModelContext: boolean;
  captured: Array<CapturedTool & { stack?: string }>;
  listed: ListedTool[] | null;
  getToolsError?: string;
}

/** Evaluated in the page after it settles. Reads, never executes. */
function snapshotInPage(): Promise<PageSnapshot> {
  const w = window as any;
  const d = document as any;
  const mc = d.modelContext;
  const out: PageSnapshot = {
    documentModelContext: !!mc,
    navigatorModelContext: "modelContext" in navigator,
    captured: [],
    listed: null,
  };
  const log = w[Symbol.for("vskill.webmcp")];
  if (Array.isArray(log)) out.captured = log.slice();
  if (!mc || typeof mc.getTools !== "function") return Promise.resolve(out);
  const clone = (v: unknown) => {
    try {
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    } catch {
      return undefined;
    }
  };
  return Promise.race([
    Promise.resolve(mc.getTools()),
    new Promise((_, reject) => setTimeout(() => reject(new Error("getTools() timed out")), 3000)),
  ])
    .then((tools: any) => {
      out.listed = Array.from(tools || []).map((t: any) => ({
        name: String(t.name),
        title: typeof t.title === "string" ? t.title : undefined,
        description: typeof t.description === "string" ? t.description : undefined,
        inputSchema: typeof t.inputSchema === "string" ? t.inputSchema : clone(t.inputSchema),
        annotations: clone(t.annotations),
        origin: typeof t.origin === "string" ? t.origin : undefined,
        exposedTo: clone(t.exposedTo),
      }));
      return out;
    })
    .catch((e: unknown) => {
      out.getToolsError = String(e);
      return out;
    });
}

// ---- Per-site enumeration --------------------------------------------------

export interface EnumerateOptions {
  timeoutMs: number;
  /** Max wait after load for registrations to stop (default 5000). */
  settleMs?: number;
  /** Quiet period that ends the settle wait early (default 1500). */
  quietMs?: number;
  userAgent?: string;
}

function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n")[0].replace(/^page\.goto:\s*/, "").trim();
}

function cdpToolList(params: any): any[] {
  if (Array.isArray(params?.tools)) return params.tools;
  if (params?.tool) return [params.tool];
  if (params?.name) return [params];
  return [];
}

/** Browser UA with our suffix, read once per browser. */
export async function userAgentFor(browser: PwBrowser): Promise<string> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const ua = await page.evaluate(() => navigator.userAgent);
    return `${ua} ${UA_SUFFIX}`;
  } finally {
    await ctx.close();
  }
}

export async function enumerateSite(browser: PwBrowser, url: string, opts: EnumerateOptions): Promise<EnumerationResult> {
  const settleMs = opts.settleMs ?? 5000;
  const quietMs = opts.quietMs ?? 1500;
  const result: EnumerationResult = {
    url,
    finalUrl: null,
    documentModelContext: false,
    navigatorModelContext: false,
    permissionsPolicy: null,
    tools: [],
  };

  const ctx = await browser.newContext({
    acceptDownloads: false,
    javaScriptEnabled: true,
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
  });
  try {
    await ctx.addInitScript({ content: INIT_SCRIPT });
    const page = await ctx.newPage();
    page.on("dialog", (d: { dismiss(): Promise<void> }) => {
      d.dismiss().catch(() => {});
    });

    const cdpEvents: CdpTool[] = [];
    try {
      const cdp = await ctx.newCDPSession(page);
      cdp.on("WebMCP.toolsAdded", (p) => {
        for (const t of cdpToolList(p)) if (t?.name) cdpEvents.push({ ...t, name: String(t.name) });
      });
      cdp.on("WebMCP.toolsRemoved", (p) => {
        const names: unknown[] = Array.isArray(p?.names) ? p.names : cdpToolList(p).map((t) => t?.name ?? t);
        for (const n of names) if (typeof n === "string") cdpEvents.push({ name: n, removed: true });
      });
      await cdp.send("WebMCP.enable");
    } catch {
      // Older Chromium without the WebMCP domain: rely on the other sources.
    }

    try {
      const response = await page.goto(url, { waitUntil: "load", timeout: opts.timeoutMs });
      const headers = response?.headers() ?? {};
      result.permissionsPolicy = headers["permissions-policy"] ?? null;
    } catch (e) {
      const msg = firstLine(e);
      if (!/timeout/i.test(msg) || page.url() === "about:blank") {
        result.error = msg;
        result.finalUrl = page.url() === "about:blank" ? null : page.url();
        return result;
      }
      result.error = `${msg} (partial: tools registered before the timeout are included)`;
    }

    // Wait for registrations to stop: at most settleMs, done early after quietMs without change.
    const countNow = async () => {
      const captured = await page
        .evaluate(() => {
          const log = (window as any)[Symbol.for("vskill.webmcp")];
          return Array.isArray(log) ? log.length : 0;
        })
        .catch(() => 0);
      return captured + cdpEvents.length;
    };
    const start = Date.now();
    let last = await countNow();
    let lastChange = Date.now();
    while (Date.now() - start < settleMs) {
      await page.waitForTimeout(250);
      const n = await countNow();
      if (n !== last) {
        last = n;
        lastChange = Date.now();
      } else if (Date.now() - lastChange >= quietMs) {
        break;
      }
    }

    result.finalUrl = page.url();
    const snap = await page.evaluate(snapshotInPage);
    result.documentModelContext = snap.documentModelContext;
    result.navigatorModelContext = snap.navigatorModelContext;
    const captured: CapturedTool[] = snap.captured.map(({ stack, ...rest }) => ({
      ...rest,
      scriptUrl: rest.unregistered ? undefined : scriptUrlFromStack(stack, PROBE_NAME),
    }));
    result.tools = mergeTools({
      pageUrl: result.finalUrl,
      captured,
      cdp: cdpEvents,
      listed: snap.listed,
    });
  } catch (e) {
    result.error = result.error ?? firstLine(e);
  } finally {
    await ctx.close().catch(() => {});
  }
  return result;
}
