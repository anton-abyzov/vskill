import { useContext } from "react";
import { StudioContext } from "../StudioContext";

interface Props {
  /** `<plugin>/<skill>` — the key used in `updatesById`. */
  skillId: string;
  /**
   * Server-reported tracking state. `true` when the skill has a
   * `sourceRepoUrl` recorded on the platform; `false` means the user
   * must run `vskill outdated` manually.
   */
  trackedForUpdates: boolean;
}

/**
 * 0708 T-037/T-038 — per-skill update status glyph for SidebarSection and
 * RightPanel rows.
 *
 * Precedence:
 *   1. Blue dot + tooltip if the skill is in the SSE push store
 *      (`StudioContext.updatesById`) — AC-US5-04.
 *   2. Dim gray dot + hint tooltip if the skill is NOT tracked on the
 *      server — AC-US5-09. Visually quieter than the update dot; no
 *      toast, no bell increment.
 *   3. Renders `null` when the skill is tracked and has no pending update.
 */
export function UpdateChip({ skillId, trackedForUpdates }: Props) {
  // Read the context defensively: SkillRow's existing unit tests invoke the
  // function component outside a React reconciler (pure walker), so calling
  // `useContext` throws. We swallow that one narrow failure and fall back to
  // "no push entry"; inside a real render tree the hook returns the provider
  // value normally. `trackedForUpdates` still governs the not-tracked dot.
  type Ctx = { updatesById: ReadonlyMap<string, { version: string; diffSummary?: string }> } | null;
  let ctx: Ctx = null;
  try {
    ctx = useContext(StudioContext) as unknown as Ctx;
  } catch {
    ctx = null;
  }
  const entry = ctx?.updatesById.get(skillId);

  if (entry) {
    const title = `Update available → ${entry.version}${
      entry.diffSummary ? ` — ${entry.diffSummary}` : ""
    }`;
    return (
      <span
        data-testid="update-chip-update-dot"
        aria-label={`Update available: ${entry.version}`}
        title={title}
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: 999,
          background: "var(--color-accent, #2563eb)",
          flexShrink: 0,
        }}
      />
    );
  }

  if (!trackedForUpdates) {
    return (
      <span
        data-testid="update-chip-untracked-dot"
        aria-label="Not tracked for updates"
        title="Not tracked — run `vskill outdated` manually"
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: 999,
          background: "var(--text-muted, var(--text-secondary))",
          opacity: 0.55,
          flexShrink: 0,
        }}
      />
    );
  }

  return null;
}
