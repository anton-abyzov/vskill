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

export interface SkillWorkspaceInnerProps {
  /**
   * T-0684 (B5 / B6): when true, skip rendering the duplicate
   * `<DetailHeader />`. Used by RightPanel when the SkillWorkspaceInner
   * is embedded beneath the already-rendered metadata detail header —
   * otherwise `getByTestId("detail-header")` in detail-panel.spec.ts
   * would resolve to two elements and fail.
   */
  hideHeader?: boolean;
}

export function SkillWorkspaceInner({ hideHeader = false }: SkillWorkspaceInnerProps = {}) {
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
      {!hideHeader && (
        <DetailHeader state={state} isReadOnly={isReadOnly} onDelete={isReadOnly ? undefined : handleDelete} />
      )}

      {/* Read-only banner — explains why edit/run/generate buttons are disabled */}
      {isReadOnly && (
        <div
          data-testid="read-only-banner"
          className="flex items-center gap-2 px-4 py-2 text-[12px]"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-secondary)",
            borderBottom: "1px solid var(--border-subtle)",
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
          <span>
            This is an installed copy of the skill. Editing, generating tests, and running evals are disabled. Open the source skill to make changes.
          </span>
        </div>
      )}

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
