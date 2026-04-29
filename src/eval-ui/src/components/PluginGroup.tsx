import type { SkillInfo } from "../types";
import { SkillRow } from "./SkillRow";

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
}

/**
 * A plugin-scoped sub-group inside a SidebarSection. Renders:
 *   1. Kicker-caps header with plugin name + count
 *   2. Alpha-sorted list of SkillRow rows
 *
 * No pill backgrounds. Count is tabular-nums. Header uses a very small
 * lighter-weight label so the rows underneath feel primary.
 */
export function PluginGroup({ plugin, skills, selectedKey, onSelect, onContextMenu, dirtySkillIds }: Props) {
  const sorted = [...skills].sort((a, b) => a.skill.localeCompare(b.skill));
  // 0802: friendly tool caption (e.g. "Claude Code") rendered under the
  // uppercased plugin folder. Suppress when it exactly matches the plugin
  // label (case-fold, leading-dot stripped) — that's the only redundancy
  // worth hiding; mismatches like `.cursor` / `Cursor` still show because
  // readers shouldn't have to know the dot-folder convention.
  const pluginDisplay = skills[0]?.pluginDisplay;
  const labelForCompare = plugin.replace(/^\./, "").toLowerCase();
  const captionVisible =
    !!pluginDisplay && pluginDisplay.toLowerCase() !== labelForCompare;

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
          return (
            <div role="listitem" key={`${s.plugin}/${s.skill}`}>
              <SkillRow skill={s} isSelected={isSelected} onSelect={() => onSelect(s)} onContextMenu={onContextMenu} dirty={dirtySkillIds?.has(`${s.plugin}/${s.skill}`)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
