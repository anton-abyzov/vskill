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
// callers that already render their own "v").
//
// Increment 0750: source-aware rendering. The badge no longer returns null
// for empty version — it falls back to "1.0.0" so the AVAILABLE sidebar
// never has blank slots. Callers pass `source` (frontmatter | registry |
// plugin | default) so inherited versions render in italic with a `title`
// tooltip describing provenance, distinguishing author-declared from
// inherited at a glance.
// ---------------------------------------------------------------------------

export type VersionBadgeSource = "frontmatter" | "registry" | "plugin" | "default";

export interface VersionBadgeProps {
  version: string | null | undefined;
  /** When false, the "v" prefix is omitted (default: true). */
  showPrefix?: boolean;
  /** Optional smaller size for dense rows (sidebar, activation log). */
  size?: "sm" | "md";
  /** Optional test id for deterministic selection. */
  "data-testid"?: string;
  /** Optional title attribute (tooltip). Overridden by source-derived
   *  tooltip when `source` is provided and not `"frontmatter"`. */
  title?: string;
  /**
   * Increment 0750: provenance label for the version. When omitted (or set
   * to `"frontmatter"`), the badge renders in normal weight with no tooltip
   * — historic behavior preserved. When set to `"registry"`, `"plugin"`, or
   * `"default"`, the badge renders in italic with a `title` tooltip
   * describing where the version came from.
   */
  source?: VersionBadgeSource;
  /** Optional plugin display name — used in the tooltip when `source` is
   *  `"plugin"` (e.g. "Inherited from specweave plugin v2.3.0"). */
  pluginName?: string | null;
}

function provenanceTooltip(source: VersionBadgeSource | undefined, version: string, pluginName?: string | null): string | undefined {
  if (!source || source === "frontmatter") return undefined;
  if (source === "plugin") {
    const name = pluginName && pluginName.trim() !== "" ? pluginName : "plugin";
    return `Inherited from ${name} plugin v${version}`;
  }
  if (source === "registry") return "Inherited from registry";
  return "No version declared";
}

export function VersionBadge(props: VersionBadgeProps) {
  const { version, showPrefix = true, size = "md", source, pluginName } = props;

  // Increment 0750: never render empty / never return null. Empty input falls
  // back to "1.0.0" so the sidebar never blanks out.
  // 0756: also reject the literal "0.0.0" — it's the studio's own placeholder
  // for the platform's /check-updates endpoint and should never reach a badge.
  // Defense-in-depth: belts-and-braces in case any caller bypasses the resolver.
  const trimmed = typeof version === "string" ? version.trim() : "";
  const safeVersion = trimmed === "" || trimmed === "0.0.0" ? "1.0.0" : trimmed;

  const normalized = showPrefix && !safeVersion.startsWith("v") ? `v${safeVersion}` : safeVersion;
  const fontSize = size === "sm" ? 10 : 12;
  const padY = size === "sm" ? 1 : 2;
  const padX = size === "sm" ? 5 : 8;

  const isInherited = source !== undefined && source !== "frontmatter";
  const sourceTitle = provenanceTooltip(source, safeVersion, pluginName);
  const finalTitle = props.title ?? sourceTitle;

  const style: Record<string, string | number> = {
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
  };
  if (isInherited) style.fontStyle = "italic";

  return (
    <span
      data-testid={props["data-testid"] ?? "version-badge"}
      data-version={safeVersion}
      data-version-source={source}
      title={finalTitle}
      style={style}
    >
      {normalized}
    </span>
  );
}

export default VersionBadge;
