/**
 * Static loading placeholder row — 36px, NO shimmer.
 *
 * Uses the shared `.placeholder` class from globals.css (introduced in T-002)
 * which is a static, non-animated fill. The check-no-shimmer CI script
 * enforces that no `shimmer` keyframe or class sneaks back into eval-ui.
 */
export function SkeletonRow() {
  return (
    <div
      aria-hidden="true"
      role="presentation"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 36,
        padding: "0 12px 0 14px",
      }}
    >
      <span
        className="placeholder"
        style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0 }}
      />
      <span
        className="placeholder"
        style={{ height: 10, flex: 1, borderRadius: 3, maxWidth: 180 }}
      />
    </div>
  );
}
