import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { usePluginsPolling } from "../hooks/usePluginsPolling";
import { Virtuoso } from "react-virtuoso";
import type { SkillInfo } from "../types";
import { SidebarSection } from "./SidebarSection";
// ScopeSection (0686 T-007/T-009 OWN/INSTALLED/GLOBAL primitive) was deleted
// 2026-04-25: superseded by 0698-studio-multiproject-anthropic-scopes (which
// replaced the tri-scope model with AVAILABLE/AUTHORING groups rendered via
// GroupHeader + NamedScopeSection below). See plan.md for the F-001 resolution.
import { SidebarSearch, matchSkillQuery } from "./SidebarSearch";
import { PluginGroup, type SelectedKey } from "./PluginGroup";
import { PluginTreeGroup } from "./PluginTreeGroup";
import { PluginActionMenu } from "./PluginActionMenu";
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
   * 0686 T-007 (US-003) / 0698: active agent id — scopes the per-section
   * collapse storage keys (`vskill-sidebar-<agentId>-<scope>-collapsed`).
   * When omitted, Sidebar keeps its legacy 2-section (Own / Installed)
   * layout so this change is a no-op for callers that haven't opted in.
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
  /**
   * 0704: when set, force-open the matching section + subtree on the next
   * render and scroll the matching row into view. Cleared via
   * `onRevealComplete` once the scroll fires so later selections don't
   * trigger another scroll.
   */
  revealSkillId?: string | null;
  /** 0704: called after Sidebar scrolls the reveal target into view. */
  onRevealComplete?: () => void;
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

// 0698 T-009 (fix): partition by new group+source axes. Buckets map 1:1 to
// the two-tier sidebar layout: AVAILABLE = (project, personal, plugin);
// AUTHORING = (project, plugin). Plugin buckets additionally track their
// `pluginName` for PluginTreeGroup rendering.
interface FiveScopeBuckets {
  availableProject: SectionData;
  availablePersonal: SectionData;
  availablePlugin: SectionData;
  authoringProject: SectionData;
  authoringPlugin: SectionData;
}

function partitionByGroupSource(
  skills: SkillInfo[],
  query: string,
): FiveScopeBuckets {
  const bins = {
    availableProject: [] as SkillInfo[],
    availablePersonal: [] as SkillInfo[],
    availablePlugin: [] as SkillInfo[],
    authoringProject: [] as SkillInfo[],
    authoringPlugin: [] as SkillInfo[],
  };
  for (const s of skills) {
    // Prefer scopeV2; fall back to deriving from legacy `scope` field so
    // the UI keeps working if the server hasn't populated the new fields yet.
    const v2 =
      s.scopeV2 ??
      (s.scope === "installed"
        ? "available-project"
        : s.scope === "global"
          ? "available-personal"
          : "authoring-project");
    if (v2 === "available-project") bins.availableProject.push(s);
    else if (v2 === "available-personal") bins.availablePersonal.push(s);
    else if (v2 === "available-plugin") bins.availablePlugin.push(s);
    else if (v2 === "authoring-plugin") bins.authoringPlugin.push(s);
    else bins.authoringProject.push(s);
  }

  function buildSection(source: SkillInfo[]): SectionData {
    const filtered = source.filter((s) => matchSkillQuery(s, query));
    const byPluginMap: Record<string, SkillInfo[]> = {};
    for (const s of filtered) {
      // For plugin rows, group by the plugin's real name (pluginName), not
      // the workspace-level `plugin` dir that the standalone scanner emits.
      const key = s.pluginName ?? s.plugin;
      (byPluginMap[key] ||= []).push(s);
    }
    const byPlugin = Object.entries(byPluginMap).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    return { total: source.length, filtered: filtered.length, byPlugin };
  }

  return {
    availableProject: buildSection(bins.availableProject),
    availablePersonal: buildSection(bins.availablePersonal),
    availablePlugin: buildSection(bins.availablePlugin),
    authoringProject: buildSection(bins.authoringProject),
    authoringPlugin: buildSection(bins.authoringPlugin),
  };
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
  revealSkillId,
  onRevealComplete,
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
  // 0698 T-009 (fix): five-bucket partition drives the AVAILABLE (Project /
  // Personal / Plugins) + AUTHORING (Skills / Plugins) rendering.
  const five = useMemo(
    () => partitionByGroupSource(skills, deferredQuery),
    [skills, deferredQuery],
  );
  const isClaudeCode = resolvedAgentId === "claude-code";

  // 0700: fetch installed plugin list so the per-plugin "⋯" action menu
  // knows whether to show Enable vs Disable. usePluginsPolling provides
  // controlled backoff + AbortController cleanup (fixes 0736 runaway retry).
  const { plugins: rawPluginList } = usePluginsPolling();
  const pluginListData = isClaudeCode ? { plugins: rawPluginList ?? [] } : undefined;
  const pluginEnabledByName = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const p of pluginListData?.plugins ?? []) {
      // When a plugin is installed at multiple scopes, treat it as enabled if
      // ANY scope has it enabled (the UI action targets the default scope).
      const prev = map.get(p.name);
      map.set(p.name, Boolean(prev) || Boolean(p.enabled));
    }
    return map;
  }, [pluginListData?.plugins]);

  // 0698 (polish): AVAILABLE / AUTHORING groups are collapsible. Persist per
  // agent so users can park their preferred layout (e.g. collapse AVAILABLE to
  // focus on AUTHORING while building new skills).
  const [availableCollapsed, setAvailableCollapsed] = useState(() =>
    readCollapsedSafe(`vskill-sidebar-${resolvedAgentId}-group-available-collapsed`),
  );
  const [authoringCollapsed, setAuthoringCollapsed] = useState(() =>
    readCollapsedSafe(`vskill-sidebar-${resolvedAgentId}-group-authoring-collapsed`),
  );
  const toggleAvailable = useCallback(
    (next: boolean) => {
      setAvailableCollapsed(next);
      try {
        window.localStorage.setItem(
          `vskill-sidebar-${resolvedAgentId}-group-available-collapsed`,
          String(next),
        );
      } catch { /* non-fatal */ }
    },
    [resolvedAgentId],
  );
  const toggleAuthoring = useCallback(
    (next: boolean) => {
      setAuthoringCollapsed(next);
      try {
        window.localStorage.setItem(
          `vskill-sidebar-${resolvedAgentId}-group-authoring-collapsed`,
          String(next),
        );
      } catch { /* non-fatal */ }
    },
    [resolvedAgentId],
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

  // 0704: derive which bucket a reveal target lives in so we know which
  // ancestors to force-open. `null` when no reveal is active.
  const revealTarget = useMemo(() => {
    if (!revealSkillId) return null;
    const [plugin, skill] = revealSkillId.split("/");
    if (!plugin || !skill) return null;
    const match = skills.find((s) => s.plugin === plugin && s.skill === skill);
    if (!match) {
      return { plugin, skill, bucket: null as "project" | "plugin" | null, pluginName: null as string | null };
    }
    const bucket: "project" | "plugin" = match.source === "plugin" ? "plugin" : "project";
    const pluginName = bucket === "plugin" ? (match.pluginName ?? plugin) : null;
    return { plugin, skill, bucket, pluginName };
  }, [revealSkillId, skills]);

  // 0704: scroll the reveal row into view once it exists in the DOM.
  // Re-runs on `skills` changes so a just-added skill is caught on the
  // rehydrate tick. Clears via onRevealComplete only when scroll runs.
  // F-003: guard with `lastScrolledId` so that if `skills` mutates again
  // before CLEAR_REVEAL settles (SWR refetch, poll tick), we don't fire
  // scrollIntoView + onRevealComplete a second time for the same reveal.
  const lastScrolledId = useRef<string | null>(null);
  useEffect(() => {
    if (!revealSkillId) {
      lastScrolledId.current = null;
      return;
    }
    if (lastScrolledId.current === revealSkillId) return;
    const safe = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(revealSkillId)
      : revealSkillId.replace(/["\\]/g, "\\$&");
    const row = document.querySelector<HTMLElement>(`[data-skill-id="${safe}"]`);
    if (!row) return;
    lastScrolledId.current = revealSkillId;
    row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    onRevealComplete?.();
  }, [revealSkillId, onRevealComplete, skills]);

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
          {/* 0698 T-009: two-tier sidebar with Anthropic-aligned labels.
              AVAILABLE → Project / Personal / Plugins (CC only).
              AUTHORING → Skills / Plugins (CC only).
              Counts always displayed, including zero. */}
          <GroupHeader
            name={strings.scopeLabels.groupAvailable.toUpperCase()}
            variant="available"
            collapsed={availableCollapsed}
            onToggle={toggleAvailable}
            count={
              five.availableProject.total +
              five.availablePersonal.total +
              five.availablePlugin.total
            }
          />

          {!availableCollapsed && (
          <>
          <NamedScopeSection
            label={strings.scopeLabels.sourceProject}
            storageKey={`vskill-sidebar-${resolvedAgentId}-available-project-collapsed`}
            count={five.availableProject.total}
            filteredCount={query ? five.availableProject.filtered : null}
            updateCount={outdatedByScope?.installed ?? outdatedByOrigin?.installed}
          >
            {five.availableProject.filtered === 0 ? (
              <InstalledEmptyState queryActive={!!query} agentId={resolvedAgentId} />
            ) : (
              <SectionList
                items={five.availableProject.byPlugin}
                selectedKey={selectedKey}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                useVirtual={useVirtual}
              />
            )}
          </NamedScopeSection>

          <NamedScopeSection
            label={strings.scopeLabels.sourcePersonal}
            storageKey={`vskill-sidebar-${resolvedAgentId}-available-personal-collapsed`}
            count={five.availablePersonal.total}
            filteredCount={query ? five.availablePersonal.filtered : null}
            updateCount={outdatedByScope?.global}
          >
            {five.availablePersonal.filtered === 0 ? (
              <GlobalEmptyState queryActive={!!query} agentId={resolvedAgentId} />
            ) : (
              <SectionList
                items={five.availablePersonal.byPlugin}
                selectedKey={selectedKey}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                useVirtual={useVirtual}
              />
            )}
          </NamedScopeSection>

          {isClaudeCode && (
            <NamedScopeSection
              label={strings.scopeLabels.sourcePlugin}
              storageKey={`vskill-sidebar-${resolvedAgentId}-available-plugin-collapsed`}
              count={five.availablePlugin.total}
              filteredCount={query ? five.availablePlugin.filtered : null}
            >
              {/* 0700 phase 2B: "Browse" entry point → opens MarketplaceDrawer. */}
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("studio:open-marketplace"))
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  margin: "4px 14px 6px",
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 500,
                  border: "1px dashed var(--color-accent, #2f6f8f)",
                  borderRadius: 4,
                  background: "transparent",
                  color: "var(--color-accent, #2f6f8f)",
                  cursor: "pointer",
                }}
              >
                <span aria-hidden>🛒</span> Browse marketplaces…
              </button>
              {five.availablePlugin.filtered === 0 ? (
                <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-secondary)" }}>
                  No plugin skills installed yet.
                </div>
              ) : (
                five.availablePlugin.byPlugin.map(([pluginName, pluginSkills]) => (
                  <PluginTreeGroup
                    key={`available-${pluginName}`}
                    pluginName={pluginName}
                    skills={pluginSkills}
                    persistKey={`vskill-plugin-available-${pluginName}-collapsed`}
                    headerActionSlot={
                      isClaudeCode ? (
                        <PluginActionMenu
                          pluginName={pluginName}
                          enabled={pluginEnabledByName.get(pluginName) ?? true}
                        />
                      ) : undefined
                    }
                    renderSkill={(skill) => (
                      <SkillRow
                        skill={skill}
                        isSelected={
                          selectedKey?.plugin === skill.plugin &&
                          selectedKey?.skill === skill.skill
                        }
                        onSelect={() => onSelect(skill)}
                        onContextMenu={onContextMenu}
                      />
                    )}
                  />
                ))
              )}
            </NamedScopeSection>
          )}

          </>
          )}

          <BoldDivider />

          <GroupHeader
            name={strings.scopeLabels.groupAuthoring.toUpperCase()}
            variant="authoring"
            collapsed={revealTarget ? false : authoringCollapsed}
            onToggle={toggleAuthoring}
            count={five.authoringProject.total + five.authoringPlugin.total}
            action={{
              label: "New",
              title: "Create a new skill (standalone or plugin)",
              icon: (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              ),
              onClick: () => {
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("studio:request-create-skill", {
                      detail: { mode: "standalone" },
                    }),
                  );
                }
              },
            }}
          />

          {(!authoringCollapsed || revealTarget) && (
          <>
          <NamedScopeSection
            label={strings.scopeLabels.authoringSkills}
            storageKey={`vskill-sidebar-${resolvedAgentId}-authoring-project-collapsed`}
            count={five.authoringProject.total}
            filteredCount={query ? five.authoringProject.filtered : null}
            updateCount={outdatedByScope?.own ?? outdatedByOrigin?.source}
            forceOpen={revealTarget?.bucket === "project"}
          >
            {five.authoringProject.filtered === 0 ? (
              <OwnEmptyState queryActive={!!query} />
            ) : (
              <SectionList
                items={five.authoringProject.byPlugin}
                selectedKey={selectedKey}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                useVirtual={useVirtual}
              />
            )}
          </NamedScopeSection>

          {isClaudeCode && (
            <NamedScopeSection
              label={strings.scopeLabels.sourcePlugin}
              storageKey={`vskill-sidebar-${resolvedAgentId}-authoring-plugin-collapsed`}
              count={five.authoringPlugin.total}
              filteredCount={query ? five.authoringPlugin.filtered : null}
              forceOpen={revealTarget?.bucket === "plugin"}
            >
              {five.authoringPlugin.filtered === 0 ? (
                <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-secondary)" }}>
                  No plugin sources in this project. Add <code>&lt;plugin&gt;/.claude-plugin/plugin.json</code>.
                </div>
              ) : (
                five.authoringPlugin.byPlugin.map(([pluginName, pluginSkills]) => (
                  <PluginTreeGroup
                    key={`authoring-${pluginName}`}
                    pluginName={pluginName}
                    skills={pluginSkills}
                    persistKey={`vskill-plugin-authoring-${pluginName}-collapsed`}
                    forceOpen={revealTarget?.bucket === "plugin" && revealTarget.pluginName === pluginName}
                    renderSkill={(skill) => (
                      <SkillRow
                        skill={skill}
                        isSelected={
                          selectedKey?.plugin === skill.plugin &&
                          selectedKey?.skill === skill.skill
                        }
                        onSelect={() => onSelect(skill)}
                        onContextMenu={onContextMenu}
                      />
                    )}
                  />
                ))
              )}
            </NamedScopeSection>
          )}
          </>
          )}
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
// 0698 T-009 (fix): NamedScopeSection — lightweight collapsible section that
// takes an explicit label + storageKey. Used by the new five-bucket layout so
// headers can render Anthropic-aligned labels (Project / Personal / Plugins /
// Skills). This is the live tri-scope rendering primitive; the original 0686
// `ScopeSection` (own/installed/global) was deleted 2026-04-25 after 0698
// superseded its scope enum.
// ---------------------------------------------------------------------------

function readCollapsedSafe(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function NamedScopeSection({
  label,
  storageKey,
  count,
  filteredCount,
  updateCount,
  children,
  forceOpen = false,
}: {
  label: string;
  storageKey: string;
  count: number;
  filteredCount?: number | null;
  updateCount?: number;
  children?: React.ReactNode;
  /**
   * 0704: transient override — render expanded regardless of persisted
   * state. Does not touch localStorage so the user's preference is
   * restored once forceOpen goes false.
   */
  forceOpen?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(() => readCollapsedSafe(storageKey));
  // 0704: forceOpen overrides collapsed without mutating it.
  const effectiveCollapsed = forceOpen ? false : collapsed;
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(storageKey, String(next));
        } catch {
          /* non-fatal */
        }
      }
      return next;
    });
  }, [storageKey]);

  const countLabel =
    filteredCount != null && filteredCount !== count
      ? `${filteredCount} of ${count}`
      : String(count);

  return (
    <section data-vskill-named-scope={label}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!effectiveCollapsed}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-sans)",
          textAlign: "left",
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--color-ink, var(--text-primary))",
            width: 16,
            display: "inline-block",
            textAlign: "center",
          }}
        >
          {effectiveCollapsed ? "▸" : "▾"}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-primary)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            fontVariantNumeric: "tabular-nums",
            fontFamily: "var(--font-mono)",
          }}
        >
          ({countLabel})
        </span>
        {updateCount != null && updateCount > 0 && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              color: "var(--color-own, #f59e0b)",
            }}
          >
            {updateCount} update{updateCount !== 1 ? "s" : ""}
          </span>
        )}
      </button>
      {!effectiveCollapsed && (
        // 0700 polish: indent children so plugin headers + skill rows sit
        // visually nested under the section label (which starts ~28px in
        // from the left after the chevron + gap). Without this padding the
        // legacy `PluginGroup` kickers (e.g. ".CLAUDE (2)") and their skill
        // rows creep back to the left edge, breaking the nested hierarchy.
        <div style={{ paddingLeft: 18 }}>{children}</div>
      )}
    </section>
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
