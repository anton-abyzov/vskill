// 0831 US-005 — PaywallModal.
//
// Owner: desktop-quota-agent.
//
// Hard-blocks the 51st skill create on the free tier. Triggered by the
// CreateSkillModal flow when `quotaCanCreateSkill()` returns `blocked: true`.
//
// UX contract (AC-US5-03..05):
//   - Body copy: "You've reached the 50-skill free tier. Upgrade to Skill
//     Studio Pro for unlimited skills + private repo support."
//   - Two actions: "Upgrade to Pro" (opens pricing in browser) and
//     "Maybe later" (closes the modal).
//   - WAI-ARIA dialog with focus trap + ESC closes (AC-US5-03).
//   - No countdown timers / urgency language (AC-US8-06).
//
// Auto-upgrade race resolution (T-021):
//   On open we kick off `forceSync(fresh=true)` in the background. If the
//   refresh returns a paid tier, we auto-dismiss the modal AND call the
//   `onProceed` callback so the user's create resumes. Window: 5s, gated
//   by the `quota_force_sync` IPC's hard timeout.

import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactElement,
} from "react";

import { useQuota } from "../contexts/QuotaContext";
import { PRICING_URL } from "../hooks/useTier";
import { useDesktopBridge } from "../preferences/lib/useDesktopBridge";

interface Props {
  /** Whether the modal is mounted in the DOM. */
  open: boolean;
  /** Callback for the "Maybe later" button + ESC + backdrop click. */
  onClose: () => void;
  /**
   * Callback fired when a background refresh detects that the user is
   * actually on a paid tier (race resolution). The host should resume the
   * blocked create flow.
   */
  onProceed?: () => void;
  /** Skill name the user attempted to create — included in copy. */
  skillName?: string;
}

const TITLE_ID = "paywall-modal-title";
const BODY_ID = "paywall-modal-body";

export function PaywallModal({
  open,
  onClose,
  onProceed,
  skillName,
}: Props): ReactElement | null {
  const bridge = useDesktopBridge();
  const { forceSync, snapshot } = useQuota();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const upgradeRef = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<Element | null>(null);

  // T-021: when the modal opens, fire a fresh quota sync. If the refresh
  // returns a paid tier, dismiss the modal and call onProceed.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        await forceSync(true);
      } catch {
        // Force-sync errors fall through — user stays on paywall.
      }
      // We don't have to inspect the result here directly because the
      // QuotaContext snapshot updates state, and the next render will
      // observe via the effect below.
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [open, forceSync]);

  // After force-sync, if snapshot now shows paid tier, auto-dismiss + proceed.
  useEffect(() => {
    if (!open) return;
    const tier = snapshot?.cache?.response.tier;
    if (tier === "pro" || tier === "enterprise") {
      onProceed?.();
      onClose();
    }
  }, [open, snapshot, onProceed, onClose]);

  // Focus trap + ESC handler.
  useEffect(() => {
    if (!open) return;
    previousFocus.current =
      typeof document !== "undefined" ? document.activeElement : null;
    // Move focus to the primary action on open.
    const t = setTimeout(() => upgradeRef.current?.focus(), 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active =
        typeof document !== "undefined" ? document.activeElement : null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      // Restore focus to the previously-focused element when closing.
      if (previousFocus.current instanceof HTMLElement) {
        previousFocus.current.focus();
      }
    };
  }, [open, onClose]);

  const onUpgrade = useCallback(() => {
    void bridge.openExternalUrl(PRICING_URL);
  }, [bridge]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      aria-describedby={BODY_ID}
      data-testid="paywall-modal"
      style={overlayStyle}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
        }}
      />
      <div ref={dialogRef} style={dialogStyle}>
        <h2 id={TITLE_ID} style={titleStyle}>
          You&rsquo;ve reached the 50-skill free tier
        </h2>
        <p id={BODY_ID} style={bodyStyle}>
          Upgrade to Skill Studio Pro for unlimited skills + private repo
          support.
          {skillName ? (
            <>
              {" "}
              <span style={{ color: "var(--color-muted, #888)" }}>
                ({skillName} won&rsquo;t be created until you upgrade.)
              </span>
            </>
          ) : null}
        </p>
        <div style={actionsStyle}>
          <button
            type="button"
            onClick={onClose}
            data-testid="paywall-maybe-later"
            style={secondaryButtonStyle}
          >
            Maybe later
          </button>
          <button
            ref={upgradeRef}
            type="button"
            onClick={onUpgrade}
            data-testid="paywall-upgrade"
            style={primaryButtonStyle}
          >
            Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const dialogStyle: CSSProperties = {
  position: "relative",
  width: "min(420px, 92vw)",
  background: "var(--color-bg, #ffffff)",
  color: "var(--color-text, #111111)",
  borderRadius: 12,
  padding: "24px 24px 16px",
  boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
  fontFamily: "var(--font-system, -apple-system, system-ui)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
};

const bodyStyle: CSSProperties = {
  marginTop: 12,
  marginBottom: 24,
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--color-text-soft, #444)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
};

const baseButton: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  border: "1px solid transparent",
};

const primaryButtonStyle: CSSProperties = {
  ...baseButton,
  background: "var(--color-accent, #cb4b16)",
  color: "#ffffff",
};

const secondaryButtonStyle: CSSProperties = {
  ...baseButton,
  background: "transparent",
  color: "var(--color-text, #111111)",
  borderColor: "var(--color-border, #cccccc)",
};
