// 0834 T-029 — Tauri bridge for AccountContext.
//
// Constructs an `AccountContextValue` whose `getAuthHeader` reads the
// keyring-backed token via the `account_get_token` IPC. Lives outside
// AccountContext.tsx so the web build (which doesn't run inside Tauri)
// never has to import this file.
//
// Hosts (Tauri App.tsx) call `createTauriAccountContext()` once at boot
// and pass the result as `value={...}` to <AccountProvider>.

import type { AccountContextValue } from "./AccountContext";

interface TauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals;
}

/**
 * Build the AccountContext value for the Tauri desktop host. The
 * `getAuthHeader` callback invokes `account_get_token` lazily on each
 * fetch — so a token rotation in the keyring picks up on the next
 * request without remounting the React tree.
 */
export async function createTauriAccountContext(): Promise<AccountContextValue> {
  const platformBaseUrl = await invokeTauri<string>(
    "account_get_platform_url",
  );

  return {
    platformBaseUrl: platformBaseUrl ?? "https://verified-skill.com",
    authMode: "bearer",
    getAuthHeader: async () => {
      const token = await invokeTauri<string | null>("account_get_token");
      return token ? `Bearer ${token}` : null;
    },
  };
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
