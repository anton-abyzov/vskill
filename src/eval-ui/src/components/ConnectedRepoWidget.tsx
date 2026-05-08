// ---------------------------------------------------------------------------
// 0831 US-004 — ConnectedRepoWidget.
//
// Replaces the old `SidebarGitHubIndicator` with a richer "what repo am I
// connected to?" surface. Renders the repo name (`owner/repo`), current
// branch with a folder icon, sync-state pill (clean / dirty / ahead /
// behind / no-remote), and a private/public lock-or-check pill.
//
// Data feed: `getRepoInfo(folder)` IPC (Tauri side: `get_repo_info`).
// Polling cadence: every 30 seconds while the studio's host window is
// visible. Pauses entirely when `document.visibilityState !== "visible"`
// per AC-US4-07 (no continuous polling). A manual refresh action is
// exposed via the optional `onRefresh` ref-handle for callers that wire
// a button outside the widget.
//
// Auth coupling: the IPC reads the OAuth token from `auth::TokenStore`
// when present (paid users get authenticated rate limits + private-repo
// visibility). When no token, it falls back to unauthenticated GitHub
// API for the visibility lookup — public repos still resolve, private
// repos render with `is_private = null` (neutral icon).
// ---------------------------------------------------------------------------

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

/// Sync state mirror — must match Rust `SyncState` enum's serde shape.
type SyncState =
  | { kind: "clean" }
  | { kind: "dirty"; count: number }
  | { kind: "ahead"; count: number }
  | { kind: "behind"; count: number }
  | { kind: "no_remote" };

/// Mirrors Rust `RepoInfo` exactly. The IPC returns this shape.
export interface RepoInfo {
  /** "owner/repo" — null when the folder isn't a github.com remote. */
  name: string | null;
  /** Current branch — null for detached HEAD. */
  branch: string | null;
  /** GitHub visibility — null when the lookup failed or wasn't possible. */
  is_private: boolean | null;
  /** Sync state from `git status` + `git rev-list`. */
  sync_state: SyncState;
}

interface Props {
  /** Absolute path of the project folder to inspect. */
  folder: string | null;
  /**
   * Override the IPC for tests. Production passes nothing — we read
   * from `window.__TAURI_INTERNALS__.invoke` lazily. Tests inject a
   * mock that returns RepoInfo directly.
   */
  fetchRepoInfo?: (folder: string) => Promise<RepoInfo>;
  /** Refresh poll cadence in ms. Defaults to 30 000. Test overrides. */
  pollIntervalMs?: number;
  /**
   * 0831 T-023: tier of the signed-in user. Drives the private-repo
   * VisibilityPill behavior:
   *   - "free" + private repo  → "Pro" chip with upgrade tooltip;
   *                              clicking the chip opens the pricing page.
   *   - "pro" / "enterprise"   → existing private/public pill rendering.
   * When undefined or null (e.g. signed-out), defaults to "free" so the
   * UI fails closed.
   */
  tier?: "free" | "pro" | "enterprise" | null;
  /**
   * 0831 T-023: callback invoked when the user clicks the upgrade
   * affordance on the private-repo gate. Hosts wire this to
   * `bridge.openExternalUrl(PRICING_URL)`.
   */
  onUpgradeClick?: () => void;
  /**
   * 0831 T-025: callback invoked when a Pro user clicks "Connect private
   * repos" on a private repo where the GitHub App isn't yet installed.
   * Hosts wire this to `bridge.openExternalUrl(GITHUB_APP_INSTALL_URL)`.
   */
  onConnectPrivateClick?: () => void;
}

export interface ConnectedRepoWidgetHandle {
  refresh: () => Promise<void>;
}

const DEFAULT_POLL_MS = 30_000;

interface TauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals;
}

/// Default fetcher — calls the Rust `get_repo_info` IPC. Browser mode
/// (no Tauri internals) returns a synthetic "not-git" shape so the UI
/// can render the empty state without throwing.
async function defaultFetchRepoInfo(folder: string): Promise<RepoInfo> {
  if (typeof window === "undefined") {
    return { name: null, branch: null, is_private: null, sync_state: { kind: "no_remote" } };
  }
  const w = window as TauriWindow;
  const invoke = w.__TAURI_INTERNALS__?.invoke;
  if (!invoke) {
    return { name: null, branch: null, is_private: null, sync_state: { kind: "no_remote" } };
  }
  return invoke("get_repo_info", { folder }) as Promise<RepoInfo>;
}

export const ConnectedRepoWidget = forwardRef<ConnectedRepoWidgetHandle, Props>(
  function ConnectedRepoWidget(
    {
      folder,
      fetchRepoInfo = defaultFetchRepoInfo,
      pollIntervalMs = DEFAULT_POLL_MS,
      tier,
      onUpgradeClick,
      onConnectPrivateClick,
    },
    ref,
  ) {
    // 0831 T-023: normalize tier so unsigned-in users (tier = undefined)
    // hit the same locked-down code path as free users. Fail closed.
    const effectiveTier: "free" | "pro" | "enterprise" =
      tier === "pro" || tier === "enterprise" ? tier : "free";
    const isPaid = effectiveTier !== "free";
    const [info, setInfo] = useState<RepoInfo | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    // Keep the latest fetcher in a ref so the polling effect doesn't
    // reset its timer when the parent re-renders with a new closure.
    const fetcherRef = useRef(fetchRepoInfo);
    fetcherRef.current = fetchRepoInfo;

    const refresh = async (): Promise<void> => {
      if (!folder) {
        setInfo(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const next = await fetcherRef.current(folder);
        setInfo(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        refresh,
      }),
      // refresh closes over folder; reseat the handle whenever folder changes
      // so callers calling .refresh() get the latest path.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [folder],
    );

    // Initial fetch + 30s polling. Pause when the document is hidden so
    // a backgrounded studio doesn't burn the GitHub rate-limit budget.
    useEffect(() => {
      if (!folder) {
        setInfo(null);
        return;
      }
      let cancelled = false;
      let timer: ReturnType<typeof setInterval> | null = null;

      const tick = async (): Promise<void> => {
        if (cancelled) return;
        if (typeof document !== "undefined" && document.visibilityState !== "visible") {
          // Skip this tick; the next visibilitychange will resume.
          return;
        }
        try {
          const next = await fetcherRef.current(folder);
          if (!cancelled) setInfo(next);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
      };

      // Fire once on mount; then settle into the interval cadence.
      void tick();
      timer = setInterval(tick, pollIntervalMs);

      const onVisChange = (): void => {
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          void tick();
        }
      };
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisChange);
      }

      return () => {
        cancelled = true;
        if (timer !== null) clearInterval(timer);
        if (typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", onVisChange);
        }
      };
    }, [folder, pollIntervalMs]);

    if (!folder) {
      return (
        <div data-testid="connected-repo-widget" data-state="empty" style={containerStyle}>
          <span style={{ color: "var(--color-muted, #999)", fontSize: 12 }}>
            No project folder selected
          </span>
        </div>
      );
    }

    if (error) {
      return (
        <div data-testid="connected-repo-widget" data-state="error" style={containerStyle}>
          <span style={{ color: "var(--color-error, #c0392b)", fontSize: 12 }}>
            Couldn't load repo info: {error}
          </span>
        </div>
      );
    }

    if (!info) {
      return (
        <div
          data-testid="connected-repo-widget"
          data-state="loading"
          aria-busy={loading || undefined}
          style={containerStyle}
        >
          <span style={{ color: "var(--color-muted, #999)", fontSize: 12 }}>Loading…</span>
        </div>
      );
    }

    // Not a git project at all — `name` AND sync_state.kind === "no_remote".
    if (!info.name && info.sync_state.kind === "no_remote") {
      return (
        <div data-testid="connected-repo-widget" data-state="not-git" style={containerStyle}>
          <span style={{ color: "var(--color-muted, #999)", fontSize: 12 }}>
            No git remote
          </span>
        </div>
      );
    }

    return (
      <div
        data-testid="connected-repo-widget"
        data-state="connected"
        data-tier={effectiveTier}
        style={containerStyle}
      >
        <span style={repoNameStyle} data-testid="repo-name">
          {info.name ?? "Local-only"}
        </span>
        {info.branch ? (
          <span style={branchPillStyle} data-testid="repo-branch">
            <FolderIcon /> {info.branch}
          </span>
        ) : null}
        <SyncStatePill state={info.sync_state} />
        <TierAwareVisibility
          isPrivate={info.is_private}
          isPaid={isPaid}
          onUpgradeClick={onUpgradeClick}
          onConnectPrivateClick={onConnectPrivateClick}
        />
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// 0831 T-023 + T-025 — tier-aware visibility pill.
//
// Free + private repo  → renders "Private — Pro feature" + upgrade chip.
// Paid + private repo  → renders the standard private pill + "Connect"
//                          CTA when onConnectPrivateClick is wired.
// Public / unknown     → renders the standard pill (no tier impact).
// ---------------------------------------------------------------------------
function TierAwareVisibility({
  isPrivate,
  isPaid,
  onUpgradeClick,
  onConnectPrivateClick,
}: {
  isPrivate: boolean | null;
  isPaid: boolean;
  onUpgradeClick?: () => void;
  onConnectPrivateClick?: () => void;
}): React.ReactElement {
  // Public or unknown → pass through.
  if (isPrivate !== true) {
    return <VisibilityPill isPrivate={isPrivate} />;
  }
  // Private + free → show locked state with "Pro" chip.
  if (!isPaid) {
    return (
      <span
        style={{ ...pillStyle, color: "var(--color-private, #b58900)" }}
        data-testid="visibility-pill"
        data-visibility="private-locked"
        aria-label="Private repository — Pro feature"
      >
        <LockIcon /> private
        <button
          type="button"
          onClick={onUpgradeClick}
          data-testid="repo-upgrade-chip"
          title="Upgrade to enable private repo connections."
          aria-label="Upgrade to Pro for private repository support"
          style={proChipStyle}
        >
          Pro
        </button>
      </span>
    );
  }
  // Private + paid → standard private pill + optional connect CTA.
  return (
    <span
      style={{ ...pillStyle, color: "var(--color-private, #b58900)" }}
      data-testid="visibility-pill"
      data-visibility="private"
      aria-label="Private repository"
    >
      <LockIcon /> private
      {onConnectPrivateClick ? (
        <button
          type="button"
          onClick={onConnectPrivateClick}
          data-testid="repo-connect-private"
          title="Install the verified-skill GitHub App to enable read/write access on this private repo."
          aria-label="Connect private repos via GitHub App"
          style={connectButtonStyle}
        >
          Connect
        </button>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — pure presentational, no side effects.
// ---------------------------------------------------------------------------

function FolderIcon(): React.ReactElement {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ verticalAlign: "middle", marginRight: 4 }}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function LockIcon(): React.ReactElement {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CheckIcon(): React.ReactElement {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function VisibilityPill({ isPrivate }: { isPrivate: boolean | null }): React.ReactElement {
  if (isPrivate === null) {
    // Visibility unknown (rate-limited, network error, or non-GitHub remote).
    // Render a neutral chip so the widget stays balanced.
    return (
      <span
        style={{ ...pillStyle, color: "var(--color-muted, #999)" }}
        data-testid="visibility-pill"
        data-visibility="unknown"
      >
        unknown
      </span>
    );
  }
  if (isPrivate) {
    return (
      <span
        style={{ ...pillStyle, color: "var(--color-private, #b58900)" }}
        data-testid="visibility-pill"
        data-visibility="private"
        aria-label="Private repository"
      >
        <LockIcon /> private
      </span>
    );
  }
  return (
    <span
      style={{ ...pillStyle, color: "var(--color-public, #2aa198)" }}
      data-testid="visibility-pill"
      data-visibility="public"
      aria-label="Public repository"
    >
      <CheckIcon /> public
    </span>
  );
}

function SyncStatePill({ state }: { state: SyncState }): React.ReactElement | null {
  // Don't render an empty chip for clean+synced — absence is healthy.
  if (state.kind === "clean") {
    return (
      <span
        style={{ ...pillStyle, color: "var(--color-clean, #859900)" }}
        data-testid="sync-state-pill"
        data-sync="clean"
      >
        in sync
      </span>
    );
  }
  if (state.kind === "no_remote") {
    return (
      <span
        style={{ ...pillStyle, color: "var(--color-muted, #999)" }}
        data-testid="sync-state-pill"
        data-sync="no_remote"
      >
        no remote
      </span>
    );
  }
  if (state.kind === "dirty") {
    return (
      <span
        style={{ ...pillStyle, color: "var(--color-warn, #cb4b16)" }}
        data-testid="sync-state-pill"
        data-sync="dirty"
        title={`${state.count} uncommitted ${state.count === 1 ? "change" : "changes"}`}
      >
        {state.count} dirty
      </span>
    );
  }
  if (state.kind === "ahead") {
    return (
      <span
        style={{ ...pillStyle, color: "var(--color-ahead, #268bd2)" }}
        data-testid="sync-state-pill"
        data-sync="ahead"
      >
        +{state.count} ahead
      </span>
    );
  }
  // behind
  return (
    <span
      style={{ ...pillStyle, color: "var(--color-behind, #6c71c4)" }}
      data-testid="sync-state-pill"
      data-sync="behind"
    >
      -{state.count} behind
    </span>
  );
}

// ---------------------------------------------------------------------------
// Styles — inline so the widget drops in without requiring a CSS import
// from any specific stylesheet pipeline. Sidebar.tsx already uses inline
// styles for its other badges, so this is consistent.
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
  fontSize: 12,
  fontFamily: "var(--font-system, -apple-system, system-ui)",
};

const repoNameStyle: React.CSSProperties = {
  fontWeight: 500,
  color: "var(--color-text, #333)",
};

const branchPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: "1px 6px",
  borderRadius: 9999,
  background: "var(--color-pill-bg, rgba(0,0,0,0.05))",
  color: "var(--color-text-soft, #555)",
  fontSize: 11,
};

const pillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  padding: "1px 6px",
  borderRadius: 9999,
  background: "var(--color-pill-bg, rgba(0,0,0,0.05))",
  fontSize: 11,
  fontWeight: 500,
};

// 0831 T-023 / T-025 — affordances rendered inside the visibility pill.
const proChipStyle: React.CSSProperties = {
  marginLeft: 4,
  padding: "0px 5px",
  borderRadius: 9999,
  border: "none",
  background: "var(--color-pro-bg, #cb4b16)",
  color: "var(--color-pro-fg, #ffffff)",
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  cursor: "pointer",
  fontFamily: "inherit",
};

const connectButtonStyle: React.CSSProperties = {
  marginLeft: 4,
  padding: "0px 6px",
  borderRadius: 9999,
  border: "1px solid currentColor",
  background: "transparent",
  color: "inherit",
  fontSize: 10,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};
