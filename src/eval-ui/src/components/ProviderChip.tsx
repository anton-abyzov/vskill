// 0823 — Provider chip rendered on the Versions tab and Source tab to
// communicate skill provenance: vskill (light blue), Anthropic (orange),
// or Local (gray). Pure presentational.

// 0823 F-012: tightened provider type. Accept the three known providers, plus
// null/undefined for "missing data" (renders nothing). String fallback removed
// so misspellings get caught at compile time.
export type SkillProvider = "vskill" | "anthropic" | "local";

interface Props {
  provider: SkillProvider | null | undefined;
  size?: "sm" | "md";
}

const STYLES: Record<SkillProvider, { label: string; bg: string; fg: string; border: string }> = {
  vskill: {
    label: "vskill",
    bg: "var(--accent-muted, #e0f2fe)",
    fg: "var(--accent, #0369a1)",
    border: "var(--accent, #0369a1)",
  },
  anthropic: {
    label: "Anthropic",
    bg: "var(--orange-muted, #fff1e0)",
    fg: "var(--orange, #c2410c)",
    border: "var(--orange, #c2410c)",
  },
  local: {
    label: "Local",
    bg: "var(--surface-3, #e5e5e5)",
    fg: "var(--text-tertiary, #666)",
    border: "var(--border-default, #ccc)",
  },
};

export function ProviderChip({ provider, size = "sm" }: Props) {
  if (!provider) return null;
  const style = STYLES[provider];
  const fontSize = size === "md" ? 11 : 9;
  return (
    <span
      data-testid={`provider-chip-${provider}`}
      data-provider={provider}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: size === "md" ? "2px 8px" : "1.5px 6px",
        fontSize,
        fontWeight: 500,
        fontFamily: "var(--font-sans)",
        background: style.bg,
        color: style.fg,
        border: `1px solid ${style.border}`,
        borderRadius: 999,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {style.label}
    </span>
  );
}
