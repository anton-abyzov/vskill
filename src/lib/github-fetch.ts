// ---------------------------------------------------------------------------
// github-fetch.ts — central, authenticated fetch helper for any vskill code
// path that talks to GitHub.
//
// Responsibilities:
//   1. Inject `Authorization: Bearer <token>` from the OS keychain when one is
//      available AND the URL targets an allow-listed GitHub host.
//   2. Stamp `User-Agent: vskill/<cli-version>` so GitHub's abuse heuristics
//      don't 403 our requests.
//   3. Enforce SSRF allowlist: only api.github.com + raw.githubusercontent.com.
//   4. Retry on 429 / Retry-After (capped at 30s, max 3 retries).
//   5. Surface 401 with an actionable message ("Run `vskill auth login`").
//   6. Refuse `/search/code` URLs entirely — that endpoint has a 10/min cap
//      and burns the whole installation budget if hit by accident.
//
// Designed for dependency injection (tokenProvider, fetchImpl, sleep) so tests
// never touch the real network or the OS keychain.
// ---------------------------------------------------------------------------

import { getDefaultKeychain } from "./keychain.js";

const ALLOWED_HOSTS = new Set([
  "api.github.com",
  "raw.githubusercontent.com",
]);

const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_SECONDS = 30;

export class GitHubFetchError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = "GitHubFetchError";
    this.status = status;
    this.body = body;
  }
}

export interface GitHubFetchOptions {
  /** Returns the current token or null. Defaults to the OS keychain. */
  tokenProvider?: () => string | null;
  /** Fetch impl (DI for tests). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Sleep impl (DI for tests). Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** vskill CLI version; used in User-Agent. Defaults to "vskill". */
  version?: string;
  /** Override allowed hostname set (testing only). */
  allowedHosts?: Set<string>;
}

export type GitHubFetch = (url: string, init?: RequestInit) => Promise<Response>;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAllowedHost(url: string, allowed: Set<string>): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return allowed.has(u.hostname);
  } catch {
    return false;
  }
}

function isSearchCode(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname.startsWith("/search/code");
  } catch {
    return false;
  }
}

function mergeHeaders(
  base: Record<string, string>,
  init: RequestInit | undefined,
): Record<string, string> {
  const out: Record<string, string> = { ...base };
  if (!init?.headers) return out;
  if (init.headers instanceof Headers) {
    init.headers.forEach((v, k) => {
      out[k] = v;
    });
  } else if (Array.isArray(init.headers)) {
    for (const [k, v] of init.headers) out[k] = v;
  } else {
    for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
      out[k] = v;
    }
  }
  return out;
}

export function createGitHubFetch(opts: GitHubFetchOptions = {}): GitHubFetch {
  const tokenProvider =
    opts.tokenProvider ?? (() => getDefaultKeychain().getGitHubToken());
  // Defer to globalThis.fetch on every call so test suites that replace
  // `globalThis.fetch = vi.fn(...)` continue to intercept requests.
  const fetchImpl = opts.fetchImpl ?? ((url: RequestInfo | URL, init?: RequestInit) =>
    (globalThis as { fetch: typeof fetch }).fetch(url, init));
  const sleep = opts.sleep ?? defaultSleep;
  const version = opts.version ?? "vskill";
  const allowed = opts.allowedHosts ?? ALLOWED_HOSTS;

  return async function githubFetch(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    if (isSearchCode(url)) {
      throw new Error(
        "github-fetch: /search/code is not permitted (rate-limit guardrail; use a workflow-specific endpoint instead)",
      );
    }
    if (!isAllowedHost(url, allowed)) {
      throw new Error(
        `github-fetch: host not allowed for SSRF guard (got ${safeHost(url)}; allowed: ${[...allowed].join(", ")})`,
      );
    }

    const token = tokenProvider();
    const baseHeaders: Record<string, string> = {
      "User-Agent": `vskill/${version}`,
    };
    if (token) baseHeaders.Authorization = `Bearer ${token}`;
    const headers = mergeHeaders(baseHeaders, init);

    let attempt = 0;
    let lastResponse: Response | null = null;
    while (attempt <= MAX_RETRIES) {
      const res = await fetchImpl(url, { ...init, headers });
      lastResponse = res;

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const retryAfterRaw = res.headers.get("retry-after");
        const retryAfter = retryAfterRaw
          ? Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(0, Number(retryAfterRaw)))
          : Math.min(MAX_RETRY_AFTER_SECONDS, 1 + attempt);
        attempt++;
        if (attempt > MAX_RETRIES) break;
        await sleep(retryAfter * 1000);
        continue;
      }

      if (res.status === 401) {
        const body = await res.text().catch(() => "");
        throw new GitHubFetchError(
          401,
          body,
          token
            ? "GitHub returned 401: token expired or insufficient scope. Run `vskill auth login` to re-authenticate."
            : "GitHub returned 401: this resource requires authentication. Run `vskill auth login` to sign in.",
        );
      }

      return res;
    }
    // Exhausted retries on 429/5xx — surface the last response.
    return lastResponse as Response;
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname || "<invalid>";
  } catch {
    return "<invalid>";
  }
}

/**
 * Module-level default helper. Most call sites just want
 *   `await githubFetch(url)`
 * without juggling option objects.
 */
let _defaultFetch: GitHubFetch | null = null;
export function githubFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!_defaultFetch) _defaultFetch = createGitHubFetch();
  return _defaultFetch(url, init);
}

/** Test-only reset hook. */
export function _resetDefaultGitHubFetchForTests(): void {
  _defaultFetch = null;
}
