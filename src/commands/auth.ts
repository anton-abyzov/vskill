// ---------------------------------------------------------------------------
// auth.ts — `vskill auth {login,status,logout}`.
//
// Device Flow (RFC 8628) against github.com directly:
//   1. POST https://github.com/login/device/code
//        body:  client_id=<VSKILL_GITHUB_CLIENT_ID>&scope=read:user
//        resp:  { device_code, user_code, verification_uri, interval, expires_in }
//   2. Display formatted user_code (XXXX-XXXX) + verification_uri.
//      Optionally open the URL in the user's default browser.
//   3. Poll https://github.com/login/oauth/access_token every `interval` seconds
//        body:  client_id=...&device_code=...&grant_type=urn:ietf:params:oauth:grant-type:device_code
//        resp:  { access_token, ... } | { error: "authorization_pending" | "slow_down" | "expired_token" | "access_denied" }
//      slow_down → bump interval +5s.
//      authorization_pending → keep polling.
//      expired_token / access_denied → abort.
//   4. GET https://api.github.com/user with Bearer token to confirm + print login.
//   5. Persist token via keychain.
//
// All network operations go through dependency-injected `fetchImpl` so tests
// never hit the real github.com.
// ---------------------------------------------------------------------------

import { getDefaultKeychain, type Keychain } from "../lib/keychain.js";

export interface AuthCommandIO {
  stdout: { write: (s: string) => boolean };
  stderr: { write: (s: string) => boolean };
  exit?: (code: number) => void;
  /** Optional browser opener; if absent, login skips the auto-open step. */
  openBrowser?: (url: string) => Promise<void>;
}

export interface AuthCommandDeps {
  io: AuthCommandIO;
  keychain?: Keychain;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** OAuth client_id; defaults to env VSKILL_GITHUB_CLIENT_ID. */
  clientId?: string;
  /** vskill version for User-Agent stamping. */
  version?: string;
  /**
   * 0839 US-005 — exchange a `gho_*` token for a `vsk_*` token via the
   * platform `/auth/github/exchange-for-vsk-token` endpoint. Optional so
   * tests can inject a fake; production wires `exchangeForVskToken` from
   * `../api/client.ts`. Failure of this call MUST NOT block login
   * (AC-US5-05 — fall back to "legacy mode").
   */
  exchangeForVskToken?: (githubToken: string) => Promise<{ token: string }>;
  /**
   * 0839 US-005 / AC-US5-06 — best-effort server-side revocation invoked
   * on logout. Failure MUST NOT block local logout. Defaults to the
   * platform `signOutAll` helper from `../api/client.ts`.
   */
  signOutAll?: () => Promise<void>;
  /**
   * 0839 F-004 — invalidate the in-memory auth cache after keychain
   * mutations so a same-process `auth login && orgs list` sees the fresh
   * token. Optional so tests can inject a spy; production wires
   * `invalidateAuthCache` from `../api/client.ts`.
   */
  invalidateAuthCache?: () => void;
}

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

const DEFAULT_SCOPE = "read:user";

interface DeviceCodeResp {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

interface PollSuccess {
  access_token: string;
}
interface PollError {
  error: string;
  error_description?: string;
}
type PollResult = PollSuccess | PollError;

function isPollError(r: PollResult): r is PollError {
  return typeof (r as PollError).error === "string";
}

function formatUserCode(code: string): string {
  // GitHub returns 8 alphanumerics like "ABCD1234" — render as ABCD-1234.
  if (code.length === 8) return `${code.slice(0, 4)}-${code.slice(4)}`;
  return code;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postForm(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, string>,
  version: string,
): Promise<Response> {
  const params = new URLSearchParams(body);
  return fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": `vskill/${version}`,
    },
    body: params.toString(),
  });
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  version: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": `vskill/${version}`,
    },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function loginCmd(deps: Required<Pick<AuthCommandDeps, "fetchImpl" | "sleep" | "version">> & AuthCommandDeps): Promise<number> {
  const { io, fetchImpl, sleep, version } = deps;
  const keychain = deps.keychain ?? getDefaultKeychain();
  const clientId = deps.clientId ?? process.env.VSKILL_GITHUB_CLIENT_ID ?? "";
  if (!clientId) {
    io.stderr.write(
      "vskill auth login: VSKILL_GITHUB_CLIENT_ID is not set. " +
        "Set it to the Skill Studio GitHub App's client_id, then retry.\n",
    );
    return 2;
  }

  // --- Step 1: device code -------------------------------------------------
  let dcRes: Response;
  try {
    dcRes = await postForm(fetchImpl, DEVICE_CODE_URL, {
      client_id: clientId,
      scope: DEFAULT_SCOPE,
    }, version);
  } catch (err) {
    io.stderr.write(`vskill auth login: network error contacting github.com (${(err as Error).message})\n`);
    return 1;
  }
  if (!dcRes.ok) {
    io.stderr.write(`vskill auth login: device-code request failed (HTTP ${dcRes.status})\n`);
    return 1;
  }
  const dc = (await dcRes.json()) as DeviceCodeResp;

  io.stdout.write(`\nTo authenticate, visit:\n  ${dc.verification_uri}\n\n`);
  io.stdout.write(`And enter the code:\n  ${formatUserCode(dc.user_code)}\n\n`);
  io.stdout.write(`(Waiting for authorization. This window will poll every ${dc.interval}s.)\n`);

  if (io.openBrowser) {
    try {
      await io.openBrowser(dc.verification_uri);
    } catch {
      // Non-fatal — the user can copy/paste the URL.
    }
  }

  // --- Step 2: poll --------------------------------------------------------
  let interval = Math.max(1, dc.interval);
  const deadline = Date.now() + (dc.expires_in * 1000);
  let accessToken: string | null = null;

  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    let pollRes: Response;
    try {
      pollRes = await postForm(fetchImpl, TOKEN_URL, {
        client_id: clientId,
        device_code: dc.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }, version);
    } catch (err) {
      io.stderr.write(`vskill auth login: network error during polling (${(err as Error).message})\n`);
      return 1;
    }
    let body: PollResult;
    try {
      body = (await pollRes.json()) as PollResult;
    } catch {
      io.stderr.write("vskill auth login: malformed token response from github.com\n");
      return 1;
    }
    if (!isPollError(body) && body.access_token) {
      accessToken = body.access_token;
      break;
    }
    if (isPollError(body)) {
      switch (body.error) {
        case "authorization_pending":
          continue;
        case "slow_down":
          interval += 5;
          continue;
        case "expired_token":
          io.stderr.write("vskill auth login: device code expired before authorization. Please try again.\n");
          return 1;
        case "access_denied":
          io.stderr.write("vskill auth login: authorization denied by user.\n");
          return 1;
        default:
          io.stderr.write(`vskill auth login: unexpected error from github.com: ${body.error}\n`);
          return 1;
      }
    }
  }

  if (!accessToken) {
    io.stderr.write("vskill auth login: timed out waiting for authorization.\n");
    return 1;
  }

  // --- Step 3: confirm via /user + persist ---------------------------------
  const user = await getJson(fetchImpl, USER_URL, accessToken, version);
  if (user.status !== 200 || !user.body || typeof (user.body as { login?: string }).login !== "string") {
    io.stderr.write(`vskill auth login: token saved but /user verification failed (HTTP ${user.status})\n`);
    keychain.setGitHubToken(accessToken);
    // 0839 F-004 — invalidate cache so any subsequent in-process API call
    // sees the new gho_ token rather than the pre-login (null) cache.
    if (deps.invalidateAuthCache) deps.invalidateAuthCache();
    return 1;
  }
  const login = (user.body as { login: string }).login;
  keychain.setGitHubToken(accessToken);
  // 0839 F-004 — bust the cache after writing a fresh gho_ to keychain.
  if (deps.invalidateAuthCache) deps.invalidateAuthCache();

  // --- Step 4: exchange gho_* for vsk_* (0839 US-005) ---------------------
  // Best-effort: failure is non-fatal — login still succeeds in "legacy
  // mode" with just the gho_* token (AC-US5-05). The platform's
  // `requireUserOrGithubBearer` already accepts gho_*, so all features
  // continue to work; only entitlement-aware flows that strictly require
  // a vsk_* token would degrade.
  if (deps.exchangeForVskToken) {
    try {
      const resp = await deps.exchangeForVskToken(accessToken);
      if (resp && typeof resp.token === "string" && resp.token.length > 0) {
        keychain.setVskillToken(resp.token);
        // 0839 F-004 — bust again so vsk_ replaces gho_ in the cache.
        if (deps.invalidateAuthCache) deps.invalidateAuthCache();
      } else {
        io.stdout.write(
          `\nLogged in as @${login} (legacy mode — exchange returned no token).\n`,
        );
        return 0;
      }
    } catch (err) {
      io.stdout.write(
        `\nLogged in as @${login} (legacy mode — some features unavailable: ${(err as Error).message}).\n`,
      );
      return 0;
    }
  }
  io.stdout.write(`\nLogged in as @${login}.\n`);
  return 0;
}

async function statusCmd(args: string[], deps: Required<Pick<AuthCommandDeps, "fetchImpl" | "version">> & AuthCommandDeps): Promise<number> {
  const { io, fetchImpl, version } = deps;
  const keychain = deps.keychain ?? getDefaultKeychain();
  const json = args.includes("--json");
  const refresh = args.includes("--refresh") || args.includes("--validate");
  const token = keychain.getGitHubToken();

  if (!token) {
    if (json) {
      io.stdout.write(JSON.stringify({ loggedIn: false }) + "\n");
    } else {
      io.stdout.write("Not logged in. Run `vskill auth login`.\n");
    }
    return 1;
  }

  // Default behavior: validate via /user (cheap, ~50ms) so the user knows the
  // token still works. --json controls output shape; --refresh is accepted for
  // clarity but in this MVP it has the same effect as the default path.
  void refresh;
  const user = await getJson(fetchImpl, USER_URL, token, version);
  if (user.status === 401) {
    if (json) {
      io.stdout.write(JSON.stringify({ loggedIn: false, reason: "token_invalid" }) + "\n");
    } else {
      io.stderr.write("Token is invalid or expired. Run `vskill auth login`.\n");
    }
    return 1;
  }
  if (user.status !== 200 || !user.body) {
    if (json) {
      io.stdout.write(JSON.stringify({ loggedIn: true, validated: false, status: user.status }) + "\n");
    } else {
      io.stdout.write(`Token present but /user returned HTTP ${user.status}. Network or scope issue.\n`);
    }
    return 1;
  }
  const u = user.body as { login: string; id: number };
  if (json) {
    io.stdout.write(JSON.stringify({ loggedIn: true, login: u.login, id: u.id }) + "\n");
  } else {
    io.stdout.write(`Logged in as @${u.login} (id=${u.id}).\n`);
  }
  return 0;
}

async function logoutCmd(deps: AuthCommandDeps): Promise<number> {
  const { io } = deps;
  const keychain = deps.keychain ?? getDefaultKeychain();

  // 0839 US-005 / AC-US5-06: clear BOTH local tokens AND best-effort
  // revoke server-side. Server-side revoke runs BEFORE local clear so a
  // network failure doesn't prevent us from logging the user out
  // remotely — but its failure NEVER blocks the local clear.
  if (deps.signOutAll) {
    try {
      await deps.signOutAll();
    } catch (err) {
      // Soft-fail: local logout proceeds anyway. Surface the failure on
      // stderr so power users running --debug see it.
      if (process.env.VSKILL_DEBUG === "1") {
        io.stderr.write(
          `vskill auth logout: server-side revoke failed (${(err as Error).message}); local clear continues.\n`,
        );
      }
    }
  }

  const hadGh = keychain.clearGitHubToken();
  const hadVsk = keychain.clearVskillToken();
  // 0839 F-004 — invalidate the in-memory cache so a subsequent API call
  // doesn't keep using a token we just revoked. We do this unconditionally
  // because even if the keychain didn't carry a token, the cache could
  // still hold a value from a prior session that hadn't been written back.
  if (deps.invalidateAuthCache) deps.invalidateAuthCache();
  const had = hadGh || hadVsk;
  if (had) {
    io.stdout.write("Logged out. Tokens cleared from keychain.\n");
    return 0;
  }
  io.stdout.write("Logged out. (No tokens were stored.)\n");
  return 0;
}

function usage(io: AuthCommandIO): void {
  io.stdout.write(
    [
      "Usage: vskill auth <subcommand>",
      "",
      "Subcommands:",
      "  login           Sign in via GitHub Device Flow",
      "  status [--json] [--refresh]  Show current GitHub identity",
      "  logout          Clear stored GitHub credentials",
      "",
    ].join("\n"),
  );
}

export async function authCommand(
  argv: string[],
  deps: AuthCommandDeps,
): Promise<number> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const version = deps.version ?? "vskill";
  const io = deps.io;

  // 0839 US-005: default `exchangeForVskToken` and `signOutAll` to the
  // production platform helpers when not injected. Lazy-imported so the
  // unit tests that pass mocks don't trigger any real network code.
  const exchangeForVskToken =
    deps.exchangeForVskToken ??
    (async (githubToken: string) => {
      const mod = await import("../api/client.js");
      return mod.exchangeForVskToken(githubToken);
    });
  const signOutAll =
    deps.signOutAll ??
    (async () => {
      const mod = await import("../api/client.js");
      return mod.signOutAll();
    });
  // 0839 F-004 — default cache invalidator ties auth.ts to the API client's
  // `invalidateAuthCache`. Synchronous module reference is fine here: the
  // client.ts module is already imported by anything that touches the
  // auth path, and we only call it after a successful keychain mutation.
  const invalidateAuthCache =
    deps.invalidateAuthCache ??
    (() => {
      // Best-effort: import lazily so test environments that mock
      // ../api/client don't crash if the module shape differs.
      void import("../api/client.js")
        .then((mod) => {
          if (typeof mod.invalidateAuthCache === "function") {
            mod.invalidateAuthCache();
          }
        })
        .catch(() => {
          /* non-fatal — cache will fall stale until next process boot */
        });
    });

  const sub = argv[0];
  let exit = 0;
  switch (sub) {
    case "login":
      exit = await loginCmd({
        ...deps,
        fetchImpl,
        sleep,
        version,
        exchangeForVskToken,
        invalidateAuthCache,
      });
      break;
    case "status":
      exit = await statusCmd(argv.slice(1), { ...deps, fetchImpl, sleep: deps.sleep ?? defaultSleep, version });
      break;
    case "logout":
      exit = await logoutCmd({ ...deps, signOutAll, invalidateAuthCache });
      break;
    case undefined:
    case "--help":
    case "-h":
      usage(io);
      exit = sub ? 0 : 1;
      break;
    default:
      io.stderr.write(`unknown subcommand: ${sub}\n`);
      usage(io);
      exit = 1;
      break;
  }

  if (deps.io.exit) deps.io.exit(exit);
  return exit;
}
