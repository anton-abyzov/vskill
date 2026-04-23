interface Props {
  /** Absolute directory of the skill (e.g. "/home/user/.claude/skills/foo"). */
  dir: string;
  /** Project root so we can render a relative-looking label. */
  root?: string;
}

/**
 * Thin meta-style chip displaying the agent directory an installed skill
 * lives inside (e.g. `.claude`, `.cursor`). Display-only — provenance
 * classification is driven by `skill.origin`, not this component.
 *
 * Intentionally no background pill; just monospace text with a leading dot
 * so the eye parses it as metadata, not as a tag/label.
 */
export function ProvenanceChip({ dir, root }: Props) {
  const segment = leadingAgentSegment(dir, root);

  return (
    <span
      title={dir}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--text-secondary)",
        padding: 0,
        background: "transparent",
        border: "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: 140,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 3,
          height: 3,
          borderRadius: "50%",
          background: "var(--text-secondary)",
          display: "inline-block",
          flexShrink: 0,
          opacity: 0.7,
        }}
      />
      {segment}
    </span>
  );
}

/**
 * Given `/home/user/.claude/skills/foo` and root `/home/user`, return
 * `.claude`. Falls back to the first path segment if no dot-directory
 * can be identified.
 */
function leadingAgentSegment(dir: string, root?: string): string {
  let rel = dir;
  // Only strip the root prefix when it's a directory boundary — skip when
  // the "root" is just "." or empty so we don't eat a leading dot-segment.
  if (root && root !== "." && root !== "" && dir.startsWith(root)) {
    rel = dir.slice(root.length).replace(/^[/\\]+/, "");
  }
  const segments = rel.split(/[/\\]/).filter(Boolean);
  if (segments.length === 0) return dir;
  // Prefer the first dot-directory (matches `.claude`, `.cursor`, etc.)
  const dotSeg = segments.find((s) => s.startsWith("."));
  return dotSeg ?? segments[0];
}
