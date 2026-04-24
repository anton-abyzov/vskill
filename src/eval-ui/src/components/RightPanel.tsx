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
  editor: "Editor",
  tests: "Tests",
  run: "Run",
  activation: "Activation",
  history: "History",
  leaderboard: "Leaderboard",
  deps: "Deps",
  versions: "Versions",
};

function isValidTab(value: unknown): value is DetailTab {
  return typeof value === "string" && (ALL_TABS as string[]).includes(value);
}

function readInitialTab(): DetailTab {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("panel");
  if (isValidTab(fromQuery)) return fromQuery;
  return "overview";
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
          onCreated={(plugin, skill) => {
            setMode("browse");
            refreshSkills();
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
  return renderSkillDetail(skill, active, props.onDetailTabChange, integrated);
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

  // Sync active tab to the ?panel= query param so deep links round-trip.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (active === "overview") {
      params.delete("panel");
    } else {
      params.set("panel", active);
    }
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? "?" + qs : ""}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  }, [active]);

  const content = useMemo(() => {
    if (!skillInfo) return <EmptyState variant="no-selection" />;
    return renderSkillDetail(skillInfo, active, setActive, { allSkills, onSelectSkill });
  }, [skillInfo, active, allSkills, onSelectSkill]);

  return <div className="flex flex-col h-full" style={{ background: "var(--bg-canvas)" }}>{content}</div>;
}

function renderTabBar(active: DetailTab, onChange?: (t: DetailTab) => void) {
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
      {ALL_TABS.map((t) => {
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
            {TAB_LABELS[t]}
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
function WorkspacePanel({ active }: { active: DetailTab }) {
  if (active === "editor") return <EditorPanel />;
  if (active === "tests") return <TestsPanel />;
  if (active === "run") return <RunPanel />;
  if (active === "activation") return <ActivationPanel />;
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
  integrated?: { allSkills: SkillInfo[]; onSelectSkill: (s: { plugin: string; skill: string; origin: "source" | "installed" }) => void },
) {
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
  const workspaceBody = integrated != null ? (
    <WorkspaceProvider
      key={`${skill.plugin}/${skill.skill}`}
      plugin={skill.plugin}
      skill={skill.skill}
      origin={skill.origin}
    >
      <WorkspaceTabSync active={active} />
      <WorkspacePanel active={active} />
    </WorkspaceProvider>
  ) : (
    <div style={{ padding: 16, fontFamily: "var(--font-sans)", color: "var(--text-secondary)", fontSize: 13 }}>
      Select a skill from the sidebar to load its {active} view.
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
      {renderTabBar(active, onChange)}
      <div
        role="tabpanel"
        id={`detail-panel-${active}`}
        aria-labelledby={`detail-tab-${active}`}
        data-testid={`detail-panel-${active}`}
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        {active === "overview" ? overviewBody : workspaceBody}
      </div>
    </div>
  );
}
