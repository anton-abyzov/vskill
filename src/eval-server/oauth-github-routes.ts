// ---------------------------------------------------------------------------
// oauth-github-routes.ts — GitHub OAuth 2.0 Authorization Code + PKCE flow.
//
// Why this replaces the Tauri IPC device-flow path (2026-05-11):
//
//   1. The vskill OAuth App at github.com/settings/developers has Device Flow
//      DISABLED. Every device-code request returns
//      `{"error":"device_flow_disabled"}` so the Tauri device-flow IPC was
//      always going to silently fail at the GitHub layer.
//
//   2. The Tauri 2.x ACL was rejecting every custom #[tauri::command] at
//      runtime because src-tauri/build.rs doesn't pass the command list to
//      `Attributes::app_manifest(AppManifest::new().commands(&[...]))`. Even
//      with a permission TOML correctly compiled into the binary, the runtime
//      `allowed_commands` HashMap stayed empty for app-level commands. See
//      `~/.claude/skills/tauri-desktop-release/SKILL.md` for the deep dive.
//
//   3. Doing OAuth entirely in the sidecar HTTP layer sidesteps both issues:
//      - JS in the WebView already authenticates to the sidecar via
//        X-Studio-Token (the v1.0.30 fix). All it needs to do is POST/GET.
//      - The browser callback hits the SAME local sidecar (different path),
//        so we get the auth code without any Tauri-level plumbing.
//
// This mirrors how `claude-code` does it (Claude AI / Anthropic console
// login): localhost HTTP server captures the redirect, exchanges the
// authorization code for an access token via the OAuth provider's token
// endpoint, then stores the token in the OS keychain (with file fallback).
// See `anymodel-umb/repositories/antonoly/claude-code/services/oauth/`.
//
// Flow:
//   1. JS: POST /api/oauth/github/start
//      → server generates code_verifier + code_challenge (PKCE S256)
//      → server generates random state (CSRF protection)
//      → server stores {state → {verifier, expiresAt}} in in-memory map
//      → server returns {state, authUrl}
//   2. JS: window.__TAURI__.shell.open(authUrl)   (no IPC ACL needed —
//      shell:allow-open is in default capabilities)
//   3. User authorizes in their browser → GitHub redirects to
//      http://localhost:<sidecar-port>/api/oauth/github/callback?code=&state=
//   4. Sidecar callback handler:
//      → looks up state → verifier in map (404 if not found / expired)
//      → POSTs code + verifier + client_id to GitHub token endpoint
//      → stores access_token via keychain.setGithubToken()
//      → marks the state as "ready" with the user info
//      → returns a small HTML "close this tab" success page
//   5. JS polls GET /api/oauth/github/status?state=...
//      → on "ready" → frontend shows signed-in chip
//      → on "error" → frontend shows error toast
//
// Token storage is the SAME slot used by the old Tauri device-flow path
// (`~/.vskill/keys.env` or OS keychain), so existing token-consuming code
// in the studio (per-skill streams, account API) continues working.
// ---------------------------------------------------------------------------

import { randomBytes, createHash } from "node:crypto";
import * as http from "node:http";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Public OAuth App client_id. Matches the value baked into the desktop
// binary at build time (src-tauri/build.rs reads GITHUB_OAUTH_CLIENT_ID env).
// PUBLIC value — no secret protection needed, intentionally hardcoded.
const GITHUB_OAUTH_CLIENT_ID = "Ov23li6H8OpvPfuhyDEt";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_API = "https://api.github.com/user";
const REQUESTED_SCOPE = "repo read:user user:email";
const STATE_TTL_MS = 10 * 60 * 1000;   // 10 minutes — GitHub auth pages
                                        // allow ~15 min before user code expires
const STATE_GC_INTERVAL_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// In-memory state store
// ---------------------------------------------------------------------------

interface OauthFlowState {
  /** PKCE code_verifier (~43 chars base64url). Server-only; never sent to GH client. */
  verifier: string;
  /** Unix ms when this flow expires + is GC'd. */
  expiresAt: number;
  /** Once the callback completes, transitions: "pending" → "ready" | "error". */
  status: "pending" | "ready" | "error";
  /** Populated on "ready". */
  user?: {
    login: string;
    id: number;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
  };
  /** Populated on "error". */
  errorMessage?: string;
}

const flows = new Map<string, OauthFlowState>();

function gcExpiredFlows(): void {
  const now = Date.now();
  for (const [state, flow] of flows) {
    if (flow.expiresAt < now) flows.delete(state);
  }
}

setInterval(gcExpiredFlows, STATE_GC_INTERVAL_MS).unref();

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateState(): string {
  return base64UrlEncode(randomBytes(32));   // 43 chars
}

function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reconstruct the callback URL the browser will hit. We use the same host:port
 * the request came in on — that's already a 127.0.0.1 loopback bind, so the
 * URL is reachable from the user's browser without DNS/firewall issues.
 *
 * GitHub OAuth Apps registered with a `localhost` callback accept ANY port
 * (GitHub treats localhost specially per their docs), so we don't need to
 * pre-configure the dynamic eval-server port in the App settings.
 */
function buildCallbackUrl(req: http.IncomingMessage): string {
  const host = req.headers.host || "127.0.0.1";
  return `http://${host}/api/oauth/github/callback`;
}

/**
 * Exchange the authorization code + PKCE verifier for an access token.
 * Returns the token + scopes, or throws with a human-friendly message.
 */
async function exchangeCodeForToken(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<{ accessToken: string; scopes: string[] }> {
  const body = new URLSearchParams({
    client_id: GITHUB_OAUTH_CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub token exchange failed: HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (data.error) {
    throw new Error(`GitHub: ${data.error}: ${data.error_description ?? ""}`.trim());
  }
  if (!data.access_token) {
    throw new Error("GitHub returned no access_token");
  }
  return {
    accessToken: data.access_token,
    scopes: (data.scope ?? "").split(/[\s,]+/).filter(Boolean),
  };
}

/**
 * Fetch the user's GitHub profile using the access token. Used to populate
 * the signed-in chip in the studio UI.
 */
async function fetchUserProfile(accessToken: string): Promise<{
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}> {
  const res = await fetch(GITHUB_USER_API, {
    headers: {
      "Authorization": `token ${accessToken}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "vskill-studio",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub user API failed: HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    login: string;
    id: number;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  };
  return {
    login: data.login,
    id: data.id,
    name: data.name,
    email: data.email,
    avatarUrl: data.avatar_url,
  };
}

/**
 * Persist the GitHub token to the same storage slot the existing keychain
 * code uses (~/.vskill/keys.env or OS keychain). Lazy-imports keychain.ts
 * so this file stays usable in environments where keychain isn't available
 * (e.g., the test runner — keychain has hard ESM deps on native modules).
 */
async function persistGithubToken(token: string): Promise<void> {
  try {
    const mod = await import("../lib/keychain.js");
    const kc = mod.createKeychain();
    kc.setGitHubToken(token);
    return;
  } catch (err) {
    // Fall back to manually writing keys.env so the next vskill launch can
    // still read the token (the studio looks in both keychain and keys.env).
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const dir = path.join(os.homedir(), ".vskill");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "keys.env");
    let contents = "";
    try { contents = fs.readFileSync(file, "utf-8"); } catch { /* fresh */ }
    // Overwrite both canonical + legacy keys.
    const lines = contents
      .split("\n")
      .filter((l) => !l.startsWith("github-oauth-token=") && !l.startsWith("github_token="));
    lines.push(`github-oauth-token=${token}`);
    lines.push(`github_token=${token}`);
    fs.writeFileSync(file, lines.filter(Boolean).join("\n") + "\n", { mode: 0o600 });
    // Surface the fallback so debugging is easy.
    // eslint-disable-next-line no-console
    console.warn(`[oauth-github] keychain.setGithubToken failed (${(err as Error).message}); wrote ${file} instead`);
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerOauthGithubRoutes(router: Router): void {
  // -------------------------------------------------------------------------
  // POST /api/oauth/github/start
  //
  // Initiates an OAuth flow. Returns the auth URL for the JS to open in the
  // user's browser via Tauri's shell.open (or window.open for the CLI/web
  // path — both are same-origin loopback so the redirect lands back here).
  // -------------------------------------------------------------------------
  router.post("/api/oauth/github/start", async (req, res) => {
    const state = generateState();
    const { verifier, challenge } = generatePkcePair();
    const callbackUrl = buildCallbackUrl(req);

    flows.set(state, {
      verifier,
      expiresAt: Date.now() + STATE_TTL_MS,
      status: "pending",
    });

    const authUrl = new URL(GITHUB_AUTHORIZE_URL);
    authUrl.searchParams.set("client_id", GITHUB_OAUTH_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", callbackUrl);
    authUrl.searchParams.set("scope", REQUESTED_SCOPE);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    // Force GitHub to always show the authorize page (even if previously
    // authorized) — clearer UX when the user is debugging or rotating.
    authUrl.searchParams.set("allow_signup", "true");

    sendJson(res, {
      state,
      authUrl: authUrl.toString(),
      expiresAt: flows.get(state)!.expiresAt,
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/oauth/github/callback?code=...&state=...
  //
  // Browser-driven callback. UNAUTHENTICATED (no X-Studio-Token header) —
  // exempted from the token gate in router.ts. Validates state, exchanges
  // code, persists token, marks the flow as ready, returns success HTML.
  // -------------------------------------------------------------------------
  router.get("/api/oauth/github/callback", async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");
    const errorDesc = url.searchParams.get("error_description");

    if (errorParam) {
      const flow = state ? flows.get(state) : null;
      if (flow) {
        flow.status = "error";
        flow.errorMessage = `${errorParam}${errorDesc ? `: ${errorDesc}` : ""}`;
      }
      respondHtml(res, 400, errorPage(errorParam, errorDesc));
      return;
    }

    if (!code || !state) {
      respondHtml(res, 400, errorPage("missing_params", "code or state not present in callback URL"));
      return;
    }

    const flow = flows.get(state);
    if (!flow) {
      respondHtml(res, 400, errorPage("expired_or_unknown_state",
        "This sign-in attempt expired or was never started. Close this tab and click Sign in again from Skill Studio."));
      return;
    }
    if (flow.expiresAt < Date.now()) {
      flows.delete(state);
      respondHtml(res, 400, errorPage("expired", "This sign-in attempt expired. Try again."));
      return;
    }
    if (flow.status !== "pending") {
      // Already consumed — defensive.
      respondHtml(res, 200, alreadyDonePage());
      return;
    }

    try {
      const callbackUrl = buildCallbackUrl(req);
      const { accessToken } = await exchangeCodeForToken(code, flow.verifier, callbackUrl);
      await persistGithubToken(accessToken);
      const user = await fetchUserProfile(accessToken);
      flow.status = "ready";
      flow.user = user;
      respondHtml(res, 200, successPage(user.login));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      flow.status = "error";
      flow.errorMessage = msg;
      // Log so a CI failure or upstream outage is visible in the sidecar log.
      // eslint-disable-next-line no-console
      console.error("[oauth-github] callback exchange failed:", msg);
      respondHtml(res, 502, errorPage("exchange_failed", msg));
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/oauth/github/status?state=...
  //
  // Poll endpoint for the studio UI. Returns the flow's current status so
  // the React UserDropdown can transition from "Signing in…" to either
  // signed-in or error.
  // -------------------------------------------------------------------------
  router.get("/api/oauth/github/status", async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const state = url.searchParams.get("state");
    if (!state) {
      sendJson(res, { status: "error", error: "missing state" }, 400);
      return;
    }
    const flow = flows.get(state);
    if (!flow) {
      sendJson(res, { status: "expired" }, 200);
      return;
    }
    if (flow.expiresAt < Date.now()) {
      flows.delete(state);
      sendJson(res, { status: "expired" }, 200);
      return;
    }
    if (flow.status === "ready") {
      // Keep the flow around for a few more polls so a slow UI doesn't miss
      // it, but mark it consumed so re-polls keep returning ready.
      sendJson(res, { status: "ready", user: flow.user }, 200);
      return;
    }
    if (flow.status === "error") {
      sendJson(res, { status: "error", error: flow.errorMessage ?? "unknown error" }, 200);
      return;
    }
    sendJson(res, { status: "pending" }, 200);
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/me
  //
  // Returns the current signed-in user, looked up via the cached GitHub
  // token in keychain/keys.env. Used by the studio UI on cold start to
  // restore the signed-in chip without re-running the OAuth flow.
  // -------------------------------------------------------------------------
  router.get("/api/auth/me", async (_req, res) => {
    try {
      const mod = await import("../lib/keychain.js");
      const kc = mod.createKeychain();
      const token = kc.getGitHubToken();
      if (!token) {
        sendJson(res, { signedIn: false }, 200);
        return;
      }
      try {
        const user = await fetchUserProfile(token);
        sendJson(res, { signedIn: true, user }, 200);
      } catch {
        // Token present but invalid/expired — treat as signed-out so the UI
        // doesn't get stuck. The next Sign in click will replace it.
        sendJson(res, { signedIn: false, reason: "token_invalid" }, 200);
      }
    } catch (err) {
      sendJson(res, {
        signedIn: false,
        reason: "keychain_unavailable",
        detail: (err as Error).message,
      }, 200);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/sign-out
  //
  // Deletes the cached GitHub token. The next /api/auth/me will return
  // signedIn=false. Idempotent.
  // -------------------------------------------------------------------------
  router.post("/api/auth/sign-out", async (_req, res) => {
    try {
      const mod = await import("../lib/keychain.js");
      const kc = mod.createKeychain();
      kc.clearGitHubToken();
      sendJson(res, { ok: true }, 200);
    } catch (err) {
      sendJson(res, { ok: false, error: (err as Error).message }, 500);
    }
  });
}

// ---------------------------------------------------------------------------
// HTML responses for the browser-driven callback page
// ---------------------------------------------------------------------------

function respondHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function successPage(login: string): string {
  const safeLogin = String(login).replace(/[<>&"]/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
  }[c]!));
  return `<!doctype html>
<meta charset="utf-8">
<title>Signed in — Skill Studio</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         margin: 0; padding: 2rem; display: grid; place-items: center;
         min-height: 100vh; background: #fafafa; color: #1f2328; }
  .card { max-width: 480px; padding: 2rem 2.5rem; background: white;
          border-radius: 12px; border: 1px solid #d0d7de;
          box-shadow: 0 8px 24px rgba(140,149,159,0.12); text-align: center; }
  h1 { margin: 0 0 0.5rem; font-size: 1.5rem; font-weight: 600; }
  p { margin: 0.5rem 0; line-height: 1.5; color: #57606a; }
  code { background: #f6f8fa; padding: 0.125rem 0.375rem; border-radius: 4px;
         font-family: ui-monospace, SFMono-Regular, monospace; }
  .check { font-size: 3rem; margin-bottom: 1rem; }
</style>
<div class="card">
  <div class="check">✓</div>
  <h1>Signed in as <code>${safeLogin}</code></h1>
  <p>You can close this tab and return to Skill Studio.</p>
</div>
<script>
  // Try to auto-close. macOS Safari may block this; that's OK — the user can close manually.
  setTimeout(() => { window.close(); }, 1500);
</script>`;
}

function alreadyDonePage(): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>Sign-in already completed</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 0; padding: 2rem;
         display: grid; place-items: center; min-height: 100vh;
         background: #fafafa; color: #1f2328; }
  .card { max-width: 480px; padding: 2rem 2.5rem; background: white;
          border-radius: 12px; border: 1px solid #d0d7de; text-align: center; }
</style>
<div class="card">
  <h1>Sign-in already completed</h1>
  <p>You can close this tab.</p>
</div>`;
}

function errorPage(error: string, description?: string | null): string {
  const safe = (s: string | null | undefined) => String(s ?? "")
    .replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
  return `<!doctype html>
<meta charset="utf-8">
<title>Sign-in failed — Skill Studio</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 0; padding: 2rem;
         display: grid; place-items: center; min-height: 100vh;
         background: #fafafa; color: #1f2328; }
  .card { max-width: 520px; padding: 2rem 2.5rem; background: white;
          border-radius: 12px; border: 1px solid #d0d7de;
          box-shadow: 0 8px 24px rgba(140,149,159,0.12); text-align: center; }
  h1 { margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 600; color: #cf222e; }
  p { margin: 0.5rem 0; line-height: 1.5; color: #57606a; }
  pre { background: #f6f8fa; padding: 0.75rem; border-radius: 6px;
        font-family: ui-monospace, monospace; font-size: 0.8125rem;
        text-align: left; overflow: auto; max-height: 200px; }
</style>
<div class="card">
  <h1>Sign-in failed</h1>
  <p><strong>${safe(error)}</strong></p>
  ${description ? `<pre>${safe(description)}</pre>` : ""}
  <p>Close this tab and try Sign in again from Skill Studio.</p>
</div>`;
}
