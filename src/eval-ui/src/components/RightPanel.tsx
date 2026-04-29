import { useState, useEffect, useMemo } from "react";
import { useStudio } from "../StudioContext";
import type { SkillInfo } from "../types";
import type { PanelId } from "../pages/workspace/workspaceTypes";
import { WorkspaceProvider, useWorkspace } from "../pages/workspace/WorkspaceContext";
import { EditorPanel } from "../pages/workspace/EditorPanel";
import { ActivationPanel } from "../pages/workspace/ActivationPanel";
import {
  RunDispatcherPanel,
  type RunDispatcherMode,
  isValidRunMode,
} from "../pages/workspace/RunDispatcherPanel";
import {
  HistoryShell,
  type HistoryView,
  isValidHistoryView,
} from "../pages/workspace/HistoryShell";
import { CreateSkillInline } from "./CreateSkillInline";
import { EmptyState } from "./EmptyState";
import { UpdatesPanel } from "../pages/UpdatesPanel";
import { DetailHeader } from "./DetailHeader";
import { SkillOverview } from "./SkillOverview";
import { UpdateAction } from "./UpdateAction";
import { CheckNowButton } from "./CheckNowButton";
// 0774 T-009: secondary tab bar nested under top-level tabs that have modes.
import { SubTabBar } from "./SubTabBar";
import type { SubTabDescriptor } from "./SubTabBar";

// ---------------------------------------------------------------------------
// 0792 T-013: Unified IA — 4 top-level tabs.
//
// History:
// - 0707 T-007 expanded the bar to 9 flat tabs.
// - 0769 Part B narrowed it to 6 author / 3 consumer tabs.
// - 0792 collapses Tests/Run/Trigger into a single "Run" surface and
//   unifies History/Leaderboard/Versions under a single "History" surface,
//   leaving exactly four top-level tabs:
//
//     Overview | Edit | Run | History
//
// Within Run there are three modes (Benchmark / Activation / A/B) and within
// History there are three views (Timeline / Models / Versions). Both are
// rendered through `SubTabBar` and reflected in the URL as `?mode=` and
// `?view=` respectively.
//
// Eval-case authoring (the previous "Tests" tab content) now lives as an
// "Eval cases" section inside the Edit tab — see EditorPanel.tsx.
// ---------------------------------------------------------------------------

export type DetailTab = "overview" | "edit" | "run" | "history";

interface TabDescriptor {
  id: DetailTab;
  label: string;
  /** Predicate against the persona signal — defaults to always-visible. */
  visibleWhen?: (ctx: { isReadOnly: boolean }) => boolean;
}

const TAB_DESCRIPTORS: TabDescriptor[] = [
  { id: "overview", label: "Overview" },
  { id: "edit", label: "Edit", visibleWhen: ({ isReadOnly }) => !isReadOnly },
  // Run is visible for both authors and consumers — consumers may still want
  // to invoke a Trigger (activation) test on installed skills. Within Run we
  // hide the Benchmark mode for read-only consumers via RunDispatcherPanel
  // mode visibility (future work — non-blocking here).
  { id: "run", label: "Run" },
  { id: "history", label: "History" },
];

const ALL_TABS: DetailTab[] = ["overview", "edit", "run", "history"];

function isValidTab(value: unknown): value is DetailTab {
  return typeof value === "string" && (ALL_TABS as string[]).includes(value);
}

/** Persona-conditional visibility filter for the live tab bar. */
function visibleTabsFor(isReadOnly: boolean): TabDescriptor[] {
  return TAB_DESCRIPTORS.filter((t) => (t.visibleWhen ? t.visibleWhen({ isReadOnly }) : true));
}

// ---------------------------------------------------------------------------
// Legacy URL redirects (AC-US1-06).
//
// Old `?panel=` / `?tab=` values must keep working for bookmarks and shared
// links. The redirect runs on read — `readInitialTab` returns the new tab id
// and a "rewrite" flag tells the URL effect to call `history.replaceState`
// once so the canonical form is what the user sees in the bar.
// ---------------------------------------------------------------------------

type RedirectTarget = { tab: DetailTab; mode?: RunDispatcherMode; view?: HistoryView };

const LEGACY_REDIRECTS: Record<string, RedirectTarget> = {
  // Old "Tests" → Run benchmark (eval execution moved to Run).
  tests: { tab: "run", mode: "benchmark" },
  // Old "Trigger" / "Activation" → Run activation mode.
  trigger: { tab: "run", mode: "activation" },
  activation: { tab: "run", mode: "activation" },
  // Old "Versions" → History versions view.
  versions: { tab: "history", view: "versions" },
  // Synthetic/old leaderboard + history sub-tabs.
  leaderboard: { tab: "history", view: "models" },
  // "editor" was the old PanelId — map to new "edit".
  editor: { tab: "edit" },
  // Identity entries make the lookup unconditional.
  overview: { tab: "overview" },
  edit: { tab: "edit" },
  run: { tab: "run" },
  history: { tab: "history" },
};

/** Resolve a raw URL token to the new IA. Returns `null` when unrecognized. */
export function resolveLegacyTab(raw: string | null | undefined): RedirectTarget | null {
  if (!raw) return null;
  const target = LEGACY_REDIRECTS[raw];
  return target ?? null;
}

/** Read both the new `?tab=` and the legacy `?panel=` param, preferring the
 *  new param when both are set. Returns the resolved redirect target. */
export function readInitialTabFromSearch(search: string): RedirectTarget {
  const params = new URLSearchParams(search);
  const fromTab = params.get("tab");
  const fromPanel = params.get("panel");
  const resolved = resolveLegacyTab(fromTab) ?? resolveLegacyTab(fromPanel);
  return resolved ?? { tab: "overview" };
}

function readInitialTab(): DetailTab {
  if (typeof window === "undefined") return "overview";
  return readInitialTabFromSearch(window.location.search).tab;
}

// ---------------------------------------------------------------------------
// 0769 T-024 (carried forward): when a deep link points at an author-only
// tab on a read-only consumer skill, redirect to Overview.
// ---------------------------------------------------------------------------

function applyPersonaRedirect(active: DetailTab, isReadOnly: boolean): DetailTab {
  if (!isReadOnly) return active;
  const allowed = new Set(visibleTabsFor(true).map((t) => t.id));
  if (allowed.has(active)) return active;
  return "overview";
}

// ---------------------------------------------------------------------------
// Sub-tab descriptors.
// ---------------------------------------------------------------------------

const SUB_TAB_DESCRIPTORS: Partial<Record<DetailTab, SubTabDescriptor[]>> = {
  run: [
    { id: "benchmark", label: "Benchmark" },
    { id: "activation", label: "Activation" },
    { id: "ab", label: "A/B" },
  ],
  history: [
    { id: "timeline", label: "Timeline" },
    { id: "models", label: "Models" },
    { id: "versions", label: "Versions" },
  ],
};

/** Default sub-mode for a top-level tab — empty string when no sub-modes. */
export function defaultSubFor(active: DetailTab): string {
  const descriptors = SUB_TAB_DESCRIPTORS[active];
  return descriptors && descriptors.length > 0 ? descriptors[0].id : "";
}

/** Pure helper: read `?mode=` (run) or `?view=` (history) from a query
 *  string, validating against the active tab's descriptors. Falls back to
 *  the default sub-mode when missing or unknown. Exported for unit testing. */
export function readInitialSub(active: DetailTab, search: string): string {
  const descriptors = SUB_TAB_DESCRIPTORS[active];
  if (!descriptors) return "";
  const params = new URLSearchParams(search);
  const paramName = active === "run" ? "mode" : active === "history" ? "view" : "sub";
  const fromQuery = params.get(paramName) ?? params.get("sub");
  if (fromQuery && descriptors.some((d) => d.id === fromQuery)) {
    return fromQuery;
  }
  return descriptors[0].id;
}

/** Map a top-level tab id to the URL param that carries its sub-mode. */
function subParamFor(active: DetailTab): "mode" | "view" | null {
  if (active === "run") return "mode";
  if (active === "history") return "view";
  return null;
}

// ---------------------------------------------------------------------------
// Bridge: SkillOverview / BenchmarkInfoPopover still use the legacy
// `PanelId` enum for navigation. Translate to the new DetailTab so callers
// don't have to change.
// ---------------------------------------------------------------------------

interface DetailNavTarget {
  tab: DetailTab;
  mode?: RunDispatcherMode;
  view?: HistoryView;
}

export function panelIdToDetail(panel: PanelId): DetailNavTarget {
  switch (panel) {
    case "editor":
    case "tests":
    case "deps":
      return { tab: "edit" };
    case "run":
      return { tab: "run", mode: "benchmark" };
    case "activation":
      return { tab: "run", mode: "activation" };
    case "history":
      return { tab: "history", view: "timeline" };
    case "leaderboard":
      return { tab: "history", view: "models" };
    case "versions":
      return { tab: "history", view: "versions" };
    default:
      return { tab: "overview" };
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  selectedSkillInfo?: SkillInfo | null;
  loadError?: string | null;
  activeDetailTab?: DetailTab;
  onDetailTabChange?: (t: DetailTab) => void;
  // 0792 PLAN_CORRECTION: sub state lifted into App.tsx so the prop-driven
  // path (which is the only one that mounts in production) drives Run mode
  // chips and History view chips. Without these, sub clicks were silent
  // no-ops because IntegratedDetailShell — the prior owner of sub state —
  // is unreachable in app context.
  activeDetailSub?: string;
  onDetailSubChange?: (s: string) => void;
  allSkills?: SkillInfo[];
  onSelectSkill?: (s: { plugin: string; skill: string; origin: "source" | "installed" }) => void;
}

function MobileBackButton() {
  const { state, setMobileView } = useStudio();
  if (!state.isMobile) return null;
  return (
    <button
      onClick={() => setMobileView("list")}
      className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium"
      style={{
        background: "var(--surface-1)",
        color: "var(--text-secondary)",
        border: "none",
        borderBottom: "1px solid var(--border-subtle)",
        cursor: "pointer",
        width: "100%",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Back to skills
    </button>
  );
}

export function RightPanel(props: Props = {}) {
  // ---- In test / isolated mode the caller passes explicit props ----------
  if (props.selectedSkillInfo !== undefined || props.loadError !== undefined) {
    return renderDetailShell(props);
  }

  // ---- Integrated mode: pull selection out of StudioContext --------------
  const { state, selectSkill, setMode, refreshSkills } = useStudio();
  const [hash, setHash] = useState(typeof window !== "undefined" ? window.location.hash : "");

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (hash === "#/updates") {
    return (
      <div className="h-full overflow-auto animate-fade-in">
        <MobileBackButton />
        <UpdatesPanel />
      </div>
    );
  }

  if (state.mode === "create") {
    return (
      <div className="h-full overflow-auto animate-fade-in">
        <MobileBackButton />
        <CreateSkillInline
          onCreated={async (plugin, skill) => {
            // 0772 US-004 (AC-US4-01): await refreshSkills BEFORE selecting.
            setMode("browse");
            await refreshSkills();
            // 0801: newly-authored skills land in the authoring-project scope,
            // so source="project". Reload re-resolves source from skill data
            // via the hash parser, so this is just the optimistic initial value.
            selectSkill({ plugin, skill, origin: "source", source: "project" });
          }}
          onCancel={() => setMode("browse")}
        />
      </div>
    );
  }

  if (!state.selectedSkill) {
    if (state.skillsError) {
      return <EmptyState variant="error" message={state.skillsError} onRetry={refreshSkills} />;
    }
    if (!state.skillsLoading && state.skills.length === 0) {
      return <EmptyState variant="no-skills" />;
    }
    if (
      !state.skillsLoading &&
      state.skills.length > 0 &&
      !state.skills.some((s) => s.scopeV2 === "available-project")
    ) {
      return <EmptyState variant="no-project-skills" />;
    }
    return <EmptyState variant="no-selection" />;
  }

  const selected = state.selectedSkill;
  const skillInfo = state.skills.find(
    (s) => s.plugin === selected.plugin && s.skill === selected.skill,
  ) ?? null;

  return (
    <div className="flex flex-col h-full">
      <MobileBackButton />
      <IntegratedDetailShell
        skillInfo={skillInfo}
        allSkills={state.skills}
        onSelectSkill={(sel) => selectSkill(sel)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail shell — the prop-driven path. App.tsx mounts this branch by always
// passing `selectedSkillInfo`; the IntegratedDetailShell path below is now
// reserved for isolated tests that don't supply props.
// ---------------------------------------------------------------------------
function renderDetailShell(props: Props) {
  const skill = props.selectedSkillInfo ?? null;
  const active: DetailTab = props.activeDetailTab ?? "overview";

  if (skill == null) {
    return renderEmptyState();
  }
  if (props.loadError) {
    return renderErrorState(skill, props.loadError);
  }
  const integrated =
    props.allSkills && props.onSelectSkill
      ? { allSkills: props.allSkills, onSelectSkill: props.onSelectSkill }
      : undefined;
  // Sub: prefer the App-provided value (production), fall back to the
  // descriptor default for tests that only supply the top-level tab.
  const sub = props.activeDetailSub ?? defaultSubFor(active);
  return renderSkillDetail(
    skill,
    active,
    props.onDetailTabChange,
    sub,
    props.onDetailSubChange,
    integrated,
  );
}

function IntegratedDetailShell({
  skillInfo,
  allSkills,
  onSelectSkill,
}: {
  skillInfo: SkillInfo | null;
  allSkills: SkillInfo[];
  onSelectSkill: (s: { plugin: string; skill: string; origin: "source" | "installed" }) => void;
}) {
  // 0792 T-014: read URL with legacy redirect, then write the canonical
  // `?tab=` once in an effect (replaceState — no back-button trap).
  const initial = useMemo<RedirectTarget>(() => {
    if (typeof window === "undefined") return { tab: "overview" };
    return readInitialTabFromSearch(window.location.search);
  }, []);
  const [active, setActive] = useState<DetailTab>(initial.tab);
  const [sub, setSub] = useState<string>(() => {
    // Initial sub: prefer explicit redirect-target hint, else URL-derived,
    // else descriptor default.
    if (initial.mode) return initial.mode;
    if (initial.view) return initial.view;
    return readInitialSub(initial.tab, typeof window !== "undefined" ? window.location.search : "");
  });

  // 0769 T-024: persona redirect for read-only skills (carried forward).
  useEffect(() => {
    if (!skillInfo) return;
    const isReadOnly = skillInfo.origin === "installed";
    if (!isReadOnly) return;
    const safe = applyPersonaRedirect(active, true);
    if (safe !== active) {
      setActive(safe);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("studio:toast", {
            detail: {
              message: "This skill is read-only — workbench tabs are hidden.",
              severity: "info",
            },
          }),
        );
      }
    }
  }, [skillInfo, active]);

  // When the top-level tab changes, reset `sub` to the default for the new
  // tab (or empty if the new tab has no sub-modes).
  useEffect(() => {
    setSub(defaultSubFor(active));
  }, [active]);

  // Sync `active` AND `sub` to the URL atomically. Uses the new canonical
  // `?tab=` + `?mode=` / `?view=` keys; legacy `?panel=` and `?sub=` are
  // stripped on every write so the URL converges to the new contract.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    // Strip legacy keys regardless.
    params.delete("panel");
    params.delete("sub");
    if (active === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", active);
    }
    const subParam = subParamFor(active);
    const descriptors = SUB_TAB_DESCRIPTORS[active];
    // Clear all possible sub keys before deciding which to set.
    params.delete("mode");
    params.delete("view");
    if (subParam && descriptors && sub && sub !== descriptors[0].id) {
      params.set(subParam, sub);
    }
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? "?" + qs : ""}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  }, [active, sub]);

  const content = useMemo(() => {
    if (!skillInfo) return <EmptyState variant="no-selection" />;
    return renderSkillDetail(skillInfo, active, setActive, sub, setSub, { allSkills, onSelectSkill });
  }, [skillInfo, active, sub, allSkills, onSelectSkill]);

  return <div className="flex flex-col h-full" style={{ background: "var(--bg-canvas)" }}>{content}</div>;
}

function renderTabBar(
  active: DetailTab,
  onChange: ((t: DetailTab) => void) | undefined,
  isReadOnly: boolean,
) {
  const tabs = visibleTabsFor(isReadOnly);
  return (
    <div
      role="tablist"
      aria-label="Detail sections"
      data-testid="detail-tab-bar"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 4,
        borderBottom: "1px solid var(--border-default)",
        padding: "0 16px",
        background: "var(--bg-canvas)",
        overflowX: "auto",
      }}
    >
      {tabs.map(({ id: t, label }) => {
        const isActive = t === active;
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            id={`detail-tab-${t}`}
            aria-controls={`detail-panel-${t}`}
            data-testid={`detail-tab-${t}`}
            onClick={() => onChange?.(t)}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: isActive ? "2px solid var(--text-primary)" : "2px solid transparent",
              padding: "10px 8px",
              marginBottom: -1,
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function renderEmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: 32,
        background: "var(--bg-canvas)",
      }}
    >
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 20,
          fontWeight: 500,
          color: "var(--text-primary)",
          margin: 0,
          marginBottom: 8,
        }}
      >
        Select a skill to view details
      </h2>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          color: "var(--text-secondary)",
          margin: 0,
          maxWidth: 420,
          textAlign: "center",
        }}
      >
        Choose a skill from the sidebar — its frontmatter, filesystem info, and benchmark status will appear here.
      </p>
    </div>
  );
}

function renderErrorState(skill: SkillInfo, message: string) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 24,
        background: "var(--bg-canvas)",
        height: "100%",
      }}
    >
      {DetailHeader({ skill })}
      <section
        role="alert"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          padding: "14px 16px",
        }}
      >
        <h3
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 15,
            fontWeight: 500,
            color: "var(--text-primary)",
            margin: "0 0 8px",
          }}
        >
          Couldn't load SKILL.md for {skill.skill}
        </h3>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: "var(--text-secondary)",
            margin: "0 0 12px",
            wordBreak: "break-word",
          }}
        >
          {message}
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel renderers — Overview mounts SkillOverview directly. Edit, Run, and
// History delegate to existing or wrapper components inside a shared
// WorkspaceProvider so the underlying state machines remain intact.
// ---------------------------------------------------------------------------
function WorkspacePanel({ active, sub }: { active: DetailTab; sub: string }) {
  if (active === "edit") return <EditorPanel />;
  if (active === "run") {
    const mode = isValidRunMode(sub) ? sub : "benchmark";
    return <RunDispatcherPanel mode={mode} />;
  }
  if (active === "history") {
    const view = isValidHistoryView(sub) ? sub : "timeline";
    return <HistoryShell view={view} />;
  }
  return null;
}

/**
 * Bridges the RightPanel-level active tab into the WorkspaceContext that
 * the inner panels read via `useWorkspace().state.activePanel`. Maps the
 * new top-level tab ids to the legacy PanelId enum so the inner reducer
 * keeps working without churn.
 *
 * - "edit" → "editor"
 * - "run" + sub mode → "run" (benchmark/ab) or "activation"
 * - "history" → "history" (LeaderboardPanel/VersionHistoryPanel observe
 *   `activePanel === "history"` already; their internal view differentiation
 *   is owned by HistoryShell)
 */
function WorkspaceTabSync({ active, sub }: { active: DetailTab; sub: string }) {
  const { state, dispatch } = useWorkspace();
  useEffect(() => {
    if (active === "overview") return;
    const target: PanelId = (() => {
      if (active === "edit") return "editor";
      if (active === "run") return sub === "activation" ? "activation" : "run";
      if (active === "history") {
        if (sub === "models") return "leaderboard";
        if (sub === "versions") return "versions";
        return "history";
      }
      return "editor";
    })();
    if (state.activePanel !== target) {
      dispatch({ type: "SET_PANEL", panel: target });
    }
  }, [active, sub, state.activePanel, dispatch]);
  return null;
}

function renderSkillDetail(
  skill: SkillInfo,
  active: DetailTab,
  onChange?: (t: DetailTab) => void,
  sub: string = "",
  onSubChange?: (s: string) => void,
  integrated?: { allSkills: SkillInfo[]; onSelectSkill: (s: { plugin: string; skill: string; origin: "source" | "installed" }) => void },
) {
  const isReadOnly = skill.origin === "installed";
  const safeActive = applyPersonaRedirect(active, isReadOnly);

  // SkillOverview / BenchmarkInfoPopover hand us a legacy PanelId; translate
  // to the new IA before forwarding the tab change.
  const onNavigate = (panel: PanelId) => {
    const target = panelIdToDetail(panel);
    onChange?.(target.tab);
    if (onSubChange) {
      if (target.mode) onSubChange(target.mode);
      else if (target.view) onSubChange(target.view);
    }
  };

  const overviewBody = (
    <SkillOverview
      skill={skill}
      onNavigate={onNavigate}
      repoUrl={skill.homepage ?? null}
    />
  );

  const workspaceBody = integrated != null ? (
    <WorkspaceProvider
      key={`${skill.plugin}/${skill.skill}`}
      plugin={skill.plugin}
      skill={skill.skill}
      origin={skill.origin}
    >
      <WorkspaceTabSync active={safeActive} sub={sub} />
      <WorkspacePanel active={safeActive} sub={sub} />
    </WorkspaceProvider>
  ) : (
    <div style={{ padding: 16, fontFamily: "var(--font-sans)", color: "var(--text-secondary)", fontSize: 13 }}>
      Select a skill from the sidebar to load its {safeActive} view.
    </div>
  );

  // Read-only consumer skills get an installed copy banner. Activation
  // (Trigger) testing is allowed on installed skills — the banner only
  // disables editing/running, not the Run tab's activation mode.
  const installedBanner = skill.origin === "installed" && (
    <div
      data-testid="read-only-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        background: "var(--surface-2)",
        color: "var(--text-secondary)",
        borderBottom: "1px solid var(--border-subtle)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, color: "var(--text-tertiary)" }}
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <span style={{ flex: 1, minWidth: 0 }}>
        This is an installed copy of the skill. Editing, generating tests, and running evals are disabled. Open the source skill to make changes.
      </span>
      {skill.trackedForUpdates && (
        <button
          type="button"
          data-testid="uninstall-button"
          aria-label={`Uninstall ${skill.skill}`}
          onClick={() => {
            if (typeof window === "undefined") return;
            window.dispatchEvent(
              new CustomEvent("studio:request-uninstall", {
                detail: {
                  skill: {
                    plugin: skill.plugin,
                    skill: skill.skill,
                    dir: skill.dir ?? "",
                    hasEvals: false,
                    hasBenchmark: false,
                    evalCount: 0,
                    assertionCount: 0,
                    benchmarkStatus: "missing",
                    lastBenchmark: null,
                    origin: "installed",
                  },
                },
              }),
            );
          }}
          style={{
            flexShrink: 0,
            marginLeft: 8,
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: 500,
            fontFamily: "var(--font-sans)",
            color: "var(--text-primary)",
            background: "transparent",
            border: "1px solid var(--border-default, var(--border-subtle))",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Uninstall
        </button>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-canvas)" }}>
      <div style={{ padding: 16, paddingBottom: 12 }}>
        {DetailHeader({ skill })}
      </div>
      <UpdateAction skill={skill} />
      {installedBanner}
      {skill.origin === "installed" && skill.scopeV2 !== "available-plugin" && (
        <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border-default)" }}>
          <CheckNowButton
            plugin={skill.plugin}
            skill={skill.skill}
            trackedForUpdates={skill.trackedForUpdates}
          />
        </div>
      )}
      {renderTabBar(safeActive, onChange, isReadOnly)}
      {SUB_TAB_DESCRIPTORS[safeActive] && (
        <SubTabBar
          parentTabId={safeActive}
          tabs={SUB_TAB_DESCRIPTORS[safeActive]!}
          active={sub || (SUB_TAB_DESCRIPTORS[safeActive]![0]?.id ?? "")}
          onChange={onSubChange}
        />
      )}
      <div
        role="tabpanel"
        id={`detail-panel-${safeActive}`}
        aria-labelledby={`detail-tab-${safeActive}`}
        data-testid={`detail-panel-${safeActive}`}
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        {safeActive === "overview" ? overviewBody : workspaceBody}
      </div>
    </div>
  );
}
