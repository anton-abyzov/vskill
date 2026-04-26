import { useState, useEffect, useMemo } from "react";
import { useStudio } from "../StudioContext";
import type { SkillInfo } from "../types";
import type { PanelId } from "../pages/workspace/workspaceTypes";
import { WorkspaceProvider, useWorkspace } from "../pages/workspace/WorkspaceContext";
import { VersionHistoryPanel } from "../pages/workspace/VersionHistoryPanel";
import { EditorPanel } from "../pages/workspace/EditorPanel";
import { TestsPanel } from "../pages/workspace/TestsPanel";
import { RunPanel } from "../pages/workspace/RunPanel";
import { ActivationPanel } from "../pages/workspace/ActivationPanel";
import { HistoryPanel } from "../pages/workspace/HistoryPanel";
import { LeaderboardPanel } from "../pages/workspace/LeaderboardPanel";
import { DepsPanel } from "../pages/workspace/DepsPanel";
import { CreateSkillInline } from "./CreateSkillInline";
import { EmptyState } from "./EmptyState";
import { UpdatesPanel } from "../pages/UpdatesPanel";
import { DetailHeader } from "./DetailHeader";
import { SkillOverview } from "./SkillOverview";
import { UpdateAction } from "./UpdateAction";
import { CheckNowButton } from "./CheckNowButton";
// 0774 T-009: secondary tab bar nested under top-level Run / Trigger tabs.
import { SubTabBar } from "./SubTabBar";
import type { SubTabDescriptor } from "./SubTabBar";

// ---------------------------------------------------------------------------
// 0707 T-007: Flat 9-tab detail view.
//
// Before: RightPanel rendered a 2-tab bar (Overview | Versions) and nested
// `SkillWorkspaceInner` inside the Overview panel, forcing users to scroll
// past the whole metadata column to reach Editor / Tests / Run / …
//
// After: RightPanel exposes all 9 tabs at the same level:
//
//   Overview | Editor | Tests | Run | Activation | History | Leaderboard | Deps | Versions
//
// Overview mounts the new `SkillOverview` component (responsive metric
// grid). Every other tab delegates to the existing workspace panel
// inside a shared WorkspaceProvider, so behavior is identical to what
// users saw before — only the navigation level changes.
//
// URL deep-linking: the `?panel=<id>` query param is now read and written
// at the RightPanel level so deep-links work regardless of whether the
// embedded workspace ever mounted.
// ---------------------------------------------------------------------------

type DetailTab = PanelId | "overview";

// 0769 Part B (T-019/T-022/T-023): persona-conditional tab descriptors.
//
// AUTHOR (origin === "source", isReadOnly === false) sees 6 tabs:
//   Overview | Edit | Tests | Run | Trigger | Versions
// CONSUMER (origin === "installed", isReadOnly === true) sees 3:
//   Overview | Trigger | Versions
//
// History, Leaderboard, and Deps are no longer top-level tabs — their
// existing panels remain rendered when the user deep-links via
// `?panel=history|leaderboard|deps` (so existing bookmarks don't 404), but
// the tab bar surfaces only the 6/3 set above.
//
// "Activation" is relabelled "Trigger" in the UI; the internal id stays
// `"activation"` (the panel id, the route names, the storage filenames are
// unchanged). Both `?panel=activation` and `?panel=trigger` resolve to the
// same panel — Trigger is the canonical written form.
interface TabDescriptor {
  id: DetailTab;
  label: string;
  /** Predicate against the persona signal — defaults to always-visible. */
  visibleWhen?: (ctx: { isReadOnly: boolean }) => boolean;
}

const TAB_DESCRIPTORS: TabDescriptor[] = [
  { id: "overview", label: "Overview" },
  { id: "editor", label: "Edit", visibleWhen: ({ isReadOnly }) => !isReadOnly },
  { id: "tests", label: "Tests", visibleWhen: ({ isReadOnly }) => !isReadOnly },
  { id: "run", label: "Run", visibleWhen: ({ isReadOnly }) => !isReadOnly },
  { id: "activation", label: "Trigger" },
  { id: "versions", label: "Versions" },
];

const ALL_TABS: DetailTab[] = [
  "overview",
  "editor",
  "tests",
  "run",
  "activation",
  "history",
  "leaderboard",
  "deps",
  "versions",
];

const TAB_LABELS: Record<DetailTab, string> = {
  overview: "Overview",
  editor: "Edit",
  tests: "Tests",
  run: "Run",
  activation: "Trigger",
  history: "History",
  leaderboard: "Leaderboard",
  deps: "Deps",
  versions: "Versions",
};

function isValidTab(value: unknown): value is DetailTab {
  return typeof value === "string" && (ALL_TABS as string[]).includes(value);
}

/** Persona-conditional visibility filter for the live tab bar. */
function visibleTabsFor(isReadOnly: boolean): TabDescriptor[] {
  return TAB_DESCRIPTORS.filter((t) => (t.visibleWhen ? t.visibleWhen({ isReadOnly }) : true));
}

function readInitialTab(): DetailTab {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("panel");
  // 0769 T-023: accept "trigger" as an alias for "activation" so the new
  // user-facing label round-trips through deep links.
  if (fromQuery === "trigger") return "activation";
  if (isValidTab(fromQuery)) return fromQuery;
  return "overview";
}

/**
 * 0769 T-024: when the URL deep-links to an author-only tab on a read-only
 * (consumer) skill, redirect to Overview. Returns the safe tab.
 *
 * Back-compat (F-001 followup): we explicitly allow `history`, `leaderboard`,
 * and `deps` deep-links even on consumer skills — these panels were eliminated
 * from the visible tab BAR (the IA reorg) but the panels themselves remain
 * mountable to honor existing bookmarks. Only the author-workbench tabs
 * (editor, tests, run) get redirected away from consumers.
 */
const CONSUMER_BACKCOMPAT_TABS: ReadonlySet<DetailTab> = new Set<DetailTab>([
  "history",
  "leaderboard",
  "deps",
]);

function applyPersonaRedirect(active: DetailTab, isReadOnly: boolean): DetailTab {
  if (!isReadOnly) return active;
  const allowed = new Set(visibleTabsFor(true).map((t) => t.id));
  if (allowed.has(active)) return active;
  if (CONSUMER_BACKCOMPAT_TABS.has(active)) return active;
  return "overview";
}

// ---------------------------------------------------------------------------
// 0774 Part B: sub-tab descriptors + URL helpers.
//
// Run tab gets `Run | History | Models` sub-modes (mounting RunPanel,
// HistoryPanel, LeaderboardPanel respectively — the existing standalone
// panels are reused as sub-tab children, no rewrites).
//
// Trigger tab (internal id "activation") gets `Run | History` sub-modes.
// The "history" sub-mode mounts ActivationPanel (whose existing in-panel
// history list surfaces past runs; cleaner extraction is a follow-up).
//
// Other top-level tabs have no sub-modes — SubTabBar is hidden for them.
// ---------------------------------------------------------------------------

const SUB_TAB_DESCRIPTORS: Partial<Record<DetailTab, SubTabDescriptor[]>> = {
  run: [
    { id: "run", label: "Run" },
    { id: "history", label: "History" },
    { id: "models", label: "Models" },
  ],
  activation: [
    { id: "run", label: "Run" },
    { id: "history", label: "History" },
  ],
};

/** Default sub-mode for a top-level tab — empty string when no sub-modes. */
export function defaultSubFor(active: DetailTab): string {
  const descriptors = SUB_TAB_DESCRIPTORS[active];
  return descriptors && descriptors.length > 0 ? descriptors[0].id : "";
}

/** Pure helper: read `?sub=` from a query string, validating against the
 *  active tab's descriptors. Falls back to the default sub-mode when the
 *  param is missing or unknown. Exported for unit testing. */
export function readInitialSub(active: DetailTab, search: string): string {
  const descriptors = SUB_TAB_DESCRIPTORS[active];
  if (!descriptors) return "";
  const params = new URLSearchParams(search);
  const fromQuery = params.get("sub");
  if (fromQuery && descriptors.some((d) => d.id === fromQuery)) {
    return fromQuery;
  }
  return descriptors[0].id;
}

interface Props {
  selectedSkillInfo?: SkillInfo | null;
  loadError?: string | null;
  activeDetailTab?: DetailTab;
  onDetailTabChange?: (t: DetailTab) => void;
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
            // 0772 US-004 (AC-US4-01): await refreshSkills BEFORE selecting so
            // the right-pane skillInfo lookup finds the new row. Without the
            // await, the URL hash flips but the detail view falls back to the
            // empty state because state.skills hasn't refreshed yet.
            setMode("browse");
            await refreshSkills();
            selectSkill({ plugin, skill, origin: "source" });
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
    // 0772 US-003: when global/plugin skills exist but the project bucket is
    // empty, surface actionable CTAs (Browse marketplaces / Create new skill)
    // instead of the passive "Select a skill" copy.
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
// Detail shell (test-friendly, stateless-ish)
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
  // 0779: positional-args fix. renderSkillDetail signature is
  // (skill, active, onChange, sub, onSubChange, integrated). The previous
  // 4-arg call passed `integrated` in the `sub` slot, so the real
  // `integrated` parameter was undefined — which made every non-overview
  // tab (Versions, Editor, Tests, Run, Trigger) render the "Select a skill
  // from the sidebar to load its <X> view." fallback in production
  // (App.tsx:560 always supplies selectedSkillInfo, hitting this path).
  return renderSkillDetail(
    skill,
    active,
    props.onDetailTabChange,
    "",
    undefined,
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
  const [active, setActive] = useState<DetailTab>(readInitialTab());
  // 0774 T-007: sub-tab state — initialized from URL, kept in sync via the
  // URL effect below.
  const [sub, setSub] = useState<string>(() =>
    readInitialSub(readInitialTab(), typeof window !== "undefined" ? window.location.search : ""),
  );

  // 0769 T-024: when the URL deep-links into a hidden author-only tab on a
  // read-only consumer skill, redirect to Overview ONCE and dispatch a toast.
  // The redirect runs as an effect (not in render) so we can fire the toast.
  useEffect(() => {
    if (!skillInfo) return;
    const isReadOnly = skillInfo.origin === "installed";
    if (!isReadOnly) return;
    const safe = applyPersonaRedirect(active, true);
    if (safe !== active) {
      setActive(safe);
      // Fire-and-forget toast — same `studio:toast` event other components use.
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

  // 0774 T-007: when the top-level tab changes, reset `sub` to the default
  // for the new tab (or empty if the new tab has no sub-modes). Without this
  // reset the URL would carry a stale `?sub=` after switching tabs.
  useEffect(() => {
    setSub(defaultSubFor(active));
  }, [active]);

  // 0769 T-023 + 0774 T-007: sync `active` AND `sub` to URL atomically so
  // deep links round-trip and switching tabs cleans up stale params.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (active === "overview") {
      params.delete("panel");
    } else {
      // 0769 T-023: canonical URL writes "trigger" not "activation".
      params.set("panel", active === "activation" ? "trigger" : active);
    }
    // Sub param: only set when the active tab actually has sub-modes AND
    // the current sub is non-default (default is implied by absence).
    const descriptors = SUB_TAB_DESCRIPTORS[active];
    if (descriptors && sub && sub !== descriptors[0].id) {
      params.set("sub", sub);
    } else {
      params.delete("sub");
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
// Panel renderers — Overview mounts SkillOverview directly, every other
// tab delegates to the existing workspace panels under a shared
// WorkspaceProvider so their behavior stays intact.
// ---------------------------------------------------------------------------
// 0774 T-008: WorkspacePanel dispatches on (active, sub) so Run + Trigger
// can mount different children per sub-mode. Other top-level tabs ignore
// `sub` and behave identically to before.
function WorkspacePanel({ active, sub }: { active: DetailTab; sub: string }) {
  if (active === "editor") return <EditorPanel />;
  if (active === "tests") return <TestsPanel />;
  if (active === "run") {
    // Run sub-modes: history -> HistoryPanel, models -> LeaderboardPanel,
    // run (default) -> RunPanel.
    if (sub === "history") return <HistoryPanel />;
    if (sub === "models") return <LeaderboardPanel />;
    return <RunPanel />;
  }
  if (active === "activation") {
    // Trigger sub-modes — both render ActivationPanel today; the panel's
    // existing in-panel history surfaces past runs. A future increment can
    // extract the history list into its own component for tighter UX.
    return <ActivationPanel />;
  }
  if (active === "history") return <HistoryPanel />;
  if (active === "leaderboard") return <LeaderboardPanel />;
  if (active === "deps") return <DepsPanel />;
  if (active === "versions") return <VersionHistoryPanel />;
  return null;
}

/**
 * Bridges the RightPanel-level active tab into the WorkspaceContext that
 * the inner panels read via `useWorkspace().state.activePanel`. Only
 * forwards panel changes when the tab is a panel-mounted one — Overview
 * intentionally leaves the workspace reducer alone.
 */
function WorkspaceTabSync({ active }: { active: DetailTab }) {
  const { state, dispatch } = useWorkspace();
  useEffect(() => {
    if (active === "overview") return;
    if (state.activePanel !== active) {
      dispatch({ type: "SET_PANEL", panel: active });
    }
  }, [active, state.activePanel, dispatch]);
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
  // 0769 T-024: persona signal — installed skills are read-only consumers.
  const isReadOnly = skill.origin === "installed";
  const safeActive = applyPersonaRedirect(active, isReadOnly);
  const onNavigate = (panel: PanelId) => {
    onChange?.(panel);
  };

  const overviewBody = (
    <SkillOverview
      skill={skill}
      onNavigate={onNavigate}
      repoUrl={skill.homepage ?? null}
    />
  );

  // For all non-overview tabs we wrap in a single WorkspaceProvider so the
  // inner panels keep their existing state machine. The provider is keyed
  // on the skill identity so switching skills rebuilds state cleanly.
  // 0774 T-010 (F-004 fix): pass safeActive (post-persona-redirect) so the
  // mounted panel matches the visible tab on the very first render — no
  // one-frame ARIA mismatch when consumers deep-link to author tabs.
  const workspaceBody = integrated != null ? (
    <WorkspaceProvider
      key={`${skill.plugin}/${skill.skill}`}
      plugin={skill.plugin}
      skill={skill.skill}
      origin={skill.origin}
    >
      <WorkspaceTabSync active={safeActive} />
      <WorkspacePanel active={safeActive} sub={sub} />
    </WorkspaceProvider>
  ) : (
    <div style={{ padding: 16, fontFamily: "var(--font-sans)", color: "var(--text-secondary)", fontSize: 13 }}>
      Select a skill from the sidebar to load its {safeActive} view.
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-canvas)" }}>
      <div style={{ padding: 16, paddingBottom: 12 }}>
        {DetailHeader({ skill })}
      </div>
      {/* 0683 T-010: "Update to X.Y.Z" block appears directly under the
          header when an update is pending, so it is visible regardless of
          which tab is active. Returns null when no update is available. */}
      <UpdateAction skill={skill} />
      {/* Read-only banner explains why edit/run/generate buttons are disabled
          when viewing an installed copy. Sits above the Check-now row so
          it's the first thing users see before reaching disabled controls. */}
      {skill.origin === "installed" && (
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
          {/* 0780: Uninstall button — visible only for lockfile-tracked
              installed skills. Plugin-bundled skills (trackedForUpdates=false)
              are managed by the PluginActionMenu instead. */}
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
      )}
      {/* 0708 T-073/T-074 + wrap-up: per-skill "Check now" rescan button.
          Renders only for tracked skills (sourceRepoUrl present) per
          AC-US8-04. Placed alongside UpdateAction so users can manually
          probe the upstream repo without leaving the detail view.

          0769 T-017 (US-006): hide for plugin-cache installs
          (scopeV2 === "available-plugin"). Plugin-cache skills update via
          Claude Code's plugin manager, NOT via verified-skill.com — the
          /api/v1/skills/:id/rescan endpoint doesn't exist for them and the
          button would 404. We let CC own its own plugin updates. */}
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
      {/* 0774 T-009: secondary tab bar nests under the top-level bar for
          tabs that have sub-modes (Run, Trigger). Hidden for tabs without
          sub-modes (Overview, Edit, Tests, Versions). When onSubChange
          isn't wired (prop-driven tests), the bar still renders but
          clicks are no-ops — keeps visibility tests simple. */}
      {SUB_TAB_DESCRIPTORS[safeActive] && (
        <SubTabBar
          parentTabId={safeActive}
          tabs={SUB_TAB_DESCRIPTORS[safeActive]!}
          active={sub || (SUB_TAB_DESCRIPTORS[safeActive]![0]?.id ?? "")}
          onChange={onSubChange ?? (() => {})}
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
