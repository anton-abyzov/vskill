// 0741 T-007: Ported from vskill-platform/src/app/components/SectionDivider.tsx.
// Terminal-style section divider: ── Title ──────────

interface SectionDividerProps {
  title: string;
}

export default function SectionDivider({ title }: SectionDividerProps) {
  return (
    <div
      data-testid="section-divider"
      style={{
        fontFamily: "var(--font-geist-mono)",
        fontSize: "1.125rem",
        fontWeight: 600,
        color: "var(--text)",
        marginBottom: "1.5rem",
        letterSpacing: "-0.01em",
      }}
    >
      <span style={{ color: "var(--text-faint)" }}>{"── "}</span>
      {title}
      <span style={{ color: "var(--text-faint)" }}>{" "}{Array(Math.max(0, 48 - title.length)).fill("─").join("")}</span>
    </div>
  );
}
