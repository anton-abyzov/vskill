// ---------------------------------------------------------------------------
// 0836 US-002 — Bridge for the per-process X-Studio-Token.
//
// At app boot we fetch the token via the first available path:
//   1. `window.__vskill_studio_token__` JSON script — injected by the
//      eval-server's serveStatic() into index.html. Works in BOTH browser
//      (npx vskill studio → user's default browser tab) and Tauri WebView.
//   2. Tauri IPC `get_studio_token` — fallback for older Tauri shells whose
//      bundled index.html hasn't been re-built with the injection. Only
//      available inside Tauri.
//
// Then we patch `globalThis.fetch` once so every same-origin `/api/*`
// request gets `X-Studio-Token: <token>` injected automatically.
//
// The web build (vskill-platform-served studio) is NOT this path — the
// platform proxies through CF Workers with cookie auth instead. We detect
// "is local eval-server" by the presence of the injected script tag.
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

/**
 * Read the token from the injected <script id="__vskill_studio_token__">
 * tag. This is the PRIMARY source — works in both browser and Tauri because
 * the eval-server injects it into every served index.html.
 */
function readStudioTokenFromDom(): string | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById("__vskill_studio_token__");
  if (!el || !el.textContent) return null;
  try {
    const parsed = JSON.parse(el.textContent) as { token?: unknown };
    if (typeof parsed.token === "string" && parsed.token.length > 0) {
      return parsed.token;
    }
  } catch {
    /* malformed injection — fall through to IPC */
  }
  return null;
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
 *
 * Resolution order: DOM-injected script (works in browser + Tauri) → Tauri IPC.
 */
async function ensureStudioToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  // Try DOM injection first — synchronous, always available.
  const fromDom = readStudioTokenFromDom();
  if (fromDom) {
    cachedToken = fromDom;
    return fromDom;
  }
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
 * App.tsx. Calling more than once is a no-op.
 *
 * The patch is active whenever a studio token is available — that means
 * BOTH the Tauri desktop WebView AND the browser tab opened by
 * `npx vskill studio`. The previous Tauri-only gate broke browser-mode
 * entirely: every /api/* call returned 401 because the browser had no
 * way to obtain the per-process token. We now read it from the injected
 * <script id="__vskill_studio_token__"> tag served by eval-server.
 *
 * Skipped: the vskill-platform-served studio (verified-skill.com) where
 * there's no eval-server, no injected script, and the platform's cookie
 * auth handles /api/* requests. We detect that by the absence of the
 * injected token script — if it's not there and we're not in Tauri,
 * the patch is a no-op.
 */
export function installStudioTokenFetchPatch(): void {
  if (patched) return;
  if (typeof globalThis.fetch !== "function") return;
  // Decide if we should install at all. If neither DOM injection nor Tauri
  // IPC is available, there's no token to inject — skip the patch entirely
  // so verified-skill.com web traffic stays untouched.
  const hasDomToken = readStudioTokenFromDom() !== null;
  if (!hasDomToken && !isTauriHost()) return;
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
