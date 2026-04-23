import { useState, useEffect, useMemo } from "react";
import { useStudio } from "../StudioContext";
import type { SkillInfo } from "../types";
import { WorkspaceProvider } from "../pages/workspace/WorkspaceContext";
import { VersionHistoryPanel } from "../pages/workspace/VersionHistoryPanel";
import { SkillWorkspaceInner } from "../pages/workspace/SkillWorkspace";
import { CreateSkillInline } from "./CreateSkillInline";
import { EmptyState } from "./EmptyState";
import { UpdatesPanel } from "../pages/UpdatesPanel";
import { DetailHeader } from "./DetailHeader";
import { MetadataTab } from "./MetadataTab";

// ---------------------------------------------------------------------------
// T-031: Detail-panel host with Overview / Versions tab bar.
// T-033: Empty-state + load-error hosting.
//
// RightPanel is the right-hand pane of the redesigned studio layout. When no
// skill is selected it renders the calm no-selection empty state. When a
// skill is selected it renders:
//
//   [ DetailHeader ]              ← skill name, origin dot, path chip
//   [ Tab bar: Overview | Versions | Workspace ]
//   [ Panel body ]                ← MetadataTab / VersionHistoryPanel / SkillWorkspaceInner
//
// The "Workspace" tab is preserved as an escape hatch to the existing 8-tab
// editor/tests/run flow so no functionality is lost during the phased
// redesign — only the default tab is now Overview (MetadataTab).
//
// Props are optional so unit tests can drive the component in isolation
// without mounting the full StudioContext / WorkspaceContext tree.
// ---------------------------------------------------------------------------

type DetailTab = "overview" | "versions";

interface Props {
  selectedSkillInfo?: SkillInfo | null;
  loadError?: string | null;
  activeDetailTab?: DetailTab;
  onDetailTabChange?: (t: DetailTab) => void;
  // T-063: Pass-through from App.tsx so the Versions tab and skill-dep
  // chips in Overview actually render their integrated content instead of
  // falling back to the "Select a skill from the sidebar…" placeholder
  // (qa-findings #1 / #12). When present, renderSkillDetail threads them
  // into the `integrated` bag consumed by both tab panels.
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

  // Resolve full SkillInfo for the current selection
  const selected = state.selectedSkill;
  const skillInfo = state.skills.find(
    (s) => s.plugin === selected.plugin && s.skill === selected.skill,
  ) ?? null;

  return (
    <div className="flex flex-col h-full">
      <MobileBackButton />
      <IntegratedDetailShell skillInfo={skillInfo} allSkills={state.skills} onSelectSkill={(sel) => selectSkill(sel)} />
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
  // T-063: Forward the integrated-mode bag (allSkills + onSelectSkill) so
  // the Versions tab and skill-dep chips render their live content.
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
  const [active, setActive] = useState<DetailTab>("overview");

  const content = useMemo(() => {
    if (!skillInfo) return <EmptyState variant="no-selection" />;
    return renderSkillDetail(skillInfo, active, setActive, { allSkills, onSelectSkill });
  }, [skillInfo, active, allSkills, onSelectSkill]);

  return <div className="flex flex-col h-full" style={{ background: "var(--bg-canvas)" }}>{content}</div>;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "versions", label: "Versions" },
];

function renderTabBar(active: DetailTab, onChange?: (t: DetailTab) => void) {
  return (
    <div
      role="tablist"
      aria-label="Detail sections"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 4,
        borderBottom: "1px solid var(--border-default)",
        padding: "0 16px",
        background: "var(--bg-canvas)",
      }}
    >
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            id={`detail-tab-${t.id}`}
            aria-controls={`detail-panel-${t.id}`}
            onClick={() => onChange?.(t.id)}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: isActive ? "2px solid var(--text-primary)" : "2px solid transparent",
              padding: "10px 4px",
              marginBottom: -1,
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            {t.label}
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
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              padding: "4px 10px",
              border: "1px solid var(--border-default)",
              borderRadius: 4,
              background: "transparent",
              color: "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            Open in editor
          </button>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(skill.dir)}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              padding: "4px 10px",
              border: "1px solid var(--border-default)",
              borderRadius: 4,
              background: "transparent",
              color: "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            Copy path
          </button>
        </div>
      </section>
    </div>
  );
}

function renderSkillDetail(
  skill: SkillInfo,
  active: DetailTab,
  onChange?: (t: DetailTab) => void,
  integrated?: { allSkills: SkillInfo[]; onSelectSkill: (s: { plugin: string; skill: string; origin: "source" | "installed" }) => void },
) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-canvas)" }}>
      <div style={{ padding: 16, paddingBottom: 12 }}>
        {DetailHeader({ skill })}
      </div>
      {renderTabBar(active, onChange)}
      <div
        role="tabpanel"
        id={`detail-panel-${active}`}
        aria-labelledby={`detail-tab-${active}`}
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        {active === "overview" && (
          <>
            {MetadataTab({
              skill,
              allSkills: integrated?.allSkills ?? [],
              onSelectSkill: integrated?.onSelectSkill,
            })}
            {/* T-0684 (B5 / B6): mount SkillWorkspaceInner so the workspace
                TabBar (Editor / Tests / Run / Leaderboard / …) is
                accessible from the default Overview view. The 0674
                redesign removed the `/skills/:plugin/:skill` workspace
                route without replacing the navigation surface, which
                left leaderboard.spec.ts and tests-panel.spec.ts with no
                way to reach the panels they exercise. hideHeader keeps
                `getByTestId("detail-header")` matching exactly one
                element so detail-panel.spec.ts stays green. */}
            {integrated != null && (
              <WorkspaceProvider
                key={`${skill.plugin}/${skill.skill}-workspace`}
                plugin={skill.plugin}
                skill={skill.skill}
                origin={skill.origin}
              >
                <div style={{ minHeight: 520, display: "flex", flexDirection: "column" }}>
                  <SkillWorkspaceInner hideHeader />
                </div>
              </WorkspaceProvider>
            )}
          </>
        )}
        {active === "versions" && integrated != null && (
          <WorkspaceProvider key={`${skill.plugin}/${skill.skill}-versions`} plugin={skill.plugin} skill={skill.skill} origin={skill.origin}>
            <div style={{ padding: 16 }}>
              <VersionHistoryPanel />
            </div>
          </WorkspaceProvider>
        )}
        {active === "versions" && integrated == null && (
          <div style={{ padding: 16, fontFamily: "var(--font-sans)", color: "var(--text-secondary)", fontSize: 13 }}>
            Select a skill from the sidebar to load its version history.
          </div>
        )}
      </div>
    </div>
  );
}
