import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useDesktopBridge,
  type DeviceFlowStartResponse,
  type SignedInUser,
} from "../preferences/lib/useDesktopBridge";

/**
 * 0831 US-001 / US-002 — top-rail user dropdown.
 *
 * Two render modes driven by the cached identity:
 *   1. Signed-out: "Sign in with GitHub" pill. Click triggers
 *      `startGithubDeviceFlow`, opens a small dialog with the user_code +
 *      verification URL, and starts a polling loop calling
 *      `pollGithubDeviceFlow` every `interval` seconds.
 *   2. Signed-in: avatar + login chip. Click reveals a dropdown menu with
 *      "View on GitHub" (opens the user's profile in a browser) and
 *      "Sign out" (calls `signOut` IPC and resets state).
 *
 * Browser mode (no Tauri shell) renders nothing — the dropdown is a
 * desktop-only feature because the OAuth token must live in the OS
 * credential vault.
 *
 * Coordination notes:
 *   - This file is owned by desktop-auth-agent. Other agents adding
 *     adjacent top-rail surface should mount as siblings, not as edits to
 *     this component.
 *   - The polling loop is intentionally reentrant-safe: a "Cancel" press
 *     drops the loop's pending tick on the floor (state.aborted = true);
 *     no setTimeout to clear because we use a ref + while-condition.
 *   - The mount path puts this component inside TopRail's right-hand
 *     "session status" group, immediately to the right of UpdateBell —
 *     wired through a new `userDropdownSlot` prop in TopRail.
 */
export function UserDropdown() {
  const bridge = useDesktopBridge();
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signInDialog, setSignInDialog] = useState<DeviceFlowStartResponse | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  // Abort flag for the polling loop. We use a ref instead of state so the
  // loop body sees the latest value across re-renders without a closure
  // capture stale-read bug.
  const abortRef = useRef(false);

  // Cold-start identity load. If `getSignedInUser` returns a cached
  // identity, the chip shows the user before any /user round-trip — this
  // is the cache-first path described in token_store.rs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await bridge.getSignedInUser();
        if (!cancelled) setUser(cached);
      } catch {
        // Read errors are non-fatal — user just sees signed-out state.
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  // Close the dropdown menu when clicking outside or pressing Escape.
  // Both are required by the WAI-ARIA menu pattern; without them the menu
  // gets stuck open when the user clicks the avatar's neighbor.
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const handleSignIn = useCallback(async () => {
    setSignInError(null);
    setSigningIn(true);
    abortRef.current = false;
    // Local error tracking — `signInError` from closure is stale after
    // setSignInError() because state updates are async. Tracking locally
    // also lets us decide between "expired naturally because the loop
    // exited" vs "exited because we wrote a real error" without re-reading
    // React state.
    let localError: string | null = null;
    const writeError = (msg: string) => {
      localError = msg;
      setSignInError(msg);
    };
    try {
      const flow = await bridge.startGithubDeviceFlow();
      setSignInDialog(flow);
      // Drive the polling loop. We sleep `interval` seconds between calls
      // and honor `slow_down:N` by bumping the interval. Loop exits on
      // granted, denied, expired, error, or user cancel (abortRef).
      let intervalSeconds = Math.max(1, flow.interval);
      const expiresAt = Date.now() + flow.expiresIn * 1000;
      // Initial sleep before first poll: GitHub guarantees the device_code
      // is registered server-side after the device-code response, but the
      // user hasn't typed anything yet. Sleeping the full interval before
      // the first poll matches what `gh auth login` does.
      while (!abortRef.current && Date.now() < expiresAt) {
        await sleep(intervalSeconds * 1000, () => abortRef.current);
        if (abortRef.current) break;
        const outcome = await bridge.pollGithubDeviceFlow();
        if (outcome.status === "granted") {
          setUser(outcome.user);
          setSignInDialog(null);
          setSigningIn(false);
          return;
        }
        if (outcome.status === "pending") continue;
        if (outcome.status === "slow_down") {
          intervalSeconds = Math.max(intervalSeconds + 1, outcome.newInterval);
          continue;
        }
        if (outcome.status === "denied") {
          writeError("Sign-in was denied at GitHub. You can try again.");
          break;
        }
        if (outcome.status === "expired") {
          writeError("Sign-in code expired. Try again to get a fresh code.");
          break;
        }
        if (outcome.status === "no-flow") {
          // Edge case: the Rust state was cleared (app restarted mid-flow).
          // Reset and let the user click "Sign in with GitHub" again.
          writeError("Sign-in state lost. Please retry.");
          break;
        }
        // status === "error"
        writeError(outcome.message);
        break;
      }
      // Loop exited without setting an error AND without granting — the
      // device_code expired naturally (Date.now() >= expiresAt).
      if (!abortRef.current && !localError) {
        writeError("Sign-in code expired. Try again to get a fresh code.");
      }
    } catch (err) {
      writeError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigningIn(false);
    }
    // We deliberately leave `signInDialog` set to non-null on error so the
    // user can still see the code + retry button. They cancel by clicking
    // Cancel which clears the dialog.
  }, [bridge]);

  const handleCancelSignIn = useCallback(() => {
    abortRef.current = true;
    setSignInDialog(null);
    setSignInError(null);
    setSigningIn(false);
  }, []);

  const handleSignOut = useCallback(async () => {
    setMenuOpen(false);
    try {
      await bridge.signOut();
    } catch (err) {
      // Sign-out errors are reported to console but the local state still
      // resets (the Rust handler is idempotent and best-effort).
      console.warn("sign-out:", err);
    }
    setUser(null);
  }, [bridge]);

  const userCodeFormatted = useMemo(() => {
    if (!signInDialog) return null;
    return signInDialog.userCode;
  }, [signInDialog]);

  // Browser mode: render nothing. The whole feature is desktop-only.
  if (!bridge.available) return null;

  // While we're still reading the cache on cold start, render an inert
  // placeholder so the top-rail layout doesn't shift when the chip
  // resolves a moment later. Width matches the signed-in chip roughly.
  if (loadingInitial) {
    return <div data-slot="user-dropdown-placeholder" style={{ width: 28, height: 28 }} />;
  }

  if (!user) {
    return (
      <div data-slot="user-dropdown" style={{ position: "relative" }} ref={dropdownRef}>
        <button
          type="button"
          data-slot="sign-in-button"
          onClick={handleSignIn}
          disabled={signingIn}
          aria-label="Sign in with GitHub"
          title="Sign in with GitHub"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            padding: "0 10px",
            borderRadius: 6,
            border: "1px solid var(--border-default)",
            background: "var(--surface-1, transparent)",
            color: "var(--text-primary)",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            cursor: signingIn ? "wait" : "pointer",
          }}
        >
          <GithubMark size={14} />
          {signingIn ? "Signing in…" : "Sign in"}
        </button>
        {signInDialog && (
          <SignInDialog
            response={signInDialog}
            error={signInError}
            userCode={userCodeFormatted}
            onCancel={handleCancelSignIn}
            onRetry={handleSignIn}
          />
        )}
      </div>
    );
  }

  return (
    <div data-slot="user-dropdown" style={{ position: "relative" }} ref={dropdownRef}>
      <button
        type="button"
        data-slot="user-chip"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={`Signed in as ${user.login}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`Signed in as ${user.login}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 6px 0 4px",
          borderRadius: 14,
          border: "1px solid var(--border-default)",
          background: "var(--surface-1, transparent)",
          color: "var(--text-primary)",
          fontSize: 12,
          fontFamily: "var(--font-sans)",
          cursor: "pointer",
        }}
      >
        <img
          src={user.avatar_url}
          alt=""
          width={20}
          height={20}
          style={{ borderRadius: "50%", display: "block" }}
        />
        <span style={{ maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {user.login}
        </span>
      </button>
      {menuOpen && (
        <div
          role="menu"
          data-slot="user-menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 180,
            background: "var(--surface-2, #1a1d22)",
            border: "1px solid var(--border-default)",
            borderRadius: 8,
            padding: 4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.32)",
            zIndex: 50,
          }}
        >
          <MenuItem
            label="View on GitHub"
            onClick={() => {
              window.open(`https://github.com/${user.login}`, "_blank", "noopener,noreferrer");
              setMenuOpen(false);
            }}
          />
          <MenuItem label="Sign out" onClick={handleSignOut} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SignInDialog — small popover anchored to the sign-in button. Shows the
// user_code in a copyable mono font + "Open GitHub to authorize" + Cancel.
// Polling state (the spinner) is implicit: while the dialog is up and there
// is no error, we are polling.
// ---------------------------------------------------------------------------

function SignInDialog({
  response,
  error,
  userCode,
  onCancel,
  onRetry,
}: {
  response: DeviceFlowStartResponse;
  error: string | null;
  userCode: string | null;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const handleCopy = useCallback(async () => {
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
    } catch {
      // Clipboard denied (private mode, headless test) — silent fallback.
    }
  }, [userCode]);

  const handleOpenGithub = useCallback(() => {
    // The Tauri `start_github_device_flow` IPC already opened the URL in
    // the user's browser via shell::open. This button is a manual retry
    // for the case where the auto-open was blocked by an OS prompt or the
    // user dismissed the browser tab. We use window.open here (works in
    // both Tauri webview and browser dev mode); Tauri intercepts and
    // routes through shell::open via the OS handler.
    window.open(response.verificationUri, "_blank", "noopener,noreferrer");
  }, [response.verificationUri]);

  return (
    <div
      role="dialog"
      aria-label="Sign in with GitHub"
      data-slot="sign-in-dialog"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        width: 320,
        background: "var(--surface-2, #1a1d22)",
        border: "1px solid var(--border-default)",
        borderRadius: 10,
        padding: 16,
        boxShadow: "0 6px 24px rgba(0,0,0,0.42)",
        zIndex: 60,
        fontFamily: "var(--font-sans)",
        color: "var(--text-primary)",
      }}
    >
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        Enter this code at <strong>github.com/login/device</strong>:
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <code
          aria-label="Authorization code"
          style={{
            flex: 1,
            fontFamily: "var(--font-mono)",
            fontSize: 18,
            letterSpacing: "0.12em",
            padding: "6px 10px",
            background: "var(--surface-1, #0f1115)",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            textAlign: "center",
          }}
        >
          {userCode ?? "…"}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code"
          title="Copy code"
          style={{
            height: 32,
            padding: "0 10px",
            borderRadius: 6,
            border: "1px solid var(--border-default)",
            background: "transparent",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Copy
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: "var(--color-danger, #d44)",
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10 }}>
          Waiting for you to authorize on GitHub…
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={handleOpenGithub}
          style={{
            flex: 1,
            height: 32,
            borderRadius: 6,
            border: "1px solid var(--color-action, #2F5B8E)",
            background: "var(--color-action, #2F5B8E)",
            color: "var(--color-action-ink, #FFFFFF)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Open GitHub
        </button>
        {error ? (
          <button
            type="button"
            onClick={onRetry}
            style={{
              height: 32,
              padding: "0 12px",
              borderRadius: 6,
              border: "1px solid var(--border-default)",
              background: "transparent",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Try again
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          style={{
            height: 32,
            padding: "0 12px",
            borderRadius: 6,
            border: "1px solid var(--border-default)",
            background: "transparent",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 12px",
        background: "transparent",
        color: "var(--text-primary)",
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        fontFamily: "inherit",
        borderRadius: 4,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-3, #25292f)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}

function GithubMark({ size = 16 }: { size?: number }) {
  // Inline SVG so we don't add an asset dependency. Uses currentColor so
  // it picks up the button's text color in light/dark themes.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.04c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.52-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.91 10.91 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.77 1.07.77 2.16v3.2c0 .31.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Util: cancellable sleep. Polls `aborted` every 250ms so a Cancel click
// terminates within a quarter-second instead of waiting out the full
// interval. Implemented with setInterval-style ticking so the awaited
// promise resolves cleanly when aborted (preventing a "leaked timer"
// warning under React Strict Mode in dev).
// ---------------------------------------------------------------------------

async function sleep(ms: number, aborted: () => boolean): Promise<void> {
  const tick = 250;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (aborted()) return;
    const remaining = end - Date.now();
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(tick, remaining)));
  }
}
