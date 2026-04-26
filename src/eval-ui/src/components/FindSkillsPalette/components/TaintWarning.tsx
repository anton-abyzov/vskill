// 0741 T-007: Ported from vskill-platform/src/app/components/TaintWarning.tsx.

import { skillUrl } from "../../../lib/skill-url";

interface TaintWarningProps {
  reason?: string | null;
  blockedSkills?: { name: string; displayName: string }[];
}

const MONO = "var(--font-geist-mono)";
const AMBER = "#D97706";

export default function TaintWarning({ reason, blockedSkills }: TaintWarningProps) {
  return (
    <div
      data-testid="taint-warning"
      style={{
        borderLeft: `3px solid ${AMBER}`,
        padding: "0.75rem 1rem",
        marginBottom: "1.5rem",
        background: `color-mix(in srgb, ${AMBER} 6%, transparent)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: "0.75rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: AMBER,
          }}
        >
          Tainted
        </span>
      </div>
      <p
        style={{
          fontFamily: MONO,
          fontSize: "0.8125rem",
          color: "var(--text-muted)",
          margin: "0.25rem 0 0",
          lineHeight: 1.5,
        }}
      >
        {reason ? (
          reason
        ) : (
          <>
            Another skill from this author has been blocked for security reasons.
            This skill has not been individually blocked, but exercise caution.
          </>
        )}
      </p>
      {blockedSkills && blockedSkills.length > 0 && (
        <div style={{ marginTop: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
          {blockedSkills.map((s) => (
            <a
              key={s.name}
              href={skillUrl(s.name)}
              style={{
                fontFamily: MONO,
                fontSize: "0.75rem",
                color: AMBER,
                textDecoration: "underline",
                textUnderlineOffset: "2px",
              }}
            >
              {s.displayName}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
