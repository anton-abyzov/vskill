import { useCallback, useState } from "react";
import { strings } from "../strings";

// ---------------------------------------------------------------------------
// 0686 T-012 (US-006): ClaudeCodeFirstUseBanner — small inline banner that
// appears below the AgentScopePicker the first time the user makes Claude
// Code the active scope agent for the session.
//
// Contract:
//   - Active-agent gate: renders ONLY when `activeAgentId` is one of
//     ("claude-cli", "claude-code"). The codebase uses `claude-cli` as the
//     runtime id in `useAgentCatalog`; the server's AgentsResponse names
//     the same agent `claude-code`. Both surfaces should trigger the banner
//     so no matter which side drives activeAgentId, the first-use hint
//     fires once.
//   - Session-dismiss gate: reads `vskill-ccode-banner-dismissed` from
//     `sessionStorage`; when the key exists the banner stays hidden for
//     the remainder of the session. Dismissing writes the key.
//   - "Learn more" dispatches `studio:open-setup-drawer` with
//     `{provider: "claude-code"}` — the shared App-root listener routes
//     that to the SetupDrawer's claude-code view.
//
// AC coverage:
//   AC-US6-03  Exact verified first-use copy (sourced from
//              `strings.claudeCodeLabel.firstUseBanner`).
//   AC-US6-04  Dismiss persists to sessionStorage + banner hidden on reload
//              within the session.
// ---------------------------------------------------------------------------

const DISMISS_KEY = "vskill-ccode-banner-dismissed";
const CLAUDE_CODE_IDS = new Set(["claude-cli", "claude-code"]);

export interface ClaudeCodeFirstUseBannerProps {
  activeAgentId: string | null;
}

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "true";
  } catch {
    // Private browsing / disabled storage — default to "not dismissed" so
    // users on hardened browsers still see the hint. Can't persist it,
    // but that's graceful degradation, not a failure.
    return false;
  }
}

function writeDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, "true");
  } catch {
    /* ignore */
  }
}

export function ClaudeCodeFirstUseBanner({
  activeAgentId,
}: ClaudeCodeFirstUseBannerProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  const onLearnMore = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("studio:open-setup-drawer", {
        detail: { provider: "claude-code" },
      }),
    );
  }, []);

  const onDismiss = useCallback(() => {
    writeDismissed();
    setDismissed(true);
  }, []);

  if (!activeAgentId || !CLAUDE_CODE_IDS.has(activeAgentId)) return null;
  if (dismissed) return null;

  return (
    <div
      data-testid="claude-code-first-use-banner"
      role="note"
      aria-label="Claude Code subscription info"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 12px",
        borderBottom: "1px solid var(--border-default, var(--border-subtle))",
        background:
          "color-mix(in srgb, var(--accent-surface) 8%, transparent)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        color: "var(--text-primary)",
        lineHeight: 1.45,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--color-ok, #22c55e)",
          marginTop: 6,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span>{strings.claudeCodeLabel.firstUseBanner} </span>
        <button
          type="button"
          data-testid="claude-code-first-use-banner-learn-more"
          onClick={onLearnMore}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            color: "var(--color-accent, var(--accent-surface))",
            cursor: "pointer",
            textDecoration: "underline",
            fontFamily: "inherit",
            fontSize: "inherit",
          }}
        >
          {strings.claudeCodeLabel.learnMore}
        </button>
      </div>
      <button
        type="button"
        data-testid="claude-code-first-use-banner-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss Claude Code info banner"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: 14,
          lineHeight: 1,
          padding: 2,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
