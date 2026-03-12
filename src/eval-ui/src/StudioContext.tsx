import { createContext, useContext, useReducer, useCallback, useEffect, useMemo } from "react";
import { api } from "./api";
import type { SkillInfo } from "./types";
import { useMediaQuery } from "./hooks/useMediaQuery";

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
  | { type: "SET_MOBILE_VIEW"; view: "list" | "detail" };

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
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface StudioContextValue {
  state: StudioState;
  selectSkill: (skill: SelectedSkill) => void;
  clearSelection: () => void;
  setMode: (mode: "browse" | "create") => void;
  setSearch: (query: string) => void;
  setMobileView: (view: "list" | "detail") => void;
  refreshSkills: () => void;
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

  // Fetch skills on mount; restore selection from URL hash if present
  const loadSkills = useCallback(() => {
    dispatch({ type: "SET_SKILLS_LOADING", loading: true });
    api.getSkills()
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
  }, []);

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

  const value = useMemo<StudioContextValue>(() => ({
    state,
    selectSkill,
    clearSelection,
    setMode,
    setSearch,
    setMobileView,
    refreshSkills: loadSkills,
  }), [state, selectSkill, clearSelection, setMode, setSearch, setMobileView, loadSkills]);

  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>;
}
