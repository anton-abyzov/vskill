import { useEffect, useCallback } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { useStudio } from "../../StudioContext";
import { api } from "../../api";
import { DetailHeader } from "../../components/DetailHeader";
import { TabBar } from "../../components/TabBar";
import { ErrorCard } from "../../components/ErrorCard";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { classifyErrorClient } from "../../shared/classifyErrorClient";
import { EditorPanel } from "./EditorPanel";
import { TestsPanel } from "./TestsPanel";
import { RunPanel } from "./RunPanel";
import { ActivationPanel } from "./ActivationPanel";
import { HistoryPanel } from "./HistoryPanel";
import { DepsPanel } from "./DepsPanel";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import type { PanelId } from "./workspaceTypes";

const VALID_PANELS: PanelId[] = ["editor", "tests", "run", "activation", "history", "leaderboard", "deps", "versions"];

function isValidPanel(value: string | null): value is PanelId {
  return value != null && (VALID_PANELS as string[]).includes(value);
}

export function SkillWorkspaceInner() {
  const { state, dispatch, saveContent, isReadOnly } = useWorkspace();
  const { state: studioState, refreshSkills, clearSelection } = useStudio();

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

    // Ctrl+1..8 — panel switching
    if (meta && e.key >= "1" && e.key <= "8") {
      e.preventDefault();
      const panels: PanelId[] = ["editor", "tests", "run", "activation", "history", "leaderboard", "deps", "versions"];
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
  const hasUpdate = studioState.skills.find((s) => s.skill === state.skill && s.plugin === state.plugin)?.updateAvailable ?? false;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Detail header */}
      <DetailHeader state={state} isReadOnly={isReadOnly} onDelete={isReadOnly ? undefined : handleDelete} />

      {/* Workspace-level error banner (e.g. delete failures) */}
      {state.error && (
        <div className="px-4 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <ErrorCard
            error={classifyErrorClient(state.error)}
            onDismiss={() => dispatch({ type: "SET_ERROR", error: null })}
          />
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
        hasUpdate={hasUpdate}
      />

      {/* Panel content */}
      <ErrorBoundary key={`${state.plugin}/${state.skill}`}>
        <div className="flex-1 overflow-hidden" style={{ background: "var(--surface-0)" }}>
          <div className="animate-fade-in" key={state.activePanel} style={{ height: "100%", overflow: "auto" }}>
            {state.activePanel === "editor" && <EditorPanel />}
            {state.activePanel === "tests" && <TestsPanel />}
            {state.activePanel === "run" && <RunPanel />}
            {state.activePanel === "activation" && <ActivationPanel />}
            {state.activePanel === "history" && <HistoryPanel />}
            {state.activePanel === "leaderboard" && <LeaderboardPanel />}
            {state.activePanel === "deps" && <DepsPanel />}
            {state.activePanel === "versions" && <VersionHistoryPanel />}
          </div>
        </div>
      </ErrorBoundary>
    </div>
  );
}
