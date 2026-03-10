import { useEffect, useCallback } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { DetailHeader } from "../../components/DetailHeader";
import { TabBar } from "../../components/TabBar";
import { EditorPanel } from "./EditorPanel";
import { TestsPanel } from "./TestsPanel";
import { RunPanel } from "./RunPanel";
import { ActivationPanel } from "./ActivationPanel";
import { HistoryPanel } from "./HistoryPanel";
import { DepsPanel } from "./DepsPanel";
import type { PanelId } from "./workspaceTypes";

export function SkillWorkspaceInner() {
  const { state, dispatch, saveContent } = useWorkspace();

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const meta = e.ctrlKey || e.metaKey;

    // Ctrl+1..6 — panel switching
    if (meta && e.key >= "1" && e.key <= "6") {
      e.preventDefault();
      const panels: PanelId[] = ["editor", "tests", "run", "activation", "history", "deps"];
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
      <div className="flex items-center justify-center h-full" style={{ background: "var(--surface-0)" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="spinner spinner-lg" />
          <span className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>Loading workspace...</span>
        </div>
      </div>
    );
  }

  const isRunning = Array.from(state.caseRunStates.values()).some((s) => s.status === "running" || s.status === "queued");

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Detail header */}
      <DetailHeader state={state} />

      {/* Tab bar */}
      <TabBar
        activePanel={state.activePanel}
        onPanelChange={(p) => dispatch({ type: "SET_PANEL", panel: p })}
        isDirty={state.isDirty}
        isRunning={isRunning}
        hasRegressions={state.regressions.length > 0}
        isActivationRunning={state.activationRunning}
      />

      {/* Panel content */}
      <div className="flex-1 overflow-hidden" style={{ background: "var(--surface-0)" }}>
        <div className="animate-fade-in" key={state.activePanel} style={{ height: "100%", overflow: "auto" }}>
          {state.activePanel === "editor" && <EditorPanel />}
          {state.activePanel === "tests" && <TestsPanel />}
          {state.activePanel === "run" && <RunPanel />}
          {state.activePanel === "activation" && <ActivationPanel />}
          {state.activePanel === "history" && <HistoryPanel />}
          {state.activePanel === "deps" && <DepsPanel />}
        </div>
      </div>
    </div>
  );
}
