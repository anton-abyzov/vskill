// ---------------------------------------------------------------------------
// 0836 US-002 — Tauri-side bridge for the per-process X-Studio-Token.
//
// At app boot (inside Tauri only), we:
//   1. Invoke `get_studio_token` IPC to fetch the token captured from the
//      sidecar's `Studio token: <t>` startup banner.
//   2. Patch `globalThis.fetch` once so every same-origin `/api/*` request
//      gets `X-Studio-Token: <token>` injected automatically.
//
// The web build (vskill-platform-served studio) does NOT run this — the
// platform proxies through CF Workers with cookie auth instead. The
// `installStudioTokenFetchPatch()` entry point is a no-op outside Tauri.
//
// The token itself never leaves this module's closure. Callers that
// legitimately need the value (e.g., a developer tool) can use
// `getStudioTokenForTesting()` — exported only for unit tests.
// ---------------------------------------------------------------------------

interface TauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals;
}

const STUDIO_TOKEN_HEADER = "X-Studio-Token";

let cachedToken: string | null = null;
let tokenPromise: Promise<string | null> | null = null;
let patched = false;
let originalFetch: typeof fetch | null = null;

/**
 * True when running inside a Tauri WebView (mirrors AccountTauriBridge).
 */
function isTauriHost(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as TauriWindow).__TAURI_INTERNALS__?.invoke);
}

async function fetchStudioTokenViaIpc(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const w = window as TauriWindow;
  const invoke = w.__TAURI_INTERNALS__?.invoke;
  if (!invoke) return null;
  try {
    const v = (await invoke("get_studio_token")) as string | null | undefined;
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    // The sidecar may not yet have emitted the banner; the caller retries.
    return null;
  }
}

/**
 * Best-effort accessor used by the patched fetch. Caches the first non-null
 * value for the process lifetime and dedupes concurrent IPC calls.
 */
async function ensureStudioToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (tokenPromise) return tokenPromise;
  tokenPromise = fetchStudioTokenViaIpc().then((t) => {
    if (t) cachedToken = t;
    tokenPromise = null;
    return t;
  });
  return tokenPromise;
}

/**
 * Returns true if the URL should carry the studio token. We inject for any
 * relative `/api/...` path and any same-origin `/api/...` URL. We do NOT
 * inject for cross-origin URLs (verified-skill.com, github.com) — those
 * have their own auth.
 */
function shouldInject(url: string): boolean {
  if (typeof window === "undefined") return false;
  if (url.startsWith("/api/")) return true;
  try {
    const origin = window.location.origin;
    if (url.startsWith(`${origin}/api/`)) return true;
  } catch {
    /* non-DOM environments */
  }
  return false;
}

/**
 * Idempotently patch `globalThis.fetch`. Called once at app bootstrap from
 * App.tsx (inside the `if (isTauriHost())` branch). Calling more than once
 * is a no-op.
 */
export function installStudioTokenFetchPatch(): void {
  if (patched) return;
  if (!isTauriHost()) return;
  if (typeof globalThis.fetch !== "function") return;
  patched = true;
  originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let url: string;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.toString();
    else url = (input as Request).url;

    if (!shouldInject(url)) {
      return originalFetch!(input, init);
    }

    const token = await ensureStudioToken();
    if (!token) {
      // No token yet — fall through unchanged. The eval-server will return
      // 401 and the calling component should retry once on transient 401.
      return originalFetch!(input, init);
    }

    const merged: RequestInit = { ...(init ?? {}) };
    const headers = new Headers(merged.headers ?? {});
    headers.set(STUDIO_TOKEN_HEADER, token);
    merged.headers = headers;

    // For Request-shaped input, headers passed in `init` override the
    // request's own headers (Web standard) — that's the behaviour we want.
    return originalFetch!(input, merged);
  };
}

/** Test-only — unwind the patch so unit tests can verify before/after. */
export function _resetStudioTokenBridgeForTests(): void {
  if (originalFetch) globalThis.fetch = originalFetch;
  patched = false;
  cachedToken = null;
  tokenPromise = null;
  originalFetch = null;
}

/** Test-only — read the cached token directly. */
export function getStudioTokenForTesting(): string | null {
  return cachedToken;
}
