import { useState, useEffect, useRef } from "react";

export interface ClassifiedError {
  category: "rate_limit" | "context_window" | "auth" | "timeout" | "provider_unavailable" | "parse_error" | "unknown";
  title: string;
  description: string;
  hint: string;
  retryable: boolean;
  retryAfterMs?: number;
}

interface ErrorCardProps {
  error: ClassifiedError;
  onRetry?: () => void;
  onDismiss?: () => void;
}

const CATEGORY_CONFIG: Record<string, { icon: string; color: string }> = {
  rate_limit: { icon: "\u23F1", color: "var(--amber, #f59e0b)" }, // timer
  context_window: { icon: "\u26A0", color: "var(--amber, #f59e0b)" }, // warning
  auth: { icon: "\uD83D\uDD12", color: "var(--red, #ef4444)" }, // lock
  timeout: { icon: "\u231B", color: "var(--amber, #f59e0b)" }, // hourglass
  provider_unavailable: { icon: "\u26A1", color: "var(--red, #ef4444)" }, // lightning
  parse_error: { icon: "\u2753", color: "var(--amber, #f59e0b)" }, // question
  unknown: { icon: "\u274C", color: "var(--red, #ef4444)" }, // x mark
};

export function ErrorCard({ error, onRetry, onDismiss }: ErrorCardProps) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (error.category === "rate_limit" && error.retryAfterMs) {
      setCountdown(Math.ceil(error.retryAfterMs / 1000));
    } else {
      setCountdown(null);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [error]);

  useEffect(() => {
    if (countdown == null || countdown <= 0) return;
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev == null || prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [countdown != null && countdown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const config = CATEGORY_CONFIG[error.category] || CATEGORY_CONFIG.unknown;
  const retryDisabled = countdown != null && countdown > 0;

  return (
    <div
      className="rounded-lg overflow-hidden animate-fade-in"
      style={{
        border: `1px solid color-mix(in srgb, ${config.color} 30%, transparent)`,
        background: `color-mix(in srgb, ${config.color} 6%, var(--surface-1))`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 14 }}>{config.icon}</span>
          <span className="text-[12px] font-semibold" style={{ color: config.color }}>
            {error.title}
          </span>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ color: "var(--text-tertiary)" }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-3.5 pb-3">
        <p className="text-[11.5px] mb-1.5" style={{ color: "var(--text-secondary)" }}>
          {error.description}
        </p>
        <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {error.hint}
        </p>

        {/* Actions */}
        {(onRetry || countdown != null) && (
          <div className="flex items-center gap-2 mt-2.5">
            {onRetry && (
              <button
                onClick={onRetry}
                disabled={retryDisabled}
                className="btn btn-secondary text-[11px]"
                style={{ padding: "4px 10px", opacity: retryDisabled ? 0.5 : 1 }}
              >
                {retryDisabled
                  ? `Retry in ${countdown}s`
                  : "Retry"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
