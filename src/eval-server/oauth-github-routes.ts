// ---------------------------------------------------------------------------
// oauth-github-routes.ts — GitHub OAuth 2.0 Authorization Code flow.
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
//   3. Doing OAuth through the sidecar HTTP layer sidesteps both issues:
//      - JS in the WebView already authenticates to the sidecar via
//        X-Studio-Token (the v1.0.30 fix). All it needs to do is POST/GET.
//      - The browser callback first hits the registered verified-skill.com
//        callback, which owns the GitHub client secret and exchanges the code.
//        It then posts the resulting GitHub token back to the local sidecar.
//
// This mirrors how `claude-code` does it (Claude AI / Anthropic console
// login): localhost HTTP server starts the flow, validates the returning
// state, then stores the token in the OS keychain (with file fallback).
// See `anymodel-umb/repositories/antonoly/claude-code/services/oauth/`.
//
// Flow:
//   1. JS: POST /api/oauth/github/start
//      → server generates random state (CSRF protection)
//      → server stores {state → {expiresAt}} in in-memory map
//      → server returns {state, authUrl}
//   2. JS: window.__TAURI__.shell.open(authUrl)   (no IPC ACL needed —
//      shell:allow-open is in default capabilities)
//   3. User authorizes in their browser → GitHub redirects to the registered
//      verified-skill.com callback, which detects desktop state, exchanges
//      the code using the platform client secret, and form-POSTs the token to
//      http://localhost:<sidecar-port>/api/oauth/github/desktop-complete
//   4. Sidecar desktop-complete handler:
//      → looks up state in map (404 if not found / expired)
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

import { randomBytes } from "node:crypto";
import * as http from "node:http";
import type { Router } from "./router.js";
import { sendJson } from "./router.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Public OAuth App client_id. Matches the value baked into the desktop
// binary at build time (src-tauri/build.rs reads GITHUB_OAUTH_CLIENT_ID env).
// PUBLIC value — no secret protection needed, intentionally hardcoded.
const GITHUB_OAUTH_CLIENT_ID = "Ov23li6H8OpvPfuhyDEt";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_USER_API = "https://api.github.com/user";
const REQUESTED_SCOPE = "repo read:user user:email";
const STATE_TTL_MS = 10 * 60 * 1000;   // 10 minutes — GitHub auth pages
                                        // allow ~15 min before user code expires
const STATE_GC_INTERVAL_MS = 60 * 1000;

// 2026-05-20: GitHub requires redirect_uri to exactly match the OAuth App's
// registered callback. The platform callback detects desktop state values,
// exchanges the code with its confidential client secret, then posts the
// GitHub access token back to the local sidecar.
const DESKTOP_BOUNCE_REDIRECT = "https://verified-skill.com/api/v1/auth/github/callback";

// Allow overriding the bounce URL via env (useful for local platform
// development against http://localhost:3000 etc.).
function getRedirectUri(): string {
  return process.env.VSKILL_OAUTH_BOUNCE_URL || DESKTOP_BOUNCE_REDIRECT;
}

// ---------------------------------------------------------------------------
// In-memory state store
// ---------------------------------------------------------------------------

interface OauthFlowState {
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
// OAuth helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateState(): string {
  return base64UrlEncode(randomBytes(32));   // 43 chars
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The redirect_uri we send to GitHub. This must be the registered platform
 * callback; the platform callback handles the localhost bounce for desktop
 * states after GitHub redirects back to it.
 */
function buildGitHubRedirectUri(_req: http.IncomingMessage): string {
  return getRedirectUri();
}

/**
 * Extract the local sidecar port from the request host header so we can
 * embed it in `state`. The platform bounce-redirect reads the port back
 * out of state and forwards the user's browser to localhost:<port>.
 */
function getLocalPort(req: http.IncomingMessage): number {
  const host = req.headers.host || "";
  const m = host.match(/:(\d+)$/);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0 && n <= 65535) return n;
  }
  // No port in host → default 80. Should never happen for sidecar binds.
  return 80;
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

async function readUrlEncodedBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  const MAX_BODY_SIZE = 64 * 1024;
  const TIMEOUT_MS = 10_000;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("Request body timeout"));
    }, TIMEOUT_MS);
    req.on("data", (chunk: Buffer | string) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        clearTimeout(timer);
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      clearTimeout(timer);
      resolve(new URLSearchParams(Buffer.concat(chunks).toString()));
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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
    // 2026-05-11 Option B: encode the sidecar's local port into state so
    // the verified-skill.com bounce-redirect knows where to forward the
    // user's browser. Format: <random base64url>.<port>. The same state
    // round-trips through GitHub → platform → localhost callback.
    const port = getLocalPort(req);
    const state = `${generateState()}.${port}`;
    const redirectUri = buildGitHubRedirectUri(req);

    flows.set(state, {
      expiresAt: Date.now() + STATE_TTL_MS,
      status: "pending",
    });

    const authUrl = new URL(GITHUB_AUTHORIZE_URL);
    authUrl.searchParams.set("client_id", GITHUB_OAUTH_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", REQUESTED_SCOPE);
    authUrl.searchParams.set("state", state);
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
  // GET /api/oauth/github/callback?error=...&state=...
  //
  // Browser-driven error callback. Success callbacks are now exchanged on the
  // platform and delivered to /desktop-complete so the local sidecar never
  // needs the confidential GitHub client secret.
  // -------------------------------------------------------------------------
  router.get("/api/oauth/github/callback", async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
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

    if (!state) {
      respondHtml(res, 400, errorPage("missing_params", "state not present in callback URL"));
      return;
    }

    const flow = flows.get(state);
    if (flow) {
      flow.status = "error";
      flow.errorMessage = "Outdated platform callback returned a code to the sidecar instead of posting a token.";
    }
    respondHtml(res, 400, errorPage(
      "outdated_callback",
      "Skill Studio received an old callback shape. Click Sign in again so the platform can exchange the code securely.",
    ));
  });

  // -------------------------------------------------------------------------
  // POST /api/oauth/github/desktop-complete
  //
  // Browser-driven completion from verified-skill.com. UNAUTHENTICATED
  // (no X-Studio-Token header) and CSRF-protected by the random in-memory
  // state. The GitHub access token arrives in an application/x-www-form-urlencoded
  // body, not in the URL, so it does not land in browser history.
  // -------------------------------------------------------------------------
  router.post("/api/oauth/github/desktop-complete", async (req, res) => {
    const body = await readUrlEncodedBody(req);
    const state = body.get("state");
    const accessToken = body.get("github_token");

    if (!state || !accessToken) {
      respondHtml(res, 400, errorPage("missing_params", "state or github_token not present in callback body"));
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
      console.error("[oauth-github] desktop completion failed:", msg);
      respondHtml(res, 502, errorPage("completion_failed", msg));
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
