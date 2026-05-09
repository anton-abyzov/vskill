// 0834 T-026 — AccountContext.
//
// Provides the platform base URL + auth token to the account/* components.
// Three host shapes:
//
//   • Web (vskill-platform Next.js page) — `platformBaseUrl` is "" (same
//     origin) and auth is cookie-based, so `getAuthHeader()` returns null
//     and fetches use `credentials: "include"`.
//   • Tauri desktop — `platformBaseUrl` = "https://verified-skill.com"
//     and `getAuthHeader()` returns "Bearer ${keyringToken}".
//   • npx vskill studio — same default platformBaseUrl, may use cookie or
//     bearer depending on whether the user authed via studio's browser
//     tab (cookie) or pasted a vsk_ token (bearer).
//
// The provider is consumed by `useAccount()` and any other helper that
// has to talk to /api/v1/account/*. Keeping the wiring in one place
// means a fetch-layer swap (e.g. injecting a mock for tests) is a
// single-prop change.

import { createContext, useContext, useMemo } from "react";

export type AuthMode = "cookie" | "bearer";

export interface AccountContextValue {
  /**
   * Origin to prefix on `/api/v1/account/...` requests. Empty string
   * for same-origin (web). For Tauri/npx-studio: "https://verified-skill.com".
   */
  platformBaseUrl: string;
  /**
   * Auth strategy. "cookie" — relies on the browser's session cookie
   * (same-origin only). "bearer" — sends an `Authorization` header.
   */
  authMode: AuthMode;
  /**
   * Resolves to `Bearer ${token}` when authMode is "bearer", or `null`
   * when there is no token to forward. Async so Tauri callers can read
   * from the keyring lazily.
   */
  getAuthHeader: () => Promise<string | null>;
  /**
   * Optional override for tests + non-DOM environments. When provided,
   * `useAccount` uses this instead of `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch;
}

const DEFAULT_VALUE: AccountContextValue = {
  platformBaseUrl: "",
  authMode: "cookie",
  getAuthHeader: async () => null,
};

const AccountContext = createContext<AccountContextValue>(DEFAULT_VALUE);

export interface AccountProviderProps {
  /** Override one or more fields. Unspecified fields fall back to defaults. */
  value?: Partial<AccountContextValue>;
  children: React.ReactNode;
}

export function AccountProvider({ value, children }: AccountProviderProps) {
  const merged = useMemo<AccountContextValue>(
    () => ({ ...DEFAULT_VALUE, ...(value ?? {}) }),
    [
      value?.platformBaseUrl,
      value?.authMode,
      value?.getAuthHeader,
      value?.fetchImpl,
    ],
  );
  return (
    <AccountContext.Provider value={merged}>{children}</AccountContext.Provider>
  );
}

export function useAccountContext(): AccountContextValue {
  return useContext(AccountContext);
}

/** Build a full URL from a relative API path, honoring the configured base. */
export function buildAccountUrl(ctx: AccountContextValue, path: string): string {
  const base = ctx.platformBaseUrl.replace(/\/+$/, "");
  const tail = path.startsWith("/") ? path : `/${path}`;
  return `${base}${tail}`;
}
