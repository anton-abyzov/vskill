import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { SkillInfo } from "../types";
import { SidebarSection } from "./SidebarSection";
import { ScopeSection } from "./ScopeSection";
import { SidebarSearch, matchSkillQuery } from "./SidebarSearch";
import { PluginGroup, type SelectedKey } from "./PluginGroup";
import { PluginTreeGroup } from "./PluginTreeGroup";
import { GroupHeader } from "./GroupHeader";
import { SkillRow } from "./SkillRow";
import { SkeletonRow } from "./SkeletonRow";
import { useKeyboardShortcut } from "../hooks/useKeyboardShortcut";
import { strings } from "../strings";

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
  /**
   * 0683 T-005: per-origin outdated counts, plumbed through from the
   * provider so each section header can render its `N updates ▾` chip.
   */
  outdatedByOrigin?: { source: number; installed: number };
  /**
   * 0686 T-007 (US-003): active agent id — drives tri-scope rendering and
   * scopes the ScopeSection localStorage keys. When omitted, Sidebar
   * keeps its legacy 2-section (Own / Installed) layout so this change
   * is a no-op for callers that haven't opted in yet.
   */
  activeAgentId?: string | null;
  /**
   * 0686 T-007 (US-003): per-scope outdated counts for tri-scope mode.
   * Extends 0683's two-key shape with `global`.
   */
  outdatedByScope?: { own: number; installed: number; global: number };
  /**
   * 0686 T-002 (US-002): optional sticky top-slot — App.tsx mounts the
   * AgentScopePicker here. When absent, the Sidebar renders without a
   * picker (legacy path). Kept as a slot so the Sidebar stays decoupled
   * from the server's AgentsResponse shape.
   */
  topSlot?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// 0686 T-003 / T-007 (US-003): tri-scope partition. Falls back to the
// legacy origin-based binary split when no skill carries a `scope` field —
// keeps pre-0686 payloads rendering identically.
// ---------------------------------------------------------------------------

function scopeOf(s: SkillInfo): "own" | "installed" | "global" {
  if (s.scope === "own" || s.scope === "installed" || s.scope === "global") {
    return s.scope;
  }
  // AC-US3-02 back-compat: missing scope maps via origin.
  return s.origin === "installed" ? "installed" : "own";
}

function partitionTriScope(
  skills: SkillInfo[],
  query: string,
): { own: SectionData; installed: SectionData; global: SectionData } {
  const ownAll: SkillInfo[] = [];
  const installedAll: SkillInfo[] = [];
  const globalAll: SkillInfo[] = [];
  for (const s of skills) {
    const scope = scopeOf(s);
    if (scope === "global") globalAll.push(s);
    else if (scope === "installed") installedAll.push(s);
    else ownAll.push(s);
  }
  function buildSection(source: SkillInfo[]): SectionData {
    const filtered = source.filter((s) => matchSkillQuery(s, query));
    const byPluginMap: Record<string, SkillInfo[]> = {};
    for (const s of filtered) {
      (byPluginMap[s.plugin] ||= []).push(s);
    }
    const byPlugin = Object.entries(byPluginMap).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    return { total: source.length, filtered: filtered.length, byPlugin };
  }
  return {
    own: buildSection(ownAll),
    installed: buildSection(installedAll),
    global: buildSection(globalAll),
  };
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
export function Sidebar({
  skills,
  selectedKey,
  onSelect,
  isLoading,
  error,
  onRetry,
  onContextMenu,
  outdatedByOrigin,
  activeAgentId,
  outdatedByScope,
  topSlot,
}: Props) {
  // 0686 T-007 (US-003): Tri-scope mode is enabled when the caller passes
  // an active agent OR when any incoming skill carries a `scope` field
  // (meaning the server enrichment is live). Default path stays 2-section
  // so pre-0686 callers continue to work.
  const triScope =
    !!activeAgentId || skills.some((s) => s.scope !== undefined && s.scope !== null);
  const resolvedAgentId = activeAgentId ?? "claude-cli";
  const [query, setQuery] = useState("");
  // T-0684 (Perf-2): defer the query so the input stays responsive even
  // when the filtered list is expensive to re-compute. The input keeps
  // rendering the typed value; `partitionAndGroup` consumes the deferred
  // value, so React is free to skip intermediate frames under load.
  const deferredQuery = useDeferredValue(query);

  const tri = useMemo(
    () => partitionTriScope(skills, deferredQuery),
    [skills, deferredQuery],
  );
  // Keep the legacy 2-section shape callable for the non-tri-scope code
  // path — it's just `own` + (`installed` + `global` merged into installed).
  const { own, installed } = useMemo(
    () => partitionAndGroup(skills, deferredQuery),
    [skills, deferredQuery],
  );

  const combinedFiltered = tri.own.filtered + tri.installed.filtered + tri.global.filtered;
  const useVirtual = combinedFiltered >= VIRTUALIZATION_THRESHOLD;

  // Flattened, alpha-sorted list across all rendered sections — used by j/k.
  // 0686 AC-US3-07: extends the legacy 2-section flatten to 3 sections when
  // tri-scope is active. In 2-section mode only own + installed are walked.
  const flatSkills = useMemo<SkillInfo[]>(() => {
    const pull = (groups: Array<[string, SkillInfo[]]>): SkillInfo[] => {
      const out: SkillInfo[] = [];
      for (const [, list] of groups) {
        const sorted = [...list].sort((a, b) => a.skill.localeCompare(b.skill));
        out.push(...sorted);
      }
      return out;
    };
    if (triScope) {
      return [
        ...pull(tri.own.byPlugin),
        ...pull(tri.installed.byPlugin),
        ...pull(tri.global.byPlugin),
      ];
    }
    return [...pull(own.byPlugin), ...pull(installed.byPlugin)];
  }, [triScope, tri.own.byPlugin, tri.installed.byPlugin, tri.global.byPlugin, own.byPlugin, installed.byPlugin]);

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
      {topSlot}
      <SidebarSearch value={query} onChange={setQuery} />

      {isLoading && <SidebarLoading />}

      {!isLoading && error && <SidebarError error={error} onRetry={onRetry} />}

      {!isLoading && !error && triScope && (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {/* 0698 T-009: two-tier sidebar — AVAILABLE umbrella wraps Project
              (legacy "installed") + Personal (legacy "global") sub-sections.
              AUTHORING umbrella wraps Skills (legacy "own"). Plugins nodes are
              rendered by T-010 PluginTreeGroup when source data is present.
              Counts always displayed even when zero. */}
          <GroupHeader
            name={strings.scopeLabels.groupAvailable.toUpperCase()}
            count={tri.installed.total + tri.global.total}
          />

          <ScopeSection
            scope="installed"
            agentId={resolvedAgentId}
            count={tri.installed.total}
            filteredCount={query ? tri.installed.filtered : null}
            updateCount={outdatedByScope?.installed ?? outdatedByOrigin?.installed}
          >
            {tri.installed.filtered === 0 ? (
              <InstalledEmptyState queryActive={!!query} agentId={resolvedAgentId} />
            ) : (
              <SectionList
                items={tri.installed.byPlugin}
                selectedKey={selectedKey}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                useVirtual={useVirtual}
              />
            )}
          </ScopeSection>

          <ScopeSection
            scope="global"
            agentId={resolvedAgentId}
            count={tri.global.total}
            filteredCount={query ? tri.global.filtered : null}
            updateCount={outdatedByScope?.global}
          >
            {tri.global.filtered === 0 ? (
              <GlobalEmptyState queryActive={!!query} agentId={resolvedAgentId} />
            ) : (
              <SectionList
                items={tri.global.byPlugin}
                selectedKey={selectedKey}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                useVirtual={useVirtual}
              />
            )}
          </ScopeSection>

          <BoldDivider />

          <GroupHeader
            name={strings.scopeLabels.groupAuthoring.toUpperCase()}
            count={tri.own.total}
          />

          <ScopeSection
            scope="own"
            agentId={resolvedAgentId}
            count={tri.own.total}
            filteredCount={query ? tri.own.filtered : null}
            updateCount={outdatedByScope?.own ?? outdatedByOrigin?.source}
          >
            {tri.own.filtered === 0 ? (
              <OwnEmptyState queryActive={!!query} />
            ) : (
              <SectionList
                items={tri.own.byPlugin}
                selectedKey={selectedKey}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                useVirtual={useVirtual}
              />
            )}
          </ScopeSection>
        </div>
      )}

      {!isLoading && !error && !triScope && (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <SidebarSection origin="source" count={own.total} filteredCount={query ? own.filtered : null} updateCount={outdatedByOrigin?.source}>
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

          <SidebarSection origin="installed" count={installed.total} filteredCount={query ? installed.filtered : null} updateCount={outdatedByOrigin?.installed}>
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

function InstalledEmptyState({
  queryActive,
  agentId,
}: {
  queryActive: boolean;
  agentId?: string;
}) {
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
      headline={
        agentId
          ? `No skills installed for ${agentId} in this project.`
          : "No installed skills."
      }
      body={
        <>
          Run <Mono>vskill install &lt;plugin&gt;</Mono> to add one.
        </>
      }
    />
  );
}

// 0686 AC-US3-04: GLOBAL empty state — scope-aware hint about
// `vskill install --global`.
function GlobalEmptyState({
  queryActive,
  agentId,
}: {
  queryActive: boolean;
  agentId: string;
}) {
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
      headline={`No global skills for ${agentId}.`}
      body={
        <>
          Run <Mono>vskill install --global &lt;plugin&gt;</Mono> to add one.
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

/**
 * 0686 AC-US4-02: 3px bold scope divider between tri-scope sections.
 * Full-width (extends past the 14px text padding) with a 1px inset shadow
 * on top so the divider reads as a strong scope boundary, not a hairline.
 */
function BoldDivider() {
  return (
    <div
      aria-hidden="true"
      data-testid="scope-bold-divider"
      style={{
        height: 3,
        background: "var(--color-rule)",
        boxShadow:
          "inset 0 1px 0 color-mix(in srgb, var(--color-rule) 50%, transparent)",
        margin: "12px 0",
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
