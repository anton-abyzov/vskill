import { memo } from "react";

interface Props {
  /** The text that screen readers should announce. Pass "" to stay silent. */
  message: string;
  /**
   * "polite" (default) — queues announcements without interrupting.
   * "assertive" — interrupts current speech (reserved for errors).
   */
  politeness?: "polite" | "assertive";
  /** Optional role override. Defaults to "status" for polite, "alert" for assertive. */
  role?: "status" | "alert";
}

/**
 * Screen-reader-only live region (T-044).
 *
 * Centralized so every announcement in the studio (selection changes, toast
 * confirmations, SSE state transitions) flows through a consistent ARIA
 * contract. The visual output is `sr-only`: invisible to sighted users while
 * keeping the node in the accessibility tree.
 *
 * Use one instance per purpose. For selection announcements, mount a single
 * `<AriaLive politeness="polite" message={liveMessage}>` near the shell root
 * and update `message` whenever selection changes. For error shouting, mount
 * a separate `<AriaLive politeness="assertive">` in the same tree.
 */
export const AriaLive = memo(function AriaLive({ message, politeness = "polite", role }: Props) {
  const resolvedRole = role ?? (politeness === "assertive" ? "alert" : "status");
  return (
    <div
      aria-live={politeness}
      aria-atomic="true"
      role={resolvedRole}
      data-testid="aria-live"
      data-politeness={politeness}
      style={{
        // SR-only: keeps the node in the accessibility tree but visually hidden.
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
        border: 0,
        padding: 0,
        margin: -1,
      }}
    >
      {message}
    </div>
  );
});
