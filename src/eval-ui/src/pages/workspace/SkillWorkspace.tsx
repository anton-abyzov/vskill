import { useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { LeftRail } from "./LeftRail";
import { EditorPanel } from "./EditorPanel";
import { TestsPanel } from "./TestsPanel";
import { RunPanel } from "./RunPanel";
import { HistoryPanel } from "./HistoryPanel";
import { DepsPanel } from "./DepsPanel";
import type { PanelId } from "./workspaceTypes";

function WorkspaceInner() {
  const { state, dispatch, saveContent } = useWorkspace();

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const meta = e.ctrlKey || e.metaKey;

    // Ctrl+1..5 — panel switching
    if (meta && e.key >= "1" && e.key <= "5") {
      e.preventDefault();
      const panels: PanelId[] = ["editor", "tests", "run", "history", "deps"];
      dispatch({ type: "SET_PANEL", panel: panels[parseInt(e.key) - 1] });
      return;
    }

    // Ctrl+S — save
    if (meta && e.key === "s" && !e.shiftKey) {
      e.preventDefault();
      if (state.isDirty) saveContent();
      return;
    }
  }, [state.isDirty, saveContent, dispatch]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (state.loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: "var(--surface-0)" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="spinner spinner-lg" />
          <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>Loading workspace...</span>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "48px 1fr",
        gridTemplateRows: "auto 1fr",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header — spans full width */}
      <div style={{ gridColumn: "1 / -1" }}>
        <WorkspaceHeader state={state} />
      </div>

      {/* Left rail */}
      <div style={{ gridRow: 2 }}>
        <LeftRail
          activePanel={state.activePanel}
          onPanelChange={(p) => dispatch({ type: "SET_PANEL", panel: p })}
          isDirty={state.isDirty}
          isRunning={Array.from(state.caseRunStates.values()).some((s) => s.status === "running" || s.status === "queued")}
          hasRegressions={state.regressions.length > 0}
        />
      </div>

      {/* Panel content */}
      <div style={{ gridRow: 2, overflow: "auto", background: "var(--surface-0)" }}>
        <div className="animate-fade-in" key={state.activePanel}>
          {state.activePanel === "editor" && <EditorPanel />}
          {state.activePanel === "tests" && <TestsPanel />}
          {state.activePanel === "run" && <RunPanel />}
          {state.activePanel === "history" && <HistoryPanel />}
          {state.activePanel === "deps" && <DepsPanel />}
        </div>
      </div>
    </div>
  );
}

export function SkillWorkspace() {
  const { plugin, skill } = useParams<{ plugin: string; skill: string }>();

  if (!plugin || !skill) {
    return (
      <div className="px-10 py-8">
        <p style={{ color: "var(--red)" }}>Missing plugin or skill parameter.</p>
      </div>
    );
  }

  return (
    <WorkspaceProvider plugin={plugin} skill={skill}>
      <WorkspaceInner />
    </WorkspaceProvider>
  );
}
