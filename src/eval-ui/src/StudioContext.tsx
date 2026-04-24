import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useState } from "react";
import { api, mergeUpdatesIntoSkills } from "./api";
import type { SkillInfo } from "./types";
import type { SkillUpdateInfo } from "./api";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useSkillUpdates } from "./hooks/useSkillUpdates";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SelectedSkill {
  plugin: string;
  skill: string;
  origin: "source" | "installed";
}

export interface StudioState {
  selectedSkill: SelectedSkill | null;
  mode: "browse" | "create";
  searchQuery: string;
  skills: SkillInfo[];
  skillsLoading: boolean;
  skillsError: string | null;
  isMobile: boolean;
  mobileView: "list" | "detail";
  updateNotificationDismissed: boolean;
}

const initialState: StudioState = {
  selectedSkill: null,
  mode: "browse",
  searchQuery: "",
  skills: [],
  skillsLoading: true,
  skillsError: null,
  isMobile: false,
  mobileView: "list",
  updateNotificationDismissed: false,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type StudioAction =
  | { type: "SELECT_SKILL"; skill: SelectedSkill }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_MODE"; mode: "browse" | "create" }
  | { type: "SET_SEARCH"; query: string }
  | { type: "SET_SKILLS"; skills: SkillInfo[] }
  | { type: "SET_SKILLS_ERROR"; error: string }
  | { type: "SET_SKILLS_LOADING"; loading: boolean }
  | { type: "SET_MOBILE"; isMobile: boolean }
  | { type: "SET_MOBILE_VIEW"; view: "list" | "detail" }
  | { type: "DISMISS_UPDATE_NOTIFICATION" };

function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case "SELECT_SKILL":
      return {
        ...state,
        selectedSkill: action.skill,
        mode: "browse",
        mobileView: state.isMobile ? "detail" : state.mobileView,
      };
    case "CLEAR_SELECTION":
      return { ...state, selectedSkill: null };
    case "SET_MODE":
      return {
        ...state,
        mode: action.mode,
        selectedSkill: action.mode === "create" ? null : state.selectedSkill,
      };
    case "SET_SEARCH":
      return { ...state, searchQuery: action.query };
    case "SET_SKILLS":
      return { ...state, skills: action.skills, skillsLoading: false, skillsError: null };
    case "SET_SKILLS_ERROR":
      return { ...state, skillsError: action.error, skillsLoading: false };
    case "SET_SKILLS_LOADING":
      return { ...state, skillsLoading: action.loading };
    case "SET_MOBILE":
      return { ...state, isMobile: action.isMobile };
    case "SET_MOBILE_VIEW":
      return { ...state, mobileView: action.view };
    case "DISMISS_UPDATE_NOTIFICATION":
      return { ...state, updateNotificationDismissed: true };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface StudioContextValue {
  state: StudioState;
  selectSkill: (skill: SelectedSkill) => void;
  clearSelection: () => void;
  setMode: (mode: "browse" | "create") => void;
  setSearch: (query: string) => void;
  setMobileView: (view: "list" | "detail") => void;
  refreshSkills: () => void;
  updateCount: number;
  dismissUpdateNotification: () => void;
  /** Raw update list returned by `GET /api/skills/updates` (0683). */
  updates: SkillUpdateInfo[];
  /** Counts of outdated skills partitioned by origin (0683 T-002). */
  outdatedByOrigin: { source: number; installed: number };
  /** Flag surfaced by `useSkillUpdates` while a fetch is in flight. */
  isRefreshingUpdates: boolean;
  /** Manually re-request `GET /api/skills/updates` (dedup'd). */
  refreshUpdates: () => Promise<void>;
}

const StudioCtx = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioCtx);
  if (!ctx) throw new Error("useStudio must be used within StudioProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(studioReducer, initialState);
  const isMobile = useMediaQuery("(max-width: 767px)");

  // Sync isMobile into state
  useEffect(() => {
    dispatch({ type: "SET_MOBILE", isMobile });
  }, [isMobile]);

  // Fetch skills on mount; restore selection from URL hash if present.
  // The update-awareness merge moved to `useSkillUpdates` (0683 T-002) so we
  // no longer fire a duplicate /api/skills/updates here.
  //
  // 0698 (fix): track active agent so /api/skills is scoped to the selected
  // agent's directories. Listens for the `studio:agent-changed` event dispatched
  // by AgentScopePicker so switching agent refetches without a full reload.
  const [activeAgent, setActiveAgentInternal] = useState<string | null>(() => {
    try {
      const raw = window.localStorage.getItem("vskill.studio.prefs");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { activeAgent?: string };
      return typeof parsed.activeAgent === "string" ? parsed.activeAgent : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    function onAgentChanged(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      const detail = e.detail as { agentId?: string } | undefined;
      if (detail?.agentId) setActiveAgentInternal(detail.agentId);
    }
    window.addEventListener("studio:agent-changed", onAgentChanged);
    return () => window.removeEventListener("studio:agent-changed", onAgentChanged);
  }, []);

  const loadSkills = useCallback(() => {
    dispatch({ type: "SET_SKILLS_LOADING", loading: true });
    const filter = activeAgent ? { agent: activeAgent } : undefined;
    api.getSkills(filter)
      .then((skills) => {
        dispatch({ type: "SET_SKILLS", skills });
        // Restore selection from hash: #/skills/<plugin>/<skill>
        const hash = window.location.hash;
        const m = hash.match(/^#\/skills\/([^/]+)\/([^/?]+)/);
        if (m) {
          const [, plugin, skill] = m;
          const found = skills.find((s) => s.plugin === plugin && s.skill === skill);
          if (found) {
            dispatch({ type: "SELECT_SKILL", skill: { plugin, skill, origin: found.origin } });
          }
        }
      })
      .catch((e) => dispatch({ type: "SET_SKILLS_ERROR", error: e.message }));
  }, [activeAgent]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const selectSkill = useCallback((skill: SelectedSkill) => {
    dispatch({ type: "SELECT_SKILL", skill });
    window.location.hash = `/skills/${skill.plugin}/${skill.skill}`;
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: "CLEAR_SELECTION" });
    if (window.location.hash.startsWith("#/skills/")) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const setMode = useCallback((mode: "browse" | "create") => {
    dispatch({ type: "SET_MODE", mode });
  }, []);

  const setSearch = useCallback((query: string) => {
    dispatch({ type: "SET_SEARCH", query });
  }, []);

  const setMobileView = useCallback((view: "list" | "detail") => {
    dispatch({ type: "SET_MOBILE_VIEW", view });
  }, []);

  const dismissUpdateNotification = useCallback(() => {
    dispatch({ type: "DISMISS_UPDATE_NOTIFICATION" });
  }, []);

  // 0683 T-002: shared polling hook owns the /api/skills/updates call. Every
  // consumer (SkillRow glyph, SidebarSection chip, TopRail bell, RightPanel
  // UpdateAction) reads through this single source of truth.
  const skillUpdates = useSkillUpdates();

  // Re-merge the raw skills with the latest update list on every change.
  // `mergeUpdatesIntoSkills` only writes fields when an entry exists, so we
  // strip any stale flags from `state.skills` first — otherwise a skill that
  // just moved from outdated to current would keep its `updateAvailable`
  // flag forever.
  const mergedSkills = useMemo<SkillInfo[]>(() => {
    const reset = state.skills.map((s) => {
      if (!s.updateAvailable && s.latestVersion === undefined) return s;
      const copy: SkillInfo = { ...s };
      delete copy.updateAvailable;
      delete copy.currentVersion;
      delete copy.latestVersion;
      return copy;
    });
    return mergeUpdatesIntoSkills(reset, skillUpdates.updates);
  }, [state.skills, skillUpdates.updates]);

  const outdatedByOrigin = useMemo(() => {
    const counts = { source: 0, installed: 0 };
    for (const s of mergedSkills) {
      if (s.updateAvailable) counts[s.origin] += 1;
    }
    return counts;
  }, [mergedSkills]);

  // Override `state.skills` with the merged array so existing consumers
  // automatically see `updateAvailable` without touching their read path.
  const effectiveState = useMemo<StudioState>(
    () => ({ ...state, skills: mergedSkills }),
    [state, mergedSkills],
  );

  const updateCount = skillUpdates.updateCount;
  const refreshUpdates = skillUpdates.refresh;
  const isRefreshingUpdates = skillUpdates.isRefreshing;

  const value = useMemo<StudioContextValue>(() => ({
    state: effectiveState,
    selectSkill,
    clearSelection,
    setMode,
    setSearch,
    setMobileView,
    refreshSkills: loadSkills,
    updateCount,
    dismissUpdateNotification,
    updates: skillUpdates.updates,
    outdatedByOrigin,
    isRefreshingUpdates,
    refreshUpdates,
  }), [effectiveState, selectSkill, clearSelection, setMode, setSearch, setMobileView, loadSkills, updateCount, dismissUpdateNotification, skillUpdates.updates, outdatedByOrigin, isRefreshingUpdates, refreshUpdates]);

  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>;
}
