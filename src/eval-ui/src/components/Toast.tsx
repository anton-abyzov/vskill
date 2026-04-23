import { useEffect, useRef, useState } from "react";
import { AriaLive } from "./AriaLive";

/**
 * Toast notification primitives.
 *
 * Presentation only — state (queue, auto-dismiss, keyboard) lives in
 * ToastProvider. One live region per severity; success/info fire "polite"
 * announcements, errors fire "assertive". Motion respects
 * `prefers-reduced-motion` via the globals.css override (no JS duration
 * override needed — we read `--duration-base` from CSS).
 */

export type ToastSeverity = "success" | "info" | "error";

export interface ToastRecord {
  id: string;
  message: string;
  severity: ToastSeverity;
  /** Auto-dismiss delay in ms. 0 = sticky. Default 4000. */
  durationMs?: number;
  /** Optional "Retry" / "Undo" action. Clicking dismisses the toast. */
  action?: {
    label: string;
    onInvoke: () => void;
  };
}

interface ToastItemProps {
  toast: ToastRecord;
  onDismiss: (id: string) => void;
}

export function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [entering, setEntering] = useState(true);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Two-frame enter so the enter transition runs even in test harnesses.
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => setEntering(false));
    });
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const tintByLevel: Record<ToastSeverity, string> = {
    success: "var(--status-installed)",
    info: "var(--text-secondary)",
    error: "var(--color-accent, var(--accent-surface))",
  };

  return (
    <div
      role={toast.severity === "error" ? "alert" : "status"}
      data-testid="toast-item"
      data-severity={toast.severity}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        minWidth: 240,
        maxWidth: 360,
        background: "var(--bg-canvas)",
        color: "var(--text-primary)",
        border: "1px solid var(--border-default)",
        borderLeft: `3px solid ${tintByLevel[toast.severity]}`,
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        // Slide + fade enter. `prefers-reduced-motion: reduce` is enforced
        // globally by globals.css (all durations → 0ms). No JS override needed.
        transform: entering ? "translateY(8px)" : "translateY(0)",
        opacity: entering ? 0 : 1,
        transition:
          "transform var(--duration-base, 180ms) var(--ease-standard, ease), opacity var(--duration-base, 180ms) var(--ease-standard, ease)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.onInvoke();
            onDismiss(toast.id);
          }}
          style={{
            background: "transparent",
            border: "1px solid var(--border-default)",
            borderRadius: 4,
            padding: "3px 8px",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontSize: 11,
            fontFamily: "var(--font-sans)",
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
        style={{
          background: "transparent",
          border: "none",
          padding: 2,
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

interface ToastStackProps {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
  liveMessage: string;
  liveAssertiveMessage: string;
}

export function ToastStack({ toasts, onDismiss, liveMessage, liveAssertiveMessage }: ToastStackProps) {
  return (
    <>
      <AriaLive politeness="polite" message={liveMessage} />
      <AriaLive politeness="assertive" message={liveAssertiveMessage} />
      {/*
        T-0684 (B8): Only render the stack container when there are toasts.
        qa-click-audit.spec.ts:385 asserts zero elements matching
        `[data-testid^="toast-"]` after Escape; when the stack div was
        always-rendered its `data-testid="toast-stack"` survived dismissal
        and kept the count at 1.
      */}
      {toasts.length > 0 && (
        <div
          data-testid="toast-stack"
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            display: "flex",
            flexDirection: "column-reverse",
            gap: 8,
            zIndex: 50,
            pointerEvents: "none",
          }}
        >
          {toasts.map((t) => (
            <div key={t.id} style={{ pointerEvents: "auto" }}>
              <ToastItem toast={t} onDismiss={onDismiss} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
