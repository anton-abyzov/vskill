import { useCallback, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { SkillInfo } from "../types";
import { SidebarSection } from "./SidebarSection";
import { SidebarSearch, matchSkillQuery } from "./SidebarSearch";
import { PluginGroup, type SelectedKey } from "./PluginGroup";
import { SkillRow } from "./SkillRow";
import { SkeletonRow } from "./SkeletonRow";
import { useKeyboardShortcut } from "../hooks/useKeyboardShortcut";

// Virtualization threshold: ADR / scope brief target is 200 rows combined.
export const VIRTUALIZATION_THRESHOLD = 200;

interface Props {
  skills: SkillInfo[];
  selectedKey: SelectedKey | null;
  onSelect: (skill: SkillInfo) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /**
   * T-064: Called when the user right-clicks a skill row. The handler
   * receives the raw mouse event (for cursor coords) and the skill so
   * the parent can anchor a ContextMenu. When undefined, the native
   * browser menu is shown.
   */
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, skill: SkillInfo) => void;
}

interface SectionData {
  total: number;
  filtered: number;
  byPlugin: Array<[plugin: string, skills: SkillInfo[]]>;
}

function partitionAndGroup(
  skills: SkillInfo[],
  query: string,
): { own: SectionData; installed: SectionData } {
  const ownAll: SkillInfo[] = [];
  const installedAll: SkillInfo[] = [];
  for (const s of skills) {
    (s.origin === "installed" ? installedAll : ownAll).push(s);
  }

  function buildSection(source: SkillInfo[]): SectionData {
    const filtered = source.filter((s) => matchSkillQuery(s, query));
    const byPluginMap: Record<string, SkillInfo[]> = {};
    for (const s of filtered) {
      (byPluginMap[s.plugin] ||= []).push(s);
    }
    const byPlugin = Object.entries(byPluginMap).sort((a, b) => a[0].localeCompare(b[0]));
    return { total: source.length, filtered: filtered.length, byPlugin };
  }

  return { own: buildSection(ownAll), installed: buildSection(installedAll) };
}

/**
 * Sidebar — composites search + OWN section + INSTALLED section + empty
 * and error states. Virtualization wiring lives in T-018; this component
 * exposes the thresholded list as a single path so swapping in a virtual
 * scroller is local to `<SectionList>`.
 */
export function Sidebar({ skills, selectedKey, onSelect, isLoading, error, onRetry, onContextMenu }: Props) {
  const [query, setQuery] = useState("");

  const { own, installed } = useMemo(
    () => partitionAndGroup(skills, query),
    [skills, query],
  );

  const combinedFiltered = own.filtered + installed.filtered;
  const useVirtual = combinedFiltered >= VIRTUALIZATION_THRESHOLD;

  // Flattened, alpha-sorted list across both sections — used by j/k navigation.
  // Same sort order the visible rows use, so keystrokes walk top→bottom.
  const flatSkills = useMemo<SkillInfo[]>(() => {
    const pull = (groups: Array<[string, SkillInfo[]]>): SkillInfo[] => {
      const out: SkillInfo[] = [];
      for (const [, list] of groups) {
        const sorted = [...list].sort((a, b) => a.skill.localeCompare(b.skill));
        out.push(...sorted);
      }
      return out;
    };
    return [...pull(own.byPlugin), ...pull(installed.byPlugin)];
  }, [own.byPlugin, installed.byPlugin]);

  const currentIndex = useMemo(() => {
    if (!selectedKey) return -1;
    return flatSkills.findIndex(
      (s) => s.plugin === selectedKey.plugin && s.skill === selectedKey.skill,
    );
  }, [flatSkills, selectedKey]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (flatSkills.length === 0) return;
      const next =
        currentIndex < 0
          ? delta > 0
            ? 0
            : flatSkills.length - 1
          : Math.min(Math.max(currentIndex + delta, 0), flatSkills.length - 1);
      onSelect(flatSkills[next]);
    },
    [flatSkills, currentIndex, onSelect],
  );

  useKeyboardShortcut(
    [
      { key: "j", handler: () => moveSelection(1) },
      { key: "k", handler: () => moveSelection(-1) },
      {
        key: "Enter",
        handler: () => {
          if (currentIndex >= 0) onSelect(flatSkills[currentIndex]);
        },
      },
    ],
    { enabled: !isLoading && !error },
  );

  return (
    <div
      data-testid="sidebar"
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        fontFamily: "var(--font-sans)",
      }}
    >
      <SidebarSearch value={query} onChange={setQuery} />

      {isLoading && <SidebarLoading />}

      {!isLoading && error && <SidebarError error={error} onRetry={onRetry} />}

      {!isLoading && !error && (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <SidebarSection origin="source" count={own.total} filteredCount={query ? own.filtered : null}>
            {own.filtered === 0 ? (
              <OwnEmptyState queryActive={!!query} />
            ) : (
              <SectionList
                items={own.byPlugin}
                selectedKey={selectedKey}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                useVirtual={useVirtual}
              />
            )}
          </SidebarSection>

          <FullWidthDivider />

          <SidebarSection origin="installed" count={installed.total} filteredCount={query ? installed.filtered : null}>
            {installed.filtered === 0 ? (
              <InstalledEmptyState queryActive={!!query} />
            ) : (
              <SectionList
                items={installed.byPlugin}
                selectedKey={selectedKey}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                useVirtual={useVirtual}
              />
            )}
          </SidebarSection>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section list — virtualization switch point (T-018 fills this in)
// ---------------------------------------------------------------------------

type VirtualRow =
  | { kind: "header"; plugin: string; count: number }
  | { kind: "row"; skill: SkillInfo };

function flattenForVirtual(items: Array<[string, SkillInfo[]]>): VirtualRow[] {
  const out: VirtualRow[] = [];
  for (const [plugin, list] of items) {
    const sorted = [...list].sort((a, b) => a.skill.localeCompare(b.skill));
    out.push({ kind: "header", plugin, count: sorted.length });
    for (const s of sorted) out.push({ kind: "row", skill: s });
  }
  return out;
}

function SectionList({
  items,
  selectedKey,
  onSelect,
  onContextMenu,
  useVirtual,
}: {
  items: Array<[plugin: string, skills: SkillInfo[]]>;
  selectedKey: SelectedKey | null;
  onSelect: (s: SkillInfo) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>, s: SkillInfo) => void;
  useVirtual: boolean;
}) {
  if (useVirtual) {
    const flat = flattenForVirtual(items);
    return (
      <div data-virtualized="true" style={{ height: 420, minHeight: 200 }}>
        <Virtuoso
          overscan={4}
          totalCount={flat.length}
          itemContent={(index) => {
            const item = flat[index];
            if (!item) return null;
            if (item.kind === "header") {
              return (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
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
                    }}
                  >
                    {item.plugin}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--text-secondary)",
                      fontVariantNumeric: "tabular-nums",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    ({item.count})
                  </span>
                </div>
              );
            }
            const s = item.skill;
            const isSelected =
              !!selectedKey && selectedKey.plugin === s.plugin && selectedKey.skill === s.skill;
            return (
              <SkillRow
                skill={s}
                isSelected={isSelected}
                onSelect={() => onSelect(s)}
                onContextMenu={onContextMenu}
              />
            );
          }}
        />
      </div>
    );
  }

  return (
    <div data-virtualized="false">
      {items.map(([plugin, list]) => (
        <PluginGroup
          key={plugin}
          plugin={plugin}
          skills={list}
          selectedKey={selectedKey}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / loading / error states
// ---------------------------------------------------------------------------

function OwnEmptyState({ queryActive }: { queryActive: boolean }) {
  if (queryActive) {
    return (
      <EmptyMessage
        headline="No matches in this section."
        body="Adjust the filter or press Escape to clear."
      />
    );
  }
  return (
    <EmptyMessage
      headline="No skills yet."
      body={
        <>
          Create one with <Mono>vskill new</Mono> or the{" "}
          <strong style={{ color: "var(--text-primary)" }}>New skill</strong> action in the top rail.
        </>
      }
    />
  );
}

function InstalledEmptyState({ queryActive }: { queryActive: boolean }) {
  if (queryActive) {
    return (
      <EmptyMessage
        headline="No matches in this section."
        body="Adjust the filter or press Escape to clear."
      />
    );
  }
  return (
    <EmptyMessage
      headline="No installed skills."
      body={
        <>
          Run <Mono>vskill install &lt;plugin&gt;</Mono> to add one.
        </>
      }
    />
  );
}

function EmptyMessage({ headline, body }: { headline: string; body: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 14px 16px",
        fontSize: 12,
        color: "var(--text-secondary)",
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 500, color: "var(--text-primary)", marginBottom: 4 }}>
        {headline}
      </div>
      <div>{body}</div>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--text-primary)",
        background: "color-mix(in srgb, var(--border-default) 45%, transparent)",
        padding: "1px 4px",
        borderRadius: 3,
      }}
    >
      {children}
    </code>
  );
}

function FullWidthDivider() {
  // Stops at column padding — never full-width per design.
  return (
    <div
      aria-hidden="true"
      style={{
        height: 1,
        background: "var(--border-default)",
        margin: "4px 14px",
      }}
    />
  );
}

function SidebarLoading() {
  return (
    <div style={{ padding: "8px 0" }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

function SidebarError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      style={{
        margin: "12px 14px",
        padding: 12,
        border: "1px solid var(--border-default)",
        borderRadius: 6,
        background: "var(--bg-canvas)",
        color: "var(--text-primary)",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Couldn't load skills.</div>
      <details>
        <summary
          style={{
            cursor: "pointer",
            color: "var(--text-secondary)",
            fontSize: 11,
            marginBottom: 4,
          }}
        >
          {shortError(error)}
        </summary>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-secondary)",
            margin: "6px 0 0",
          }}
        >
          {error}
        </pre>
      </details>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: 8,
            background: "transparent",
            border: "1px solid var(--border-default)",
            borderRadius: 4,
            padding: "4px 10px",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontSize: 11,
            fontFamily: "var(--font-sans)",
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function shortError(msg: string): string {
  const first = msg.split("\n")[0] ?? msg;
  return first.length > 80 ? first.slice(0, 77) + "…" : first;
}
