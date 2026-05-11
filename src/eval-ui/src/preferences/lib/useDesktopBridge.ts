import { useCallback, useEffect, useMemo, useState } from "react";

export type BridgeMode = "desktop" | "browser";

export class BrowserModeError extends Error {
  constructor(feature: string) {
    super(`${feature} is not available in browser mode — install the Skill Studio desktop app.`);
    this.name = "BrowserModeError";
  }
}

export interface SettingsSnapshot {
  version: number;
  general: {
    theme: "system" | "light" | "dark";
    language: string;
    defaultProjectFolder: string | null;
    launchAtLogin: boolean;
  };
  updates: {
    channel: "stable" | "beta";
    autoCheck: boolean;
    lastCheckedAt: string | null;
    lastKnownVersion: string | null;
    skippedVersion: string | null;
    snoozedUntil: string | null;
  };
  privacy: {
    telemetryEnabled: boolean;
    crashReportingEnabled: boolean;
  };
  advanced: {
    logLevel: "error" | "warn" | "info" | "debug" | "trace";
  };
  // 0832: studio process-lifecycle defaults.
  studio: {
    lifecycleDefault:
      | "ask"
      | "use-existing"
      | "stop-and-replace"
      | "run-alongside";
  };
}

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export interface AppMetadata {
  version: string;
  build: string;
  commit: string;
  target: string;
  arch: string;
}

// ---------------------------------------------------------------------------
// 0831 auth — GitHub OAuth device-flow + sign-out wrappers.
// Owned by desktop-auth-agent. Browser mode rejects all four with
// BrowserModeError — no localStorage shadow because the OAuth token must
// live in the OS credential vault (which we don't have outside the
// desktop shell).
// ---------------------------------------------------------------------------

export interface DeviceFlowStartResponse {
  /** Short user code displayed in the UI (e.g. "WDJB-MJHT"). */
  userCode: string;
  /** Verification URL — typically `https://github.com/login/device`. */
  verificationUri: string;
  /** Polling interval in seconds returned by GitHub. */
  interval: number;
  /** Device-code TTL in seconds; UI uses this to time out the dialog. */
  expiresIn: number;
}

export interface SignedInUser {
  /** GitHub login (e.g. "octocat"). */
  login: string;
  /** Avatar URL — render in `<img>` directly, no proxy. */
  avatar_url: string;
  /** Public email if exposed by GitHub; null on most accounts. */
  email: string | null;
  /** ISO-8601 timestamp of when the cache was refreshed. */
  cached_at: string | null;
}

/**
 * Tagged-union for the poll IPC. The Rust side returns `Err(string)` for
 * every non-success state (`"pending"`, `"slow_down:<n>"`, `"denied"`,
 * `"expired"`, `"no-flow"`, or a free-form network/parse error). The
 * bridge converts these to a structured `PollGithubDeviceFlowOutcome` so
 * the UI can switch on a discriminator instead of regex-matching strings.
 */
export type PollGithubDeviceFlowOutcome =
  | { status: "granted"; user: SignedInUser }
  | { status: "pending" }
  | { status: "slow_down"; newInterval: number }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "no-flow" }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// 0831 folders — typed shapes for `pick_default_project_folder` (extended)
// and `get_repo_info`. Owned by desktop-folder-agent.
// ---------------------------------------------------------------------------

/**
 * Classification of a folder per ADR-0831-03's ordered ruleset. Mirrors the
 * Rust `FolderClassification` enum 1:1.
 */
export type FolderClassification =
  | { kind: "home_root" }
  | { kind: "personal_scope" }
  | { kind: "project_root"; has_git: boolean; remote_url: string | null }
  | { kind: "unclassified" };

/** Result of `pick_default_project_folder` — null when user cancelled. */
export interface PickedFolder {
  path: string;
  classification: FolderClassification;
}

/** Sync state of a working copy — mirrors Rust `SyncState`. */
export type RepoSyncState =
  | { kind: "clean" }
  | { kind: "dirty"; count: number }
  | { kind: "ahead"; count: number }
  | { kind: "behind"; count: number }
  | { kind: "no_remote" };

/** Output of `get_repo_info` — drives the ConnectedRepoWidget. */
export interface RepoInfo {
  /** "owner/repo" — null when the folder isn't a github.com remote. */
  name: string | null;
  /** Current branch — null for detached HEAD. */
  branch: string | null;
  /** GitHub visibility — null when the lookup failed or wasn't possible. */
  is_private: boolean | null;
  /** Sync state from `git status` + `git rev-list`. */
  sync_state: RepoSyncState;
}

// ---------------------------------------------------------------------------
// 0831 quota — typed shapes for the quota IPCs.
// Owned by desktop-quota-agent. Mirror of `vskill-platform/src/lib/billing/
// quota-shape.ts::QuotaResponse` — duplicated per coordination contract so
// the desktop doesn't import from the platform repo.
// ---------------------------------------------------------------------------

/** Lower-cased tier strings — wire format from the platform. */
export type QuotaTierWire = "free" | "pro" | "enterprise";

/** Mirror of the platform's `QuotaResponse` shape. */
export interface QuotaResponse {
  tier: QuotaTierWire;
  /** Authoritative skill count (server-side). */
  skillCount: number;
  /** `50` for free; `null` (unlimited) for pro/enterprise. */
  skillLimit: number | null;
  /** ISO-8601 last-sync timestamp; `null` on first sync. */
  lastSyncedAt: string | null;
  /** Days the desktop should treat the cache as fresh. */
  gracePeriodDaysRemaining: number;
  /** ISO-8601 UTC server clock at response time — basis for skew correction. */
  serverNow: string;
}

/** Mirror of Rust `quota::cache::QuotaCache`. */
export interface QuotaCache {
  response: QuotaResponse;
  /** Local clock at sync time, ISO-8601. */
  localAtSync: string;
  /** Computed `local - server` delta in milliseconds. */
  clockSkewMs: number;
}

/** Mirror of Rust `commands::QuotaSnapshot`. */
export interface QuotaSnapshot {
  /** Cached server response, or null when no sync has happened. */
  cache: QuotaCache | null;
  /** Locally-counted skill total (independent of the server's count). */
  localSkillCount: number;
  /** Whether the cache is within the offline grace window. */
  isFresh: boolean;
  /** Days remaining inside the grace window. Negative = stale. */
  daysRemaining: number;
}

export interface QuotaCanCreateResult {
  /** Whether the create should be hard-blocked client-side. */
  blocked: boolean;
  /** "ok" | "limit-reached" | "no-cache-and-signed-out". */
  reason: string;
  /** Snapshot the UI uses to render paywall context. */
  snapshot: QuotaSnapshot;
}

export interface DesktopBridge {
  mode: BridgeMode;
  available: boolean;
  getSettings: () => Promise<SettingsSnapshot>;
  setSetting: (path: string, value: unknown) => Promise<void>;
  resetSettings: () => Promise<void>;
  checkForUpdates: () => Promise<UpdateInfo>;
  downloadAndInstallUpdate: (
    onProgress?: (chunk: number, total: number | null) => void,
  ) => Promise<void>;
  cancelUpdate: () => Promise<void>;
  openPreferences: (tab?: string) => Promise<void>;
  getAppMetadata: () => Promise<AppMetadata>;
  setAutostart: (enabled: boolean) => Promise<void>;
  pickFolder: () => Promise<string | null>;
  openLogsFolder: () => Promise<void>;
  revealSettingsFile: () => Promise<void>;
  copyToClipboard: (text: string) => Promise<void>;
  // 0831 auth — GitHub OAuth device-flow + identity cache reads.
  // All four reject with BrowserModeError outside the desktop shell.
  startGithubDeviceFlow: () => Promise<DeviceFlowStartResponse>;
  pollGithubDeviceFlow: () => Promise<PollGithubDeviceFlowOutcome>;
  getSignedInUser: () => Promise<SignedInUser | null>;
  signOut: () => Promise<void>;
  // 0831 folders — appended at END per coordination contract.
  /** Like `pickFolder()` but returns the full `{path, classification}` shape. */
  pickProjectFolder: () => Promise<PickedFolder | null>;
  /** Read git remote + sync state + GitHub visibility for `folder`. */
  getRepoInfo: (folder: string) => Promise<RepoInfo>;
  // 0831 quota — typed wrappers. Owned by desktop-quota-agent. Browser mode
  // returns a synthetic "signed-out" snapshot rather than throwing so the
  // hosted studio renders cleanly without a try/catch.
  /** Read disk-backed cache + locally-counted skill total. No network. */
  quotaGet: (projectRoots: string[]) => Promise<QuotaSnapshot>;
  /**
   * On-demand refresh. `fresh=true` busts the platform's KV cache via
   * `?fresh=1` — used by the paywall race-resolution path so a "user just
   * upgraded" doesn't see a stale Free response.
   */
  quotaForceSync: (
    projectRoots: string[],
    fresh: boolean,
  ) => Promise<QuotaSnapshot>;
  /** Pre-create gate. UI uses `blocked` to short-circuit into the paywall. */
  quotaCanCreateSkill: (projectRoots: string[]) => Promise<QuotaCanCreateResult>;
  /** Best-effort POST telemetry of the local count. Never throws on auth. */
  quotaReportCount: (skillCount: number) => Promise<void>;
  /** Open a https:// URL in the user's default browser. */
  openExternalUrl: (url: string) => Promise<void>;
  /** Re-fetch /user from GitHub and update the identity cache. */
  refreshUserIdentity: () => Promise<SignedInUser | null>;
}

interface TauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals;
}

function detectMode(): BridgeMode {
  if (typeof window === "undefined") return "browser";
  return "__TAURI_INTERNALS__" in window ? "desktop" : "browser";
}

const BROWSER_DEFAULTS: SettingsSnapshot = {
  version: 1,
  general: {
    theme: "system",
    language: "auto",
    defaultProjectFolder: null,
    launchAtLogin: false,
  },
  updates: {
    channel: "stable",
    autoCheck: true,
    lastCheckedAt: null,
    lastKnownVersion: null,
    skippedVersion: null,
    snoozedUntil: null,
  },
  privacy: {
    telemetryEnabled: false,
    crashReportingEnabled: false,
  },
  advanced: {
    logLevel: "info",
  },
  studio: {
    lifecycleDefault: "ask",
  },
};

const BROWSER_STORAGE_KEY = "vskill:preferences:browser-shadow";

function loadBrowserShadow(): SettingsSnapshot {
  try {
    const raw = localStorage.getItem(BROWSER_STORAGE_KEY);
    if (!raw) return structuredClone(BROWSER_DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<SettingsSnapshot>;
    return { ...BROWSER_DEFAULTS, ...parsed } as SettingsSnapshot;
  } catch {
    return structuredClone(BROWSER_DEFAULTS);
  }
}

function saveBrowserShadow(snapshot: SettingsSnapshot): void {
  try {
    localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* private browsing — silent */
  }
}

function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = window as TauriWindow;
  const invoke = w.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new BrowserModeError(cmd);
  return invoke(cmd, args) as Promise<T>;
}

export function useDesktopBridge(): DesktopBridge {
  const [mode] = useState<BridgeMode>(() => detectMode());

  const bridge = useMemo<DesktopBridge>(() => {
    const available = mode === "desktop";

    const getSettings: DesktopBridge["getSettings"] = async () => {
      if (!available) return loadBrowserShadow();
      return tauriInvoke<SettingsSnapshot>("get_settings");
    };

    const setSetting: DesktopBridge["setSetting"] = async (path, value) => {
      if (!available) {
        const snapshot = loadBrowserShadow();
        setNested(snapshot as unknown as Record<string, unknown>, path, value);
        saveBrowserShadow(snapshot);
        window.dispatchEvent(
          new CustomEvent("preferences-shadow-updated", { detail: { path, value } }),
        );
        return;
      }
      // Rust handler signature: `set_setting(key: String, value: Value)`.
      // The Tauri IPC bridge serializes args by parameter NAME — sending
      // `{ path }` instead of `{ key }` makes the call fail deserialization
      // silently in v1.0.12 and the snapshot never refreshes.
      await tauriInvoke<void>("set_setting", { key: path, value });
    };

    const resetSettings: DesktopBridge["resetSettings"] = async () => {
      if (!available) {
        try {
          localStorage.removeItem(BROWSER_STORAGE_KEY);
        } catch {
          /* private browsing — silent */
        }
        window.dispatchEvent(new CustomEvent("preferences-shadow-reset"));
        return;
      }
      await tauriInvoke<void>("reset_settings");
    };

    const checkForUpdates: DesktopBridge["checkForUpdates"] = async () => {
      if (!available) throw new BrowserModeError("checkForUpdates");
      return tauriInvoke<UpdateInfo>("check_for_updates");
    };

    const downloadAndInstallUpdate: DesktopBridge["downloadAndInstallUpdate"] = async () => {
      if (!available) throw new BrowserModeError("downloadAndInstallUpdate");
      await tauriInvoke<void>("download_and_install_update");
    };

    const cancelUpdate: DesktopBridge["cancelUpdate"] = async () => {
      if (!available) throw new BrowserModeError("cancelUpdate");
      await tauriInvoke<void>("cancel_update");
    };

    const openPreferences: DesktopBridge["openPreferences"] = async (tab) => {
      if (!available) {
        if (tab) window.location.hash = `#${tab}`;
        return;
      }
      await tauriInvoke<void>("open_preferences", { tab: tab ?? null });
    };

    const getAppMetadata: DesktopBridge["getAppMetadata"] = async () => {
      if (!available) {
        return {
          version: "browser",
          build: "n/a",
          commit: "n/a",
          target: navigator.platform || "browser",
          arch: "n/a",
        };
      }
      return tauriInvoke<AppMetadata>("get_app_metadata");
    };

    const setAutostart: DesktopBridge["setAutostart"] = async (enabled) => {
      if (!available) throw new BrowserModeError("setAutostart");
      await tauriInvoke<void>("set_autostart", { enabled });
    };

    const pickFolder: DesktopBridge["pickFolder"] = async () => {
      if (!available) throw new BrowserModeError("pickFolder");
      // 0831: the Rust IPC return shape changed from `Option<String>` to
      // `Option<{path, classification}>`. Existing callers (GeneralTab)
      // only need the path string — we extract `.path` here so they
      // don't have to change. The richer `pickProjectFolder()` wrapper
      // (added below) returns the full shape for callers that want to
      // fire the warning modal on home-root / personal-scope picks.
      const raw = await tauriInvoke<PickedFolder | null>("pick_default_project_folder");
      return raw?.path ?? null;
    };

    const openLogsFolder: DesktopBridge["openLogsFolder"] = async () => {
      if (!available) throw new BrowserModeError("openLogsFolder");
      await tauriInvoke<void>("open_logs_folder");
    };

    const revealSettingsFile: DesktopBridge["revealSettingsFile"] = async () => {
      if (!available) throw new BrowserModeError("revealSettingsFile");
      await tauriInvoke<void>("reveal_settings_file");
    };

    const copyToClipboard: DesktopBridge["copyToClipboard"] = async (text) => {
      // No `copy_settings_path` Rust handler exists, and the clipboard plugin
      // is not enabled in src-tauri/Cargo.toml. The web Clipboard API works
      // inside the Tauri 2 webview and in the browser, so use it everywhere.
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* clipboard denied — silent; UI shows generic toast */
      }
    };

    // -------------------------------------------------------------------
    // 0831 auth — GitHub OAuth wrappers. Browser mode rejects with
    // BrowserModeError because the OAuth token must live in the OS
    // credential vault, which only exists inside the Tauri shell.
    // -------------------------------------------------------------------

    /**
     * Rust IPC payload — Rust returns camelCase for `start_github_device_flow`
     * and snake_case for `get_signed_in_user`. We translate both at the
     * bridge boundary so the UI sees a single normalized shape.
     */
    interface RawDeviceFlowStart {
      userCode: string;
      verificationUri: string;
      interval: number;
      expiresIn: number;
    }

    // 2026-05-11 — start_github_device_flow IPC superseded by sidecar HTTP
    // OAuth Authorization Code + PKCE flow. Why:
    //   1. Tauri 2.x ACL was rejecting the device-flow IPC at runtime (the
    //      build.rs doesn't register the app's commands via
    //      Attributes::app_manifest, so allowed_commands stays empty even
    //      with a correct permission TOML — see the tauri-desktop-release
    //      skill for the full deep-dive).
    //   2. The vskill OAuth App at github.com/settings/developers has
    //      Device Flow DISABLED, so even when ACL was fixed the GitHub call
    //      would have returned device_flow_disabled.
    // The new flow:
    //   - POST /api/oauth/github/start  → returns auth URL with PKCE challenge
    //   - User opens URL in browser (caller does the open via tauri shell)
    //   - GitHub redirects to /api/oauth/github/callback on the SAME sidecar
    //   - Sidecar exchanges code, stores token via keychain.setGitHubToken
    //   - Caller polls /api/oauth/github/status until "ready"
    // The response shape stays {userCode, verificationUri, interval, expiresIn}
    // for backward-compatibility with UserDropdown's signature, but the
    // semantics are different — `verificationUri` is now the authorization
    // URL the caller must open in the browser, and `userCode` is the flow
    // `state` token (caller polls /status?state=<userCode>).
    const startGithubDeviceFlow: DesktopBridge["startGithubDeviceFlow"] = async () => {
      const res = await fetch("/api/oauth/github/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OAuth start failed: HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        state: string;
        authUrl: string;
        expiresAt: number;
      };
      return {
        userCode: data.state,           // Reused: state token = poll key
        verificationUri: data.authUrl,  // Reused: the URL to open
        interval: 2,                    // 2s poll cadence
        expiresIn: Math.max(60, Math.floor((data.expiresAt - Date.now()) / 1000)),
      };
    };

    /**
     * Single poll iteration. The Rust handler returns `Err(string)` for
     * every non-granted state — we catch that here and translate the
     * string code into a structured outcome the UI can switch on.
     *
     * Rust error code → outcome:
     *   "pending"        → { status: "pending" }
     *   "slow_down:<n>"  → { status: "slow_down", newInterval: <n> }
     *   "denied"         → { status: "denied" }
     *   "expired"        → { status: "expired" }
     *   "no-flow"        → { status: "no-flow" }
     *   anything else    → { status: "error", message }
     */
    // 2026-05-11 — pollGithubDeviceFlow polls the sidecar's HTTP status
    // endpoint instead of the Tauri IPC poll (same reason as start above —
    // Tauri ACL + GitHub Device Flow disabled both blocked the IPC path).
    // The `state` token from start() is stashed in a module-scoped var so
    // poll() can reuse it without changing the bridge interface.
    const pollGithubDeviceFlow: DesktopBridge["pollGithubDeviceFlow"] = async () => {
      const state = (window as { __vskillOauthState?: string }).__vskillOauthState;
      if (!state) {
        return { status: "error", message: "no OAuth flow in progress" };
      }
      try {
        const res = await fetch(
          `/api/oauth/github/status?state=${encodeURIComponent(state)}`,
        );
        if (!res.ok) {
          return { status: "error", message: `HTTP ${res.status}` };
        }
        const data = (await res.json()) as {
          status: string;
          user?: SignedInUser;
          error?: string;
        };
        if (data.status === "ready" && data.user) {
          return { status: "granted", user: data.user };
        }
        if (data.status === "pending") return { status: "pending" };
        if (data.status === "expired") return { status: "expired" };
        if (data.status === "error") {
          return { status: "error", message: data.error ?? "unknown" };
        }
        return { status: "pending" };
      } catch (err) {
        return { status: "error", message: err instanceof Error ? err.message : String(err) };
      }
    };

    // 2026-05-11 — getSignedInUser reads /api/auth/me via HTTP. Works in
    // both Tauri WebView AND browser mode (npx vskill studio). The sidecar
    // looks up the cached token via keychain.getGitHubToken() and calls
    // GitHub /user to validate. Returns null when no valid token exists.
    const getSignedInUser: DesktopBridge["getSignedInUser"] = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return null;
        const data = (await res.json()) as {
          signedIn: boolean;
          user?: SignedInUser;
        };
        return data.signedIn && data.user ? data.user : null;
      } catch {
        return null;
      }
    };

    // 2026-05-11 — signOut hits HTTP /api/auth/sign-out which clears the
    // GitHub token via keychain.clearGitHubToken().
    const signOut: DesktopBridge["signOut"] = async () => {
      await fetch("/api/auth/sign-out", { method: "POST" });
    };

    // -------------------------------------------------------------------
    // 0831 folders — owner: desktop-folder-agent.
    // Appended at END per agent-coordination ADD-not-REPLACE contract so
    // diffs from concurrent agents remain additive instead of conflicting.
    // -------------------------------------------------------------------

    /**
     * Like `pickFolder()` but returns the full `{path, classification}`
     * shape. Use this when the caller needs to fire the
     * FolderPickerWarning modal on home-root or personal-scope picks.
     * Browser mode rejects with BrowserModeError — there's no native
     * folder picker available outside the Tauri shell.
     */
    const pickProjectFolder: DesktopBridge["pickProjectFolder"] = async () => {
      if (!available) throw new BrowserModeError("pickProjectFolder");
      const raw = await tauriInvoke<PickedFolder | null>("pick_default_project_folder");
      return raw ?? null;
    };

    /**
     * Read git remote + sync state + GitHub visibility for `folder`. The
     * Rust IPC handles the OAuth-token lookup and falls back to
     * unauthenticated GitHub API for free / signed-out users. Browser
     * mode returns a synthetic "not-git" shape so the UI's empty state
     * renders without throwing.
     */
    const getRepoInfo: DesktopBridge["getRepoInfo"] = async (folder) => {
      if (!available) {
        return {
          name: null,
          branch: null,
          is_private: null,
          sync_state: { kind: "no_remote" },
        };
      }
      return tauriInvoke<RepoInfo>("get_repo_info", { folder });
    };

    // -------------------------------------------------------------------
    // 0831 quota — owner: desktop-quota-agent.
    // Appended at END per agent-coordination ADD-not-REPLACE contract.
    // -------------------------------------------------------------------

    const SIGNED_OUT_SNAPSHOT: QuotaSnapshot = {
      cache: null,
      localSkillCount: 0,
      isFresh: false,
      daysRemaining: 0,
    };

    const quotaGet: DesktopBridge["quotaGet"] = async (projectRoots) => {
      if (!available) return { ...SIGNED_OUT_SNAPSHOT };
      const raw = await tauriInvoke<QuotaSnapshot>("quota_get", {
        projectRoots,
      });
      return raw;
    };

    const quotaForceSync: DesktopBridge["quotaForceSync"] = async (
      projectRoots,
      fresh,
    ) => {
      if (!available) return { ...SIGNED_OUT_SNAPSHOT };
      const raw = await tauriInvoke<QuotaSnapshot>("quota_force_sync", {
        projectRoots,
        fresh,
      });
      return raw;
    };

    const quotaCanCreateSkill: DesktopBridge["quotaCanCreateSkill"] = async (
      projectRoots,
    ) => {
      if (!available) {
        // Browser mode never enforces — the hosted studio uses platform-side
        // gates. Return an "ok" verdict with a synthetic snapshot.
        return {
          blocked: false,
          reason: "browser-mode",
          snapshot: { ...SIGNED_OUT_SNAPSHOT },
        };
      }
      return tauriInvoke<QuotaCanCreateResult>("quota_can_create_skill", {
        projectRoots,
      });
    };

    const quotaReportCount: DesktopBridge["quotaReportCount"] = async (
      skillCount,
    ) => {
      if (!available) return;
      try {
        await tauriInvoke<void>("quota_report_count", { skillCount });
      } catch (err) {
        // Non-blocking telemetry — log but don't surface.
        // eslint-disable-next-line no-console
        console.warn("quotaReportCount failed:", err);
      }
    };

    const openExternalUrl: DesktopBridge["openExternalUrl"] = async (url) => {
      if (!available) {
        // Browser mode: open in a new tab via window.open. No-op in SSR.
        if (typeof window !== "undefined") {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      await tauriInvoke<void>("open_external_url", { url });
    };

    const refreshUserIdentity: DesktopBridge["refreshUserIdentity"] = async () => {
      if (!available) return null;
      const raw = await tauriInvoke<SignedInUser | null>(
        "refresh_user_identity",
      );
      return raw ?? null;
    };

    return {
      mode,
      available,
      getSettings,
      setSetting,
      resetSettings,
      checkForUpdates,
      downloadAndInstallUpdate,
      cancelUpdate,
      openPreferences,
      getAppMetadata,
      setAutostart,
      pickFolder,
      openLogsFolder,
      revealSettingsFile,
      copyToClipboard,
      startGithubDeviceFlow,
      pollGithubDeviceFlow,
      getSignedInUser,
      signOut,
      // 0831 folders — appended LAST.
      pickProjectFolder,
      getRepoInfo,
      // 0831 quota — appended LAST per agent-coordination contract.
      quotaGet,
      quotaForceSync,
      quotaCanCreateSkill,
      quotaReportCount,
      openExternalUrl,
      refreshUserIdentity,
    };
  }, [mode]);

  return bridge;
}

export function useSettingsSnapshot(bridge: DesktopBridge) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await bridge.getSettings();
      setSnapshot(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await bridge.getSettings();
        if (!cancelled) {
          setSnapshot(next);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("preferences-shadow-updated", handler);
    window.addEventListener("preferences-shadow-reset", handler);
    return () => {
      window.removeEventListener("preferences-shadow-updated", handler);
      window.removeEventListener("preferences-shadow-reset", handler);
    };
  }, [refresh]);

  return { snapshot, error, loading, refresh };
}
