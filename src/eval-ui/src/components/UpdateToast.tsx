import { useEffect } from "react";
import { useStudio } from "../StudioContext";

export function UpdateToast() {
  const { updateCount, state, dismissUpdateNotification } = useStudio();
  const visible = updateCount > 0 && !state.updateNotificationDismissed;

  // Auto-dismiss after 10 seconds
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => dismissUpdateNotification(), 10_000);
    return () => clearTimeout(timer);
  }, [visible, dismissUpdateNotification]);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg text-[13px] font-medium animate-fade-in"
      style={{
        background: "var(--yellow-muted)",
        border: "1px solid var(--yellow)",
        color: "var(--text-primary)",
      }}
    >
      <span>{updateCount} update{updateCount === 1 ? "" : "s"} available</span>
      <button
        onClick={() => { window.location.hash = "#/updates"; }}
        className="px-2 py-0.5 rounded text-[12px] font-semibold"
        style={{
          background: "var(--yellow)",
          color: "var(--surface-0)",
          border: "none",
          cursor: "pointer",
        }}
      >
        View Updates
      </button>
      <button
        onClick={dismissUpdateNotification}
        className="text-[14px] leading-none"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--text-secondary)",
          cursor: "pointer",
          padding: "0 2px",
        }}
        aria-label="Dismiss"
      >
        &#x2715;
      </button>
    </div>
  );
}
