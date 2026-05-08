// 0831 US-010 — QuotaGraceBanner.
//
// Owner: desktop-quota-agent.
//
// Renders a non-modal banner to nudge the user when their cached quota is
// approaching or past the 7-day grace window (ADR-0831-05). Banner copy:
//   - 0–6 days remaining: invisible (no banner — fresh state).
//   - 7th day (≤1 day remaining): yellow informational banner —
//       "Sync to verify Pro tier — last synced 7 days ago".
//   - 8+ days overdue: red banner + the host should hard-stop new creates.
//       This component does NOT enforce — it only renders.
//
// Mounted once at the studio top-rail layer next to UserDropdown so it
// becomes a persistent, scannable status indicator. Click "Sync now" to
// fire `forceSync(true)` on demand.

import { useCallback, type CSSProperties, type ReactElement } from "react";

import { useQuota } from "../contexts/QuotaContext";

interface Props {
  /** Override for tests — pinning the rendered tone. */
  forcedTone?: "warn" | "danger" | null;
}

export function QuotaGraceBanner({ forcedTone }: Props): ReactElement | null {
  const { snapshot, refreshing, forceSync } = useQuota();

  const days = snapshot?.daysRemaining ?? 0;
  const isFresh = snapshot?.isFresh ?? false;
  const cache = snapshot?.cache ?? null;

  // Without a cache we don't show the banner — the user hasn't signed in,
  // so there's nothing to be stale about. Sign-in prompts live elsewhere.
  if (!cache) return null;

  // Hide when fresh and not in the warning zone.
  // Warning threshold: <=1 day left within the grace window.
  const tone: "warn" | "danger" | null = forcedTone ?? computeTone(days, isFresh);
  if (!tone) return null;

  const onSyncNow = useCallback(() => {
    void forceSync(true);
  }, [forceSync]);

  const message =
    tone === "danger"
      ? "Sign in to refresh your subscription. Some features will be locked until you reconnect."
      : "Sync to verify your subscription — last synced 7 days ago.";

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="quota-grace-banner"
      data-tone={tone}
      style={{
        ...containerStyle,
        background:
          tone === "danger"
            ? "var(--color-danger-bg, rgba(220, 50, 47, 0.12))"
            : "var(--color-warn-bg, rgba(203, 75, 22, 0.12))",
        color:
          tone === "danger"
            ? "var(--color-danger, #dc322f)"
            : "var(--color-warn, #cb4b16)",
        borderColor:
          tone === "danger"
            ? "var(--color-danger, #dc322f)"
            : "var(--color-warn, #cb4b16)",
      }}
    >
      <span style={{ fontWeight: 500 }}>{message}</span>
      <button
        type="button"
        onClick={onSyncNow}
        disabled={refreshing}
        data-testid="quota-grace-sync"
        style={syncButtonStyle}
      >
        {refreshing ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}

function computeTone(
  daysRemaining: number,
  isFresh: boolean,
): "warn" | "danger" | null {
  // Stale (past grace) → danger.
  if (!isFresh) return "danger";
  // ≤ 1 day left in grace window → warn.
  if (daysRemaining <= 1) return "warn";
  return null;
}

const containerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 12,
  padding: "6px 12px",
  borderRadius: 6,
  fontSize: 12,
  border: "1px solid currentColor",
  fontFamily: "var(--font-system, -apple-system, system-ui)",
};

const syncButtonStyle: CSSProperties = {
  padding: "2px 10px",
  borderRadius: 4,
  border: "1px solid currentColor",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
};
