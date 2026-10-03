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
//   7. Private repos: raw.githubusercontent.com does not reliably honor a
//      Bearer token for private content (it answers 404). When a token is
//      available, raw URLs are served through the Contents API
//      (`Accept: application/vnd.github.raw`), which does. The raw host is
//      still the fallback, and anonymous public reads never touch the API.
//
// Designed for dependency injection (tokenProvider, fetchImpl, sleep) so tests
// never touch the real network or the OS keychain.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
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

export function resolveGitHubEnvToken(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return (
    env.VSKILL_TEST_GITHUB_PAT ||
    env.VSKILL_TEST_PRIVATE_GITHUB_PAT ||
    env.GITHUB_TOKEN ||
    env.GH_TOKEN ||
    null
  );
}

let _ghCliToken: string | null | undefined;

/**
 * Last-resort token source: the GitHub CLI's stored login (`gh auth token`).
 * Lets a team member who already ran `gh auth login` install from a private
 * skills repo without a separate `vskill auth login`. Resolved once per
 * process; set VSKILL_NO_GH_CLI=1 to skip it.
 */
export function readGhCliToken(
  env: NodeJS.ProcessEnv = process.env,
  exec: typeof execFileSync = execFileSync,
): string | null {
  if (env.VSKILL_NO_GH_CLI === "1") return null;
  if (_ghCliToken !== undefined) return _ghCliToken;
  try {
    const out = exec("gh", ["auth", "token"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const token = typeof out === "string" ? out.trim() : "";
    _ghCliToken = token || null;
  } catch {
    _ghCliToken = null;
  }
  return _ghCliToken;
}

/**
 * Token precedence: VSKILL_GITHUB_TOKEN (explicit, e.g. CI) > `vskill auth
 * login` keychain token > GITHUB_TOKEN / GH_TOKEN > `gh auth token`.
 */
export function resolveDefaultGitHubToken(): string | null {
  return (
    process.env.VSKILL_GITHUB_TOKEN ||
    getDefaultKeychain().getGitHubToken() ||
    resolveGitHubEnvToken() ||
    readGhCliToken()
  );
}

/**
 * Extra line for "not found" errors: GitHub answers 404 (not 401/403) for a
 * private repository the caller cannot read, either because no token is
 * configured or because the token lacks access (e.g. a `read:user`-only
 * `vskill auth login` token).
 */
export function privateRepoHint(
  tokenProvider: () => string | null = resolveDefaultGitHubToken,
): string {
  const fix =
    "`vskill auth login --repos`, `gh auth login`, or set VSKILL_GITHUB_TOKEN " +
    "to a token with read access to the repo.";
  return tokenProvider()
    ? `\nIf this is a private repository, your GitHub token cannot read it. Use ${fix}`
    : `\nIf this is a private repository, sign in first: ${fix}`;
}

/**
 * Map `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}` to the
 * equivalent Contents API URL. A signed `?token=` download URL (what the
 * Contents API hands out for private files) maps too: the Bearer token covers
 * the same read, and the signed URL stays the fallback. Returns null for
 * anything else.
 */
export function rawToContentsApiUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== "raw.githubusercontent.com") return null;
  if ([...u.searchParams.keys()].some((k) => k !== "token")) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length < 4) return null;
  const [owner, repo, ...rest] = segs;
  let ref = rest.shift()!;
  if (ref === "refs" && (rest[0] === "heads" || rest[0] === "tags") && rest.length >= 3) {
    rest.shift();
    ref = rest.shift()!;
  }
  if (rest.length === 0) return null;
  return (
    `https://api.github.com/repos/${owner}/${repo}/contents/${rest.join("/")}` +
    `?ref=${encodeURIComponent(decodeURIComponent(ref))}`
  );
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
    opts.tokenProvider ?? resolveDefaultGitHubToken;
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

    // Private-repo path: with a token, read raw files through the Contents
    // API first. Anything but a 200 falls back to the raw host below, so
    // public reads behave exactly as before.
    const apiUrl = token ? rawToContentsApiUrl(url) : null;
    if (apiUrl) {
      const apiHeaders: Record<string, string> = { ...headers };
      delete apiHeaders.accept;
      apiHeaders.Accept = "application/vnd.github.raw";
      try {
        const res = await send(apiUrl, { ...init, headers: apiHeaders }, Boolean(token));
        if (res.ok) return res;
      } catch (err) {
        if (!(err instanceof GitHubFetchError && err.status === 401)) throw err;
        // Stale or revoked token: public content still reads anonymously.
        warnRejectedTokenOnce();
        const anonHeaders = { ...headers };
        delete anonHeaders.Authorization;
        delete anonHeaders.authorization;
        const anon = await fetchImpl(url, { ...init, headers: anonHeaders });
        if (anon.ok) return anon;
        throw err;
      }
    }

    try {
      return await send(url, { ...init, headers }, Boolean(token));
    } catch (err) {
      if (!(token && err instanceof GitHubFetchError && err.status === 401)) throw err;
      // Expired or revoked token: public repos still answer anonymously, so
      // visibility checks and public updates keep working. Say so once.
      warnRejectedTokenOnce();
      const anonHeaders = { ...headers };
      delete anonHeaders.Authorization;
      delete anonHeaders.authorization;
      return send(url, { ...init, headers: anonHeaders }, false);
    }
  };

  async function send(url: string, req: RequestInit, hadToken: boolean): Promise<Response> {
    let attempt = 0;
    let lastResponse: Response | null = null;
    while (attempt <= MAX_RETRIES) {
      const res = await fetchImpl(url, req);
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
          hadToken
            ? "GitHub returned 401: token expired or insufficient scope. Run `vskill auth login` to re-authenticate."
            : "GitHub returned 401: this resource requires authentication. Run `vskill auth login` to sign in.",
        );
      }

      return res;
    }
    // Exhausted retries on 429/5xx — surface the last response.
    return lastResponse as Response;
  }
}

let rejectedTokenWarned = false;

function warnRejectedTokenOnce(): void {
  if (rejectedTokenWarned) return;
  rejectedTokenWarned = true;
  process.stderr.write(
    "vskill: GitHub rejected your token (expired or revoked); continuing without it for public repos. " +
      "Run `vskill auth login` (add --repos for private repos) to refresh it.\n",
  );
}

/** @internal test-only */
export function _resetRejectedTokenWarningForTests(): void {
  rejectedTokenWarned = false;
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
  _ghCliToken = undefined;
}
