// ---------------------------------------------------------------------------
// T-002 (0707): VersionBadge — reusable inline-flex version chip.
//
// Used across the studio to surface a skill's semver version in a single
// consistent shape. Appears in: DetailHeader, sidebar skill rows, test-run
// result cards, and activation-log rows.
//
// Design tokens only — `border: 1px solid var(--border)`, muted surface
// background, 0.75rem tabular-nums typography. Renders `v{version}` by
// default (the "v" prefix can be suppressed via `showPrefix={false}` for
// callers that already render their own "v"). When `version` is null /
// empty, renders nothing so callers can compose unconditionally.
// ---------------------------------------------------------------------------

export interface VersionBadgeProps {
  version: string | null | undefined;
  /** When false, the "v" prefix is omitted (default: true). */
  showPrefix?: boolean;
  /** Optional smaller size for dense rows (sidebar, activation log). */
  size?: "sm" | "md";
  /** Optional test id for deterministic selection. */
  "data-testid"?: string;
  /** Optional title attribute (tooltip). */
  title?: string;
}

export function VersionBadge(props: VersionBadgeProps) {
  const { version, showPrefix = true, size = "md" } = props;
  if (!version || typeof version !== "string" || version.trim() === "") return null;

  const normalized = showPrefix && !version.startsWith("v") ? `v${version}` : version;
  const fontSize = size === "sm" ? 10 : 12;
  const padY = size === "sm" ? 1 : 2;
  const padX = size === "sm" ? 5 : 8;

  return (
    <span
      data-testid={props["data-testid"] ?? "version-badge"}
      data-version={version}
      title={props.title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: `${padY}px ${padX}px`,
        border: "1px solid var(--border, var(--border-default))",
        borderRadius: 4,
        background: "var(--bg-subtle, var(--surface-1, transparent))",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-mono, var(--font-geist-mono))",
        fontSize,
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {normalized}
    </span>
  );
}

export default VersionBadge;
