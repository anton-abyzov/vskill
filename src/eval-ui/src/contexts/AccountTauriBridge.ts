// 0834 T-029 / 0836 US-003 — Tauri bridge for AccountContext.
//
// 0836 US-003 SECURITY CHANGE
// ---------------------------
// The previous bridge minted `Authorization: Bearer ${keyringToken}` from
// the removed `account_get_token` IPC and called verified-skill.com
// directly from the WebView. That made any reachable WebView XSS one IPC
// away from the raw `gho_*` token.
//
// New flow:
//   - The WebView calls relative `/api/v1/account/*` URLs (same-origin
//     to the eval-server).
//   - The eval-server's `platform-proxy.ts` matches the prefix, injects
//     `Authorization: Bearer <gho_*>` Rust-side from the OS secure store,
//     forwards the request to verified-skill.com.
//   - The WebView never holds the bearer. AccountContext keeps `authMode`
//     in "cookie" mode so the request layer doesn't try to attach an
//     Authorization header — the proxy adds one.
//
// `account_get_platform_url` IPC remains for diagnostics / future
// platform-pointer overrides but its value is NOT threaded into the
// AccountContext platformBaseUrl (a non-empty base would make the
// WebView fetch verified-skill.com directly, bypassing the proxy and
// the token injection).

import type { AccountContextValue } from "./AccountContext";

interface TauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals;
}

/**
 * 0836 US-003 — light-weight summary mirroring the Rust `AccountUserSummary`
 * payload. Currently consumed by future tier-badge / login-chip wiring;
 * exported so any UI consumer can render the four fields without rebuilding
 * the IPC plumbing.
 */
export interface AccountUserSummary {
  signedIn: boolean;
  login: string | null;
  avatarUrl: string | null;
  tier: "free" | "pro" | "enterprise";
}

/**
 * Build the AccountContext value for the Tauri desktop host.
 *
 * 0836 US-003: returns a "cookie" / null-auth context. Authenticated
 * calls are routed through relative `/api/v1/account/*` URLs that the
 * eval-server proxies to verified-skill.com with a Rust-side
 * bearer injected. The WebView never sees the token.
 */
export async function createTauriAccountContext(): Promise<AccountContextValue> {
  // Forward-compat: invoke the platform-url IPC for diagnostics. We do
  // NOT thread the value into platformBaseUrl — a non-empty base would
  // make the WebView fetch verified-skill.com directly, bypassing the
  // proxy and the Rust-side token injection.
  void invokeTauri<string>("account_get_platform_url");

  return {
    platformBaseUrl: "",
    authMode: "cookie",
    getAuthHeader: async () => null,
  };
}

/** Read the WebView-facing user summary (login / avatar / tier / signedIn). */
export async function getAccountUserSummary(): Promise<AccountUserSummary> {
  const v = await invokeTauri<AccountUserSummary>("account_get_user_summary");
  if (v && typeof v === "object") return v;
  // IPC returned null (not in Tauri) or failed. Fall back to a clean
  // signed-out shape so consumers don't have to special-case null.
  return { signedIn: false, login: null, avatarUrl: null, tier: "free" };
}

async function invokeTauri<T>(cmd: string): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const w = window as TauriWindow;
  const invoke = w.__TAURI_INTERNALS__?.invoke;
  if (!invoke) return null;
  try {
    return (await invoke(cmd)) as T;
  } catch (e) {
    // Swallow IPC errors — AccountContext consumers handle null
    // (signed-out / unavailable) the same way; surfacing a thrown
    // promise here would break the React tree's render path.
    // eslint-disable-next-line no-console
    console.warn(`[AccountTauriBridge] ${cmd} failed:`, e);
    return null;
  }
}

/**
 * True when invoked inside a Tauri WebView. Hosts can branch on this
 * to choose between cookie-mode (web bundle) and bearer-mode (desktop
 * bundle) at boot.
 */
export function isTauriHost(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as TauriWindow).__TAURI_INTERNALS__?.invoke);
}
