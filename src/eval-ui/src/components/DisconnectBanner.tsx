interface Props {
  connected: boolean;
  /** Optional hint shown when disconnected (e.g. last-seen timestamp). */
  hint?: string;
  onRetry?: () => void;
}

/**
 * Top-of-shell banner shown whenever the SSE stream is not connected.
 * Assertive live region so screen-reader users are alerted immediately.
 * Disappears automatically when `connected` flips back to true.
 */
export function DisconnectBanner({ connected, hint, onRetry }: Props) {
  if (connected) return null;
  return (
    <aside
      aria-live="assertive"
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 12px",
        background: "color-mix(in srgb, var(--status-own) 15%, transparent)",
        borderBottom: "1px solid var(--border-default)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--status-own)",
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span style={{ fontWeight: 500 }}>Disconnected — reconnecting…</span>
      {hint && (
        <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{hint}</span>
      )}
      <div style={{ flex: 1 }} />
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            background: "transparent",
            border: "1px solid var(--border-default)",
            borderRadius: 4,
            padding: "2px 8px",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontSize: 11,
            fontFamily: "var(--font-sans)",
          }}
        >
          Retry now
        </button>
      )}
    </aside>
  );
}
