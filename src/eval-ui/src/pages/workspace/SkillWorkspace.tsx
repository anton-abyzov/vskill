import { useEffect, useCallback } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { useStudio } from "../../StudioContext";
import { api } from "../../api";
import { DetailHeader } from "../../components/DetailHeader";
import { TabBar } from "../../components/TabBar";
import { EditorPanel } from "./EditorPanel";
import { TestsPanel } from "./TestsPanel";
import { RunPanel } from "./RunPanel";
import { ActivationPanel } from "./ActivationPanel";
import { HistoryPanel } from "./HistoryPanel";
import { DepsPanel } from "./DepsPanel";
import type { PanelId } from "./workspaceTypes";

const VALID_PANELS: PanelId[] = ["editor", "tests", "run", "activation", "history", "deps"];

function isValidPanel(value: string | null): value is PanelId {
  return value != null && (VALID_PANELS as string[]).includes(value);
}

export function SkillWorkspaceInner() {
  const { state, dispatch, saveContent, isReadOnly } = useWorkspace();
  const { refreshSkills, clearSelection } = useStudio();

  const handleDelete = useCallback(async () => {
    try {
      await api.deleteSkill(state.plugin, state.skill);
      refreshSkills();
      clearSelection();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: "SET_ERROR", error: `Failed to delete skill: ${msg}` });
    }
  }, [state.plugin, state.skill, refreshSkills, clearSelection, dispatch]);

  // ---------------------------------------------------------------------------
  // URL query param deep-linking: sync activePanel <-> ?panel=
  // ---------------------------------------------------------------------------
  // On mount, read ?panel= from URL and set active panel
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const panel = params.get("panel");
    if (isValidPanel(panel) && panel !== state.activePanel) {
      dispatch({ type: "SET_PANEL", panel });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  // On panel change, update URL with replaceState
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("panel", state.activePanel);
    const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    history.replaceState(null, "", newUrl);
  }, [state.activePanel]);

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
      <DetailHeader state={state} isReadOnly={isReadOnly} onDelete={isReadOnly ? undefined : handleDelete} />

      {/* Workspace-level error banner (e.g. delete failures) */}
      {state.error && (
        <div
          className="flex items-center gap-2 px-4 py-2 text-[12px]"
          style={{ background: "var(--red-muted)", color: "var(--red)", borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span className="flex-1">{state.error}</span>
          <button
            onClick={() => dispatch({ type: "SET_ERROR", error: null })}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", padding: 2 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

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
