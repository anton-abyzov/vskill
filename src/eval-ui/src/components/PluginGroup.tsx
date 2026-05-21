import type { SkillInfo } from "../types";
import { SkillRow } from "./SkillRow";
import {
  parseGithubRepoSlug,
  type RepoVisibility,
} from "../hooks/useSkillRepoVisibility";
import type { ConnectedRepoDTO } from "../types/account";

export interface SelectedKey {
  plugin: string;
  skill: string;
}

interface Props {
  plugin: string;
  skills: SkillInfo[];
  selectedKey: SelectedKey | null;
  onSelect: (skill: SkillInfo) => void;
  /** T-064: context-menu opener threaded from Sidebar → App-level anchor. */
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, skill: SkillInfo) => void;
  /** 0759 Phase 6: dirty IDs threaded through to each SkillRow. */
  dirtySkillIds?: Set<string>;
  /**
   * 0848: lookup map (owner/name lowercased → ConnectedRepoDTO) built once
   * at the Sidebar level. PluginGroup walks `skill.repoUrl` against it to
   * decide whether each row gets the amber PrivateRepoChip. Optional so
   * existing tests that don't wrap Sidebar still render correctly.
   */
  repoVisibilityLookup?: Map<string, ConnectedRepoDTO>;
}

/**
 * A plugin-scoped sub-group inside a SidebarSection. Renders:
 *   1. Kicker-caps header with plugin name + count
 *   2. Alpha-sorted list of SkillRow rows
 *
 * No pill backgrounds. Count is tabular-nums. Header uses a very small
 * lighter-weight label so the rows underneath feel primary.
 */
export function PluginGroup({
  plugin,
  skills,
  selectedKey,
  onSelect,
  onContextMenu,
  dirtySkillIds,
  repoVisibilityLookup,
}: Props) {
  const sorted = [...skills].sort((a, b) => a.skill.localeCompare(b.skill));
  // 0802 AC-US2-04: friendly tool caption (e.g. "Claude Code") rendered
  // under the uppercased plugin folder. Suppress ONLY on exact-match-after-
  // casefold against the raw plugin label (no dot-strip). Pairs like
  // `.cursor` / `Cursor` still render because readers shouldn't have to
  // know the dot-folder convention; suppression triggers only for the
  // rare redundant pair like `amp` / `Amp`.
  const pluginDisplay = skills[0]?.pluginDisplay;
  const captionVisible =
    !!pluginDisplay && pluginDisplay.toLowerCase() !== plugin.toLowerCase();

  return (
    <div role="group" aria-label={`${plugin} (${skills.length})`}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          padding: "8px 12px 4px 14px",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-sans)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={plugin}
        >
          {plugin}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
            fontFamily: "var(--font-mono)",
          }}
        >
          ({skills.length})
        </span>
        {captionVisible && (
          <span
            style={{
              fontSize: 9,
              color: "var(--text-tertiary, var(--text-secondary))",
              opacity: 0.75,
              fontFamily: "var(--font-sans)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={pluginDisplay}
          >
            {pluginDisplay}
          </span>
        )}
      </div>
      <div role="list">
        {sorted.map((s) => {
          const isSelected =
            !!selectedKey && selectedKey.plugin === s.plugin && selectedKey.skill === s.skill;
          // 0848: derive visibility per row from the precomputed Sidebar
          // lookup. When no lookup is supplied (legacy test mounts), the
          // row falls back to its existing no-chip render.
          const slug = repoVisibilityLookup ? parseGithubRepoSlug(s.repoUrl) : null;
          const match = slug ? repoVisibilityLookup!.get(slug) ?? null : null;
          const repoVisibility: RepoVisibility = match
            ? match.isPrivate
              ? "private"
              : "public"
            : "unknown";
          return (
            <div role="listitem" key={`${s.plugin}/${s.skill}`}>
              <SkillRow
                skill={s}
                isSelected={isSelected}
                onSelect={() => onSelect(s)}
                onContextMenu={onContextMenu}
                dirty={dirtySkillIds?.has(`${s.plugin}/${s.skill}`)}
                repoVisibility={repoVisibility}
                repoFullName={match?.repoFullName ?? null}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
