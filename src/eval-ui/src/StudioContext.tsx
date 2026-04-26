import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, mergeUpdatesIntoSkills } from "./api";
import { mutate as mutateSWR } from "./hooks/useSWR";
import type { SkillInfo } from "./types";
import type { SkillUpdateInfo } from "./api";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useSkillUpdates } from "./hooks/useSkillUpdates";
import { resolveSubscriptionIds } from "./utils/resolveSubscriptionIds";

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
  // 0704: "<plugin>/<skill>" of the row the sidebar should force-expand and
  // scroll to on its next render. Cleared by Sidebar via `clearReveal` once
  // the row is in view so subsequent selections don't re-scroll.
  revealSkillId: string | null;
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
  revealSkillId: null,
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
  | { type: "DISMISS_UPDATE_NOTIFICATION" }
  | { type: "REVEAL_SKILL"; skill: SelectedSkill }
  | { type: "CLEAR_REVEAL" };

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
    case "REVEAL_SKILL":
      return {
        ...state,
        selectedSkill: action.skill,
        revealSkillId: `${action.skill.plugin}/${action.skill.skill}`,
        mode: "browse",
        mobileView: state.isMobile ? "detail" : state.mobileView,
      };
    case "CLEAR_REVEAL":
      return { ...state, revealSkillId: null };
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
  /** 0772 US-004: returns a Promise that resolves once the skills fetch
   *  has been dispatched into state. Callers that need to navigate to a
   *  newly-created skill MUST await this before calling `selectSkill` so
   *  the right pane can find the new row. */
  refreshSkills: () => Promise<void>;
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
  /** 0704: explicit reveal — selects + flags sidebar for auto-expand/scroll. */
  revealSkill: (plugin: string, skill: string) => void;
  /** 0704: clear the reveal flag once the sidebar has scrolled the row. */
  clearReveal: () => void;
  /** 0708 T-040: push-pipeline update store keyed by `<plugin>/<skill>`. */
  updatesById: ReadonlyMap<string, import("./types/skill-update").UpdateStoreEntry>;
  /** 0708: count of entries in the push store. */
  pushUpdateCount: number;
  /** 0708: SSE connection status — `"connecting" | "connected" | "fallback"`. */
  updateStreamStatus: import("./types/skill-update").StreamStatus;
  /** 0708: dismiss a push-store entry (e.g. after user installs the update). */
  dismissPushUpdate: (skillId: string) => void;
  /** 0766 F-002: invalidate ALL caches that depend on a skill's installed
   *  version after an update completes (regardless of which UI entry point
   *  initiated it). Refreshes /api/skills/updates (clears the bell, the
   *  sidebar arrow, and the "Update to <X>" button), refreshes /api/skills
   *  (so the listing's currentVersion + frontmatter-derived fields refresh),
   *  invalidates the per-skill versions SWR key (so the Versions tab
   *  refetches), and dismisses any push-pipeline entry for the skill.
   *  Pre-0766, the three call sites (UpdateAction, VersionHistoryPanel,
   *  UpdateDropdown) each invalidated only a subset, leaving the other
   *  surfaces stale until the 5-minute polling cycle. */
  onSkillUpdated: (plugin: string, skill: string) => void;
  /** 0761 US-004: active agent slug ("claude-code", "codex", "anthropic-skill",
   *  …) so consumers like UpdateBell can detect whether an update's
   *  installLocations point at the agent the user is currently viewing. */
  activeAgent: string | null;
}

// 0708: exported (named `StudioContext`) so leaf components like `UpdateChip`
// can read the value with `useContext` and render a safe fallback when they
// are rendered outside a provider (e.g. in unit tests that exercise parents
// via a pure walker). `useStudio()` remains the throwing accessor for
// components that require the provider.
export const StudioContext = createContext<StudioContextValue | null>(null);
const StudioCtx = StudioContext;

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
  // 0733: defer the first /api/skills fetch until we have a non-null
  // activeAgent. Warm path (localStorage seeded) sets bootstrapDone=true on
  // mount instantly; cold path (empty localStorage) waits for /api/agents to
  // resolve and sets activeAgent + bootstrapDone together. Without this, the
  // first /api/skills request goes out with no ?agent= and the server's
  // defense-in-depth filter is the only thing standing between the user and
  // skills from agents they didn't select.
  const [bootstrapDone, setBootstrapDone] = useState<boolean>(activeAgent !== null);

  useEffect(() => {
    function onAgentChanged(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      const detail = e.detail as { agentId?: string } | undefined;
      if (detail?.agentId) {
        setActiveAgentInternal(detail.agentId);
        setBootstrapDone(true);
      }
    }
    window.addEventListener("studio:agent-changed", onAgentChanged);
    return () => window.removeEventListener("studio:agent-changed", onAgentChanged);
  }, []);

  // 0733: cold-start bootstrap — when localStorage was empty at mount, fetch
  // /api/agents and adopt `suggested` as the initial activeAgent before the
  // first loadSkills runs. If the fetch fails (offline, server hiccup), fall
  // back to the same default the server uses ("claude-code") so the UI still
  // renders something coherent.
  useEffect(() => {
    if (bootstrapDone) return;
    let cancelled = false;
    api.getAgents()
      .then((resp) => {
        if (cancelled) return;
        const suggested = resp?.suggested ?? "claude-code";
        setActiveAgentInternal((current) => current ?? suggested);
        setBootstrapDone(true);
      })
      .catch(() => {
        if (cancelled) return;
        setActiveAgentInternal((current) => current ?? "claude-code");
        setBootstrapDone(true);
      });
    return () => { cancelled = true; };
  }, [bootstrapDone]);

  const loadSkills = useCallback((): Promise<void> => {
    if (!bootstrapDone || !activeAgent) return Promise.resolve();
    dispatch({ type: "SET_SKILLS_LOADING", loading: true });
    const filter = { agent: activeAgent };
    return api.getSkills(filter)
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
  }, [activeAgent, bootstrapDone]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const selectSkill = useCallback((skill: SelectedSkill) => {
    dispatch({ type: "SELECT_SKILL", skill });
    window.location.hash = `/skills/${skill.plugin}/${skill.skill}`;
  }, []);

  // 0704: explicit reveal — select + flag for sidebar auto-reveal.
  // useRef so callback reads the LATEST skills list even when invoked from a
  // setTimeout captured in a stale closure (CreateSkillModal.onCreated waits
  // 500ms for refreshSkills to land the new row before calling revealSkill).
  const skillsRef = useRef(state.skills);
  useEffect(() => { skillsRef.current = state.skills; }, [state.skills]);
  const revealSkill = useCallback((plugin: string, skillName: string) => {
    const skills = skillsRef.current;
    // When `plugin` is empty, this is a standalone-skill reveal (App.tsx
    // passes `result.pluginName ?? ""`). Restrict the fallback match to
    // non-plugin-sourced skills so we don't reveal the wrong row if two
    // plugins happen to own a skill with the same slug. (F-002)
    const found = plugin
      ? skills.find((s) => s.plugin === plugin && s.skill === skillName)
      : skills.find((s) => s.skill === skillName && s.source !== "plugin");
    // F-001: If caller passed an empty plugin AND we can't resolve one from
    // state yet (skills refetch hasn't landed), bail out instead of writing
    // `#/skills//skillName`. An empty plugin token breaks the Sidebar
    // reveal matcher AND the rehydrate hash regex, silently defeating the
    // reveal. Caller should retry after the next refreshSkills tick.
    if (!plugin && !found) {
      if (typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.warn(
          `[StudioContext] revealSkill: no plugin provided and skill "${skillName}" not yet in state — skipping reveal`,
        );
      }
      return;
    }
    const resolvedPlugin = found?.plugin ?? plugin;
    const origin = found?.origin ?? "source";
    dispatch({
      type: "REVEAL_SKILL",
      skill: { plugin: resolvedPlugin, skill: skillName, origin },
    });
    window.location.hash = `/skills/${resolvedPlugin}/${skillName}`;
  }, []);
  const clearReveal = useCallback(() => {
    dispatch({ type: "CLEAR_REVEAL" });
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

  // 0736 AC-US3-01: resolved SSE subscription IDs (UUID or slug) for installed
  // skills. Populated asynchronously after polling data arrives. Until resolved,
  // the SSE filter is empty and the hook degrades to polling (AC-US3-02).
  // Key: "<plugin>/<skill>" → { uuid?, slug? }
  const resolvedIdsRef = useRef<Map<string, { uuid?: string; slug?: string }>>(new Map());
  const resolvedIdsCsvRef = useRef<string>("");
  // F-006 (0736): surface resolveInstalledSkillIds failures once-per-session.
  // Avoids spamming the console while still giving devs visibility when SSE
  // subscription resolution silently breaks for the entire session.
  const resolveErrorWarnedRef = useRef<boolean>(false);
  const [resolvedIdsCsv, setResolvedIdsCsv] = useState<string>("");

  // 0683 T-002 + 0708 T-040: shared hook owns polling (/api/skills/updates)
  // AND the push-pipeline EventSource (/api/v1/skills/stream). Pass resolved
  // UUID/slug IDs so UpdateHub can match the SSE filter. Until the platform
  // enrichment resolves, skillIds is empty and polling covers updates.
  // 0708 wrap-up: the not-tracked dot (AC-US5-09) needs tracking state for ALL
  // visible skills — pass the wider list separately for reconciliation.
  const allSkillIds = useMemo(() => {
    return state.skills.map((s) => `${s.plugin}/${s.skill}`);
  }, [state.skills]);

  const resolvedSseIds = useMemo(() => {
    if (!resolvedIdsCsv) return [];
    return resolvedIdsCsv.split(",").filter(Boolean);
  }, [resolvedIdsCsv]);

  const skillUpdates = useSkillUpdates({
    skillIds: resolvedSseIds,
    trackingSkillIds: allSkillIds,
  });

  // 0736 AC-US3-01: When polling data arrives, resolve installed skills to
  // their platform UUID/slug and rebuild the SSE subscription filter. The
  // resolver calls /api/v1/skills/check-updates (proxied to the platform)
  // which returns `id` (UUID) and `slug` per result once the 0736 platform
  // change ships. Until then both fields are absent and resolvedSseIds stays
  // empty — graceful degradation per AC-US3-02, polling covers updates.
  //
  // We use skillUpdates.updates (the polling result) as the source of platform
  // skill names, since that's the only place canonical names flow in from
  // `vskill outdated --json`. Effect re-runs when the installed skill set or
  // polling result changes — but the lastResolveSigRef gate below short-circuits
  // the actual /check-updates network call when the input shape is unchanged
  // (NFR-001: ≤1 req/min steady state). Without this gate, every poll cycle
  // (5-min cadence) AND every reconcileCheckUpdates merge re-fires this
  // effect, doubling the request load (see code-review-report F-001).
  const lastResolveSigRef = useRef<string>("");
  useEffect(() => {
    const installed = state.skills.filter((s) => s.origin === "installed");
    if (installed.length === 0) {
      setResolvedIdsCsv("");
      lastResolveSigRef.current = "";
      return;
    }
    // Build short-name → {platformName, installedVersion} lookup from polling.
    // skillUpdates.updates carries the canonical platform name (e.g. "acme/repo/skill")
    // which is required by resolveInstalledSkillIds to hit the right DB row.
    const updateByShort = new Map<string, SkillUpdateInfo>();
    for (const u of skillUpdates.updates) {
      updateByShort.set(u.name.split("/").pop() || u.name, u);
    }
    const toResolve = installed.map((s) => {
      const u = updateByShort.get(s.skill);
      // 0741 fix: prefer accurate version over the literal "0.0.0".
      // Order: previously-merged install state → polling-derived `installed`
      // → frontmatter `version:` → plugin's own `pluginVersion` → "1.0.0".
      // 0756: final fallback is "1.0.0" (matches resolveSkillVersion default);
      // emitting "0.0.0" here would just round-trip the platform's placeholder.
      const resolvedVersion =
        s.currentVersion ??
        u?.installed ??
        s.version ??
        s.pluginVersion ??
        "1.0.0";
      return {
        plugin: s.plugin,
        skill: s.skill,
        name: u?.name ?? s.skill,
        currentVersion: resolvedVersion,
      };
    });
    // Content-stable signature: skip the network call when the resolver input
    // is identical to the previous run. Sorted to make order-independent.
    const sig = toResolve
      .map((t) => `${t.plugin}/${t.skill}@${t.currentVersion}#${t.name}`)
      .sort()
      .join("|");
    if (sig === lastResolveSigRef.current) {
      return;
    }
    lastResolveSigRef.current = sig;
    let cancelled = false;
    api.resolveInstalledSkillIds(toResolve).then((enriched) => {
      if (cancelled) return;
      const resolved = resolveSubscriptionIds(enriched);
      const ids = resolved.flatMap((r) => [r.uuid, r.slug].filter(Boolean) as string[]);
      // Stable CSV so useSkillUpdates only reconnects when IDs actually change
      const csv = [...ids].sort().join(",");
      if (csv !== resolvedIdsCsvRef.current) {
        resolvedIdsCsvRef.current = csv;
        resolvedIdsRef.current = new Map(
          enriched.map((e) => [`${e.plugin}/${e.skill}`, { uuid: e.uuid, slug: e.slug }]),
        );
        setResolvedIdsCsv(csv);
      }
    }).catch((err: unknown) => {
      // Reset signature so a future input (or a successful retry on the next
      // poll cycle) can proceed. Otherwise a one-off network blip would lock
      // out resolution until the input shape itself changes.
      if (!cancelled) {
        lastResolveSigRef.current = "";
      }
      // F-006: surface the failure once-per-session so devs can see this in
      // DevTools. The polling fallback (5-min cadence) still covers updates,
      // so this is non-fatal — but completely silent swallowing makes the
      // SSE-resolver path un-debuggable when it breaks.
      if (!resolveErrorWarnedRef.current) {
        resolveErrorWarnedRef.current = true;
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn("[studio] resolveInstalledSkillIds failed (using polling fallback):", msg);
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.skills, skillUpdates.updates]);

  // Re-merge the raw skills with the latest update list on every change.
  // `mergeUpdatesIntoSkills` only writes fields when an entry exists, so we
  // strip any stale flags from `state.skills` first — otherwise a skill that
  // just moved from outdated to current would keep its `updateAvailable`
  // flag forever.
  const mergedSkills = useMemo<SkillInfo[]>(() => {
    const reset = state.skills.map((s) => {
      if (!s.updateAvailable && s.latestVersion === undefined && s.trackedForUpdates === undefined) return s;
      const copy: SkillInfo = { ...s };
      delete copy.updateAvailable;
      delete copy.currentVersion;
      delete copy.latestVersion;
      // 0708 wrap-up: also reset trackedForUpdates so a skill that has lost
      // its sourceRepoUrl on the server stops showing the "tracked" badge.
      delete copy.trackedForUpdates;
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

  // 0766 F-002: single full-invalidation helper. Every caller that finishes
  // a successful update (UpdateAction, VersionHistoryPanel, UpdateDropdown)
  // routes through this so the bell + Versions tab + sidebar + chip clear
  // together regardless of where the user clicked.
  const onSkillUpdated = useCallback((plugin: string, skill: string): void => {
    void refreshUpdates();
    loadSkills();
    mutateSWR(`versions/${plugin}/${skill}`);
    skillUpdates.dismiss(`${plugin}/${skill}`);
  }, [refreshUpdates, loadSkills, skillUpdates]);

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
    revealSkill,
    clearReveal,
    updatesById: skillUpdates.updatesById,
    pushUpdateCount: skillUpdates.pushUpdateCount,
    updateStreamStatus: skillUpdates.status,
    dismissPushUpdate: skillUpdates.dismiss,
    activeAgent,
    onSkillUpdated,
  }), [effectiveState, selectSkill, clearSelection, setMode, setSearch, setMobileView, loadSkills, updateCount, dismissUpdateNotification, skillUpdates.updates, outdatedByOrigin, isRefreshingUpdates, refreshUpdates, revealSkill, clearReveal, skillUpdates.updatesById, skillUpdates.pushUpdateCount, skillUpdates.status, skillUpdates.dismiss, activeAgent, onSkillUpdated]);

  return <StudioCtx.Provider value={value}>{children}</StudioCtx.Provider>;
}
