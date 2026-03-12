import { useStudio } from "../StudioContext";
import { WorkspaceProvider } from "../pages/workspace/WorkspaceContext";
import { SkillWorkspaceInner } from "../pages/workspace/SkillWorkspace";
import { CreateSkillInline } from "./CreateSkillInline";
import { EmptyState } from "./EmptyState";

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

export function RightPanel() {
  const { state, selectSkill, setMode, refreshSkills } = useStudio();

  // Create mode
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

  // No skill selected
  if (!state.selectedSkill) {
    if (state.skillsError) {
      return <EmptyState variant="error" message={state.skillsError} onRetry={refreshSkills} />;
    }
    if (!state.skillsLoading && state.skills.length === 0) {
      return <EmptyState variant="no-skills" />;
    }
    return <EmptyState variant="no-selection" />;
  }

  // Skill selected — key-based remount ensures clean SSE on skill switch
  const { plugin, skill, origin } = state.selectedSkill;
  return (
    <div className="flex flex-col h-full">
      <MobileBackButton />
      <div className="flex-1 overflow-hidden">
        <WorkspaceProvider key={`${plugin}/${skill}`} plugin={plugin} skill={skill} origin={origin}>
          <SkillWorkspaceInner />
        </WorkspaceProvider>
      </div>
    </div>
  );
}
