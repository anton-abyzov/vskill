import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StudioProvider, useStudio } from "./StudioContext";
import { ConfigProvider, useConfig } from "./ConfigContext";
import { StudioLayout } from "./components/StudioLayout";
import { TopRail } from "./components/TopRail";
import { StatusBar } from "./components/StatusBar";
import { Sidebar } from "./components/Sidebar";
import { ResizeHandle, readSidebarWidth, DEFAULT_SIDEBAR_WIDTH } from "./components/ResizeHandle";
import { useDirtySkills } from "./hooks/useDirtySkills";
import { DisconnectBanner } from "./components/DisconnectBanner";
import { RightPanel } from "./components/RightPanel";
import { UpdateToast } from "./components/UpdateToast";
import { ToastProvider, useToast } from "./components/ToastProvider";
import { ShortcutModal } from "./components/ShortcutModal";
import { ContextMenu } from "./components/ContextMenu";
import type { ContextMenuState } from "./components/ContextMenu";
import { ConfirmDialog, getTrashLabel } from "./components/ConfirmDialog";
import { usePendingDeletion } from "./hooks/usePendingDeletion";
import { SetupDrawer } from "./components/SetupDrawer";
import { useSetupDrawer } from "./hooks/useSetupDrawer";
import { AgentScopePicker, agentsResponseToPickerEntries } from "./components/AgentScopePicker";
import { ClaudeCodeFirstUseBanner } from "./components/ClaudeCodeFirstUseBanner";
import { useAgentsResponse } from "./hooks/useAgentsResponse";
import { useWorkspace } from "./hooks/useWorkspace";
import { ProjectPicker } from "./components/ProjectPicker";
import { ProjectCommandPalette } from "./components/ProjectCommandPalette";
import { CreateSkillModal, type CreateSkillMode } from "./components/CreateSkillModal";
import { MarketplaceDrawer } from "./components/MarketplaceDrawer";
import { InstallProgressToast, type InstallJob } from "./components/InstallProgressToast";
import { SettingsModal } from "./components/SettingsModal";
import { useApiKeyErrorToast } from "./hooks/useApiKeyErrorToast";
import type { CredentialProvider } from "./hooks/useCredentialStorage";
import {
  getStudioPreference,
  writeStudioPreference,
} from "./hooks/useStudioPreferences";
import {
  closedContextMenuState,
  openContextMenuAt,
  handleContextMenuAction,
} from "./hooks/useContextMenuState";
import type { SkillInfo } from "./types";
import { useKeyboardShortcut } from "./hooks/useKeyboardShortcut";
import { useIsCreateRoute, useIsUpdatesRoute } from "./hooks/useHashRoute";
import { useTheme } from "./theme/useTheme";
import type { Command } from "./components/CommandPalette";
import { strings } from "./strings";

// T-039: CommandPalette is lazy-loaded so it stays out of the initial bundle.
const CommandPalette = lazy(() => import("./components/CommandPalette"));

// 0741 T-016: FindSkillsPalette (⌘⇧K) is lazy-loaded for the same reason —
// the palette + ported components add ~30-40KB gzip and only mount when the
// user explicitly opens the verified-skill find experience.
const FindSkillsPalette = lazy(() =>
  import("./components/FindSkillsPalette/FindSkillsPalette").then((m) => ({
    default: m.FindSkillsPalette,
  })),
);

// 0741 T-018: FindSkillsNavButton is small enough to ship in the initial
// bundle — it's a TopRail chrome element visible on every page render.
import { FindSkillsNavButton } from "./components/FindSkillsPalette/FindSkillsNavButton";

// 0741 T-019: SkillDetailPanel is lazy-loaded — it only mounts after the
// user picks a result from the FindSkillsPalette.
const SkillDetailPanel = lazy(() =>
  import("./components/FindSkillsPalette/SkillDetailPanel").then((m) => ({
    default: m.SkillDetailPanel,
  })),
);

// 0703 hotfix: lazy-load CreateSkillPage because it is only mounted when the
// hash is `/create` (the modal's Generate-with-AI branch). Keeping it out of
// the initial bundle preserves home-page LCP.
const CreateSkillPage = lazy(() =>
  import("./pages/CreateSkillPage").then((m) => ({ default: m.CreateSkillPage })),
);

// 0740: lazy-load UpdatesPanel for the `#/updates` hash route. Same rationale
// as CreateSkillPage — bulk update list is only mounted when explicitly
// navigated to via the View Updates affordance.
const UpdatesPage = lazy(() =>
  import("./pages/UpdatesPanel").then((m) => ({ default: m.UpdatesPanel })),
);

export function App() {
  return (
    <ConfigProvider>
      <StudioProvider>
        <ToastProvider>
          <Shell />
          <UpdateToast />
        </ToastProvider>
      </StudioProvider>
    </ConfigProvider>
  );
}

function Shell() {
  const { state, selectSkill, clearSelection, refreshSkills, outdatedByOrigin, revealSkill, clearReveal } = useStudio();
  const { config } = useConfig();
  const { mode, resolvedTheme, setTheme } = useTheme();
  const { toast } = useToast();
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readSidebarWidth());
  const [sseConnected] = useState<boolean>(true); // SSE-connection hook lives outside Phase 2 scope
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // T-0684 (B4): Cmd+B sidebar visibility toggle. Per-session only — does
  // NOT persist across reloads (spec non-goal). Mobile-view auto-hiding
  // remains governed by StudioContext.mobileView.
  const [sidebarToggledHidden, setSidebarToggledHidden] = useState(false);
  // T-063: Active detail tab lives at the App level so RightPanel can drive
  // the Overview / Versions switch in integrated mode. Without this lift,
  // `renderDetailShell` received no `onDetailTabChange` handler and clicking
  // "Versions" was a silent no-op (qa-findings #1).
  // 0707 T-007: RightPanel now exposes the full flat 9-tab set, so the
  // lifted state type widens accordingly.
  const [activeDetailTab, setActiveDetailTab] = useState<
    | "overview"
    | "editor"
    | "tests"
    | "run"
    | "activation"
    | "history"
    | "leaderboard"
    | "deps"
    | "versions"
  >("overview");
  // T-064: Shared context-menu anchor for sidebar rows. The actual ContextMenu
  // component is rendered once at the App root; row right-clicks update this
  // state with cursor coords + the target skill.
  const [contextMenuState, setContextMenuState] =
    useState<ContextMenuState>(closedContextMenuState);
  const openContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, skill: SkillInfo) => {
      setContextMenuState(openContextMenuAt(event, skill));
    },
    [],
  );

  // 0686 T-002 (US-002): AgentScopePicker state. `activeAgentId` is persisted
  // under `useStudioPreferences.activeAgent`; the initial value falls back to
  // the server's suggested agent, then to "claude-cli". Picker calls fire
  // both a localStorage write AND a `studio:agent-changed` event so other
  // observers (e.g., the Sidebar's scope fetch) can refresh without prop
  // drilling.
  const agentsResponse = useAgentsResponse();
  const [activeAgentId, setActiveAgentIdState] = useState<string | null>(() =>
    getStudioPreference<string | null>("activeAgent", null),
  );
  const handleActiveAgentChange = useCallback((agentId: string) => {
    setActiveAgentIdState(agentId);
    writeStudioPreference("activeAgent", agentId);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("studio:agent-changed", { detail: { agentId } }),
      );
    }
  }, []);
  useEffect(() => {
    // 0733: Hydrate from the server's `suggested` when no persisted choice
    // exists — but route through handleActiveAgentChange so localStorage AND
    // the studio:agent-changed event both fire. Without this, App holds the
    // suggested value in React state only, leaving StudioContext (which
    // reads localStorage) stuck on null and fetching /api/skills with no
    // ?agent=, which the picker cannot reflect.
    if (!activeAgentId && agentsResponse.response?.suggested) {
      handleActiveAgentChange(agentsResponse.response.suggested);
    }
  }, [activeAgentId, agentsResponse.response?.suggested, handleActiveAgentChange]);
  const pickerEntries = useMemo(
    () => (agentsResponse.response ? agentsResponseToPickerEntries(agentsResponse.response) : []),
    [agentsResponse.response],
  );

  // 0698 T-015/T-016: multi-project workspace state + ⌘P command palette.
  const { workspace, switchProject, addProject, removeProject, activeProject } = useWorkspace();
  const [projectPaletteOpen, setProjectPaletteOpen] = useState(false);

  // 0698 polish: CreateSkillModal — opened from TopRail "+ New Skill" or from
  // AUTHORING group header "+" (with pre-selected mode via initialCreateMode).
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [initialCreateMode, setInitialCreateMode] = useState<CreateSkillMode>("standalone");
  const openCreateModal = useCallback((mode: CreateSkillMode = "standalone") => {
    setInitialCreateMode(mode);
    setCreateModalOpen(true);
  }, []);
  useEffect(() => {
    // Listen for bubbling requests from elsewhere (e.g. AUTHORING header).
    function onRequestCreate(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      const detail = e.detail as { mode?: CreateSkillMode } | undefined;
      openCreateModal(detail?.mode ?? "standalone");
    }
    window.addEventListener("studio:request-create-skill", onRequestCreate);
    return () => window.removeEventListener("studio:request-create-skill", onRequestCreate);
  }, [openCreateModal]);

  // 0700 phase 2B + 2C: MarketplaceDrawer + InstallProgressToast state.
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [installJob, setInstallJob] = useState<InstallJob | null>(null);
  // 0767: ConfirmDialog gating for marketplace-driven Uninstall (replaces
  // window.confirm()). The pending-promise resolver lets the async onUninstall
  // callback await the user's choice before issuing the API call.
  const [pluginUninstallTarget, setPluginUninstallTarget] = useState<{
    plugin: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  useEffect(() => {
    function onOpenMarketplace() {
      setMarketplaceOpen(true);
    }
    window.addEventListener("studio:open-marketplace", onOpenMarketplace);
    return () => window.removeEventListener("studio:open-marketplace", onOpenMarketplace);
  }, []);

  // Collect names of installed plugins so the drawer can gray-out "Installed".
  const installedPluginNames = useMemo(() => {
    const set = new Set<string>();
    // state.skills is the Sidebar source; plugin-scope rows carry pluginName.
    for (const s of state.skills) {
      if (s.source === "plugin" && s.pluginName) set.add(s.pluginName);
    }
    return set;
  }, [state.skills]);
  useKeyboardShortcut(
    [
      {
        key: "p",
        meta: true,
        handler: (e) => {
          // Only handle when focus is inside the studio DOM — otherwise let the
          // browser's print dialog take over (AC-US1 keyboard shortcut scoping).
          const activeEl = typeof document !== "undefined" ? document.activeElement : null;
          if (activeEl && activeEl.tagName === "INPUT") return; // don't hijack inside inputs
          e?.preventDefault?.();
          setProjectPaletteOpen((v) => !v);
        },
      },
    ],
    { enabled: true },
  );

  // 0686 T-010 (US-005): Shared SetupDrawer wired at the App root. Any
  // descendant that needs inline setup docs (AgentModelPicker "Need help
  // connecting?", AgentScopePicker "Set up...", scope empty states) opens
  // it via a `studio:open-setup-drawer` CustomEvent carrying `{ provider }`.
  const setupDrawer = useSetupDrawer();
  // 0686 F-001 fix: depend on the stable `open` callback rather than the
  // hook result object so the listener is bound exactly once per `open`
  // identity change (which is `useCallback([])` → never). Avoids the
  // teardown/rebind churn and the one-microtask race window where a
  // dispatched CustomEvent could be dropped between unbind and rebind.
  const openSetup = setupDrawer.open;
  useEffect(() => {
    function onOpenSetup(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      const detail = e.detail as { provider?: string } | undefined;
      if (detail?.provider) openSetup(detail.provider);
    }
    window.addEventListener("studio:open-setup-drawer", onOpenSetup);
    return () => window.removeEventListener("studio:open-setup-drawer", onOpenSetup);
  }, [openSetup]);
  const closeContextMenu = useCallback(() => {
    setContextMenuState(closedContextMenuState);
  }, []);

  // T-065: Bridge `studio:toast` CustomEvents (dispatched by hook-free
  // helpers like MetadataTab's entry-point chip and the context-menu
  // router) into the real ToastProvider.
  useEffect(() => {
    function onStudioToast(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      const detail = (e as CustomEvent).detail as
        | { message?: string; severity?: "info" | "error" }
        | undefined;
      if (!detail?.message) return;
      toast({ message: detail.message, severity: detail.severity ?? "info" });
    }
    window.addEventListener("studio:toast", onStudioToast);
    return () => window.removeEventListener("studio:toast", onStudioToast);
  }, [toast]);

  // 0702 T-042: Listen for studio:api-key-error (dispatched by sse.ts on
  // structured 401 bodies) and surface the provider-scoped toast. The toast's
  // action dispatches studio:open-settings, which the SettingsModal listener
  // below picks up.
  useApiKeyErrorToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialProvider, setSettingsInitialProvider] = useState<CredentialProvider | undefined>(undefined);
  useEffect(() => {
    function onOpenSettings(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      const detail = (e as CustomEvent).detail as { provider?: CredentialProvider } | undefined;
      setSettingsInitialProvider(detail?.provider);
      setSettingsOpen(true);
    }
    window.addEventListener("studio:open-settings", onOpenSettings);
    return () => window.removeEventListener("studio:open-settings", onOpenSettings);
  }, []);

  // Keep document.documentElement.style updated so CSS reads the live width.
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  }, [sidebarWidth]);

  // ---------------------------------------------------------------------------
  // 0722: Skill delete flow (ConfirmDialog + 10s Undo + OS trash)
  // ---------------------------------------------------------------------------
  const [pendingDeleteSkill, setPendingDeleteSkill] = useState<SkillInfo | null>(null);
  const [hiddenSkillKeys, setHiddenSkillKeys] = useState<Set<string>>(() => new Set());
  const firstDeleteShownRef = useRef(false);
  const trashLabel = useMemo(() => getTrashLabel(), []);
  const keyOf = useCallback(
    (s: { plugin: string; skill: string }) => `${s.plugin}/${s.skill}`,
    [],
  );
  const optimisticHide = useCallback(
    (s: { plugin: string; skill: string }) => {
      setHiddenSkillKeys((set) => {
        const next = new Set(set);
        next.add(keyOf(s));
        return next;
      });
    },
    [keyOf],
  );
  const optimisticRestore = useCallback(
    (s: { plugin: string; skill: string }) => {
      setHiddenSkillKeys((set) => {
        const next = new Set(set);
        next.delete(keyOf(s));
        return next;
      });
    },
    [keyOf],
  );
  const pendingDeletion = usePendingDeletion({
    delayMs: 10_000,
    onCommit: (s) => {
      refreshSkills();
      // Clear the hidden-key once refreshSkills has dropped the entry from
      // state.skills; harmless if it lingers a render frame.
      optimisticRestore(s);
    },
    onFailure: (s, err) => {
      optimisticRestore(s);
      toast({
        message: `Couldn't delete ${s.skill}: ${err.message}`,
        severity: "error",
        durationMs: 0,
        action: {
          label: strings.actions.retry,
          onInvoke: () => {
            optimisticHide(s);
            pendingDeletion.enqueueDelete(s);
          },
        },
      });
    },
  });
  useEffect(() => {
    function onRequestDelete(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      const detail = (e as CustomEvent).detail as { skill?: SkillInfo } | undefined;
      if (detail?.skill) setPendingDeleteSkill(detail.skill);
    }
    window.addEventListener("studio:request-delete", onRequestDelete);
    return () => window.removeEventListener("studio:request-delete", onRequestDelete);
  }, []);
  const handleConfirmDelete = useCallback(() => {
    const skill = pendingDeleteSkill;
    setPendingDeleteSkill(null);
    if (!skill) return;
    const target = { plugin: skill.plugin, skill: skill.skill };
    optimisticHide(target);
    pendingDeletion.enqueueDelete(target);
    const sessionPrefix = !firstDeleteShownRef.current
      ? `Sent to your ${trashLabel}. Open Trash to restore. `
      : "";
    firstDeleteShownRef.current = true;
    toast({
      message: `${sessionPrefix}Deleted ${skill.skill}`,
      severity: "info",
      durationMs: 10_000,
      action: {
        label: strings.actions.undo,
        onInvoke: () => {
          pendingDeletion.cancelDelete(keyOf(target));
          optimisticRestore(target);
        },
      },
    });
  }, [pendingDeleteSkill, optimisticHide, optimisticRestore, pendingDeletion, toast, trashLabel, keyOf]);
  const handleCancelDelete = useCallback(() => {
    setPendingDeleteSkill(null);
  }, []);
  const visibleSkills = useMemo(
    () => state.skills.filter((s) => !hiddenSkillKeys.has(keyOf(s))),
    [state.skills, hiddenSkillKeys, keyOf],
  );

  // 0759 Phase 6: poll /api/git/status and resolve dirty paths to a Set of
  // "<plugin>/<skill>" IDs the sidebar marks with an amber dot.
  const dirtySkillIds = useDirtySkills(visibleSkills, activeProject?.path ?? null);

  const selectedInfo = useMemo(() => {
    if (!state.selectedSkill) return null;
    return state.skills.find(
      (s) =>
        s.plugin === state.selectedSkill!.plugin && s.skill === state.selectedSkill!.skill,
    ) ?? null;
  }, [state.skills, state.selectedSkill]);

  const onSelect = useCallback(
    (s: { plugin: string; skill: string; origin: "source" | "installed" }) => {
      selectSkill({ plugin: s.plugin, skill: s.skill, origin: s.origin });
    },
    [selectSkill],
  );

  const liveMessage = useMemo(() => {
    if (!state.selectedSkill) return "";
    const origin = state.selectedSkill.origin === "installed" ? "Installed" : "Own";
    return `Viewing ${state.selectedSkill.skill} (${origin})`;
  }, [state.selectedSkill]);

  // Global shortcuts: ⌘K → palette, ? → cheatsheet, ⌘⇧D → theme toggle,
  // E → edit placeholder (deferred to increment 0675).
  const commands = useMemo<Command[]>(
    () => [
      {
        id: "switch-theme",
        label: strings.palette.actionSwitchTheme,
        description: "Cycle light / dark / auto",
        keywords: ["theme", "dark", "light", "mode"],
        onInvoke: () => setTheme(mode === "light" ? "dark" : mode === "dark" ? "auto" : "light"),
      },
      {
        id: "toggle-sidebar",
        label: "Toggle sidebar",
        description: "Show or hide the skills sidebar",
        keywords: ["sidebar", "panel", "hide", "show", "cmd+b"],
        onInvoke: () => setSidebarToggledHidden((h) => !h),
      },
      {
        id: "show-shortcuts",
        label: "Show keyboard shortcuts",
        description: "Open the cheatsheet",
        keywords: ["help", "keys"],
        onInvoke: () => setShortcutsOpen(true),
      },
      {
        id: "refresh-skills",
        label: "Refresh skills",
        description: "Re-scan local + installed",
        keywords: ["reload", "scan"],
        onInvoke: () => refreshSkills(),
      },
    ],
    [mode, setTheme, refreshSkills],
  );

  // 0741 T-019: Selected skill for the SkillDetailPanel — set by the
  // FindSkillsPalette `onSelect` callback, cleared when the panel closes.
  const [findDetailSkill, setFindDetailSkill] = useState<{
    owner: string;
    repo: string;
    slug: string;
    displayName: string;
  } | null>(null);

  useKeyboardShortcut([
    { key: "cmd+k", handler: () => setPaletteOpen((p) => !p) },
    { key: "ctrl+k", handler: () => setPaletteOpen((p) => !p) },
    // 0741 T-016 (AC-US1-02): ⌘⇧K (Mac) and Ctrl+Shift+K (Win/Linux) open the
    // FindSkillsPalette. Bare ⌘K above remains the CommandPalette trigger —
    // separate handlers per chord guarantee no double-fire (modifier match
    // is exact in matchesShortcut).
    {
      key: "cmd+shift+k",
      handler: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("openFindSkills"));
        }
      },
    },
    {
      key: "ctrl+shift+k",
      handler: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("openFindSkills"));
        }
      },
    },
    { key: "?", handler: () => setShortcutsOpen((s) => !s) },
    // T-0684 (B2): Flip data-theme based on RESOLVED theme rather than
    // stored mode. When mode="auto" the stored mode !== "light" (it's
    // "auto"), so the old logic set mode="light" — which on a light-OS
    // leaves the resolved theme unchanged and the toggle appears broken.
    // Basing the flip on resolvedTheme guarantees data-theme changes.
    {
      key: "cmd+shift+d",
      handler: () => setTheme(resolvedTheme === "light" ? "dark" : "light"),
    },
    {
      key: "ctrl+shift+d",
      handler: () => setTheme(resolvedTheme === "light" ? "dark" : "light"),
    },
    // T-0684 (B4): Cmd/Ctrl+B toggles skills-sidebar visibility.
    {
      key: "cmd+b",
      handler: () => setSidebarToggledHidden((h) => !h),
    },
    {
      key: "ctrl+b",
      handler: () => setSidebarToggledHidden((h) => !h),
    },
    {
      key: "e",
      handler: () =>
        toast({
          message: strings.actions.editPlaceholder,
          severity: "info",
        }),
    },
  ]);

  const onCreateRoute = useIsCreateRoute();
  const onUpdatesRoute = useIsUpdatesRoute();

  // 0703 follow-up: keep StudioLayout chrome (TopRail, sidebar, ⌘K, brand)
  // visible when CreateSkillPage is active, so users don't feel teleported to
  // a standalone page and still have escape hatches. The page renders in the
  // main slot instead of replacing the whole tree.
  // 0740: same treatment for the `#/updates` route — clicking "View Updates"
  // in the toast/bell now lands here instead of the empty default slot.
  const mainContent = onUpdatesRoute ? (
    <Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
      <UpdatesPage />
    </Suspense>
  ) : onCreateRoute ? (
    <Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
      <CreateSkillPage />
    </Suspense>
  ) : (
    <RightPanel
      selectedSkillInfo={selectedInfo}
      activeDetailTab={activeDetailTab}
      onDetailTabChange={setActiveDetailTab}
      allSkills={state.skills}
      onSelectSkill={onSelect}
    />
  );

  return (
    <>
      <StudioLayout
        sidebarWidth={sidebarWidth}
        sidebarHidden={sidebarToggledHidden || (state.isMobile && state.mobileView === "detail")}
        banner={<DisconnectBanner connected={sseConnected} />}
        liveMessage={liveMessage}
        topRail={
          <TopRail
            projectName={config?.projectName ?? null}
            selected={state.selectedSkill}
            onOpenPalette={() => setPaletteOpen(true)}
            onHome={clearSelection}
            onRequestCreateSkill={() => openCreateModal("standalone")}
            projectPickerSlot={
              workspace && workspace.projects.length > 0 ? (
                <ProjectPicker
                  workspace={workspace}
                  onSwitch={switchProject}
                  onAdd={addProject}
                  onRemove={removeProject}
                />
              ) : undefined
            }
            findSkillsSlot={<FindSkillsNavButton />}
          />
        }
        sidebar={
          <Sidebar
            skills={visibleSkills}
            selectedKey={
              state.selectedSkill
                ? { plugin: state.selectedSkill.plugin, skill: state.selectedSkill.skill }
                : null
            }
            onSelect={onSelect}
            isLoading={state.skillsLoading}
            error={state.skillsError ?? null}
            onRetry={refreshSkills}
            onContextMenu={openContextMenu}
            outdatedByOrigin={outdatedByOrigin}
            activeAgentId={activeAgentId}
            revealSkillId={state.revealSkillId}
            onRevealComplete={clearReveal}
            dirtySkillIds={dirtySkillIds}
            topSlot={
              agentsResponse.status === "ready" && pickerEntries.length > 0 ? (
                <>
                  <AgentScopePicker
                    agents={pickerEntries}
                    activeAgentId={activeAgentId}
                    onActiveAgentChange={handleActiveAgentChange}
                    onOpenSetup={(providerId) => setupDrawer.open(providerId)}
                  />
                  {/* 0686 T-012 (US-006): first-use banner — only renders
                      when Claude Code is the active scope agent AND the
                      session dismissal flag is absent. Internal gating
                      keeps this mount point cheap. */}
                  <ClaudeCodeFirstUseBanner activeAgentId={activeAgentId} />
                </>
              ) : null
            }
          />
        }
        resizeHandle={
          <ResizeHandle initialWidth={sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH} onChange={setSidebarWidth} />
        }
        main={mainContent}
        statusBar={
          <StatusBar
            projectPath={config?.root ?? null}
            modelName={config?.model ?? null}
            health={config?.error ? "degraded" : "ok"}
            providers={config?.providers?.map((p) => {
              const id = p.id as string;
              return {
                id,
                label: p.label,
                available: p.available,
                kind:
                  id === "ollama" || id === "lm-studio"
                    ? "start-service"
                    : id === "anthropic" || id === "openrouter"
                      ? "api-key"
                      : "cli-install",
              };
            })}
          />
        }
      />
      {/* T-040: Shortcut cheatsheet — no lazy wrapper (tiny, frequent use). */}
      <ShortcutModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {/* 0686 T-010: Single-instance SetupDrawer mounted at the App root so
          any child can request per-provider setup docs via the shared
          `studio:open-setup-drawer` CustomEvent. */}
      <SetupDrawer
        open={setupDrawer.isOpen}
        providerKey={setupDrawer.providerKey}
        onClose={setupDrawer.close}
      />
      {/* T-064: Single app-level ContextMenu, anchored to the shared state. */}
      <ContextMenu
        state={contextMenuState}
        onClose={closeContextMenu}
        onAction={(action, skill) => handleContextMenuAction(action, skill)}
      />
      {/* T-039: CommandPalette is loaded on first open. Suspense boundary
          prevents a flash if the chunk hasn't hit the network yet. */}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            commands={commands}
          />
        </Suspense>
      )}
      {/* 0741 T-014/T-016: FindSkillsPalette (⌘⇧K). Always mounted but the
          shell internally returns null until `openFindSkills` fires. The
          shell handles its own lazy/Suspense for the inner SearchPaletteCore. */}
      <Suspense fallback={null}>
        <FindSkillsPalette
          onSelect={(result) => {
            // result.name is "owner/repo/slug" for hierarchical skills, or a
            // legacy flat name. Only the hierarchical shape is supported by
            // the SkillDetailPanel — bail otherwise.
            const parts = result.name.split("/");
            if (parts.length !== 3) return;
            setFindDetailSkill({
              owner: parts[0],
              repo: parts[1],
              slug: parts[2],
              displayName: result.displayName ?? result.name,
            });
          }}
        />
      </Suspense>
      {/* 0741 T-019: SkillDetailPanel — opened by the FindSkillsPalette. */}
      {findDetailSkill && (
        <Suspense fallback={null}>
          <SkillDetailPanel
            selectedSkill={findDetailSkill}
            onClose={() => setFindDetailSkill(null)}
          />
        </Suspense>
      )}
      {/* 0698 T-015/T-016: ⌘P project switcher palette. Mounted at root so
          the global keyboard shortcut can open it from anywhere inside
          Skill Studio. */}
      <ProjectCommandPalette
        open={projectPaletteOpen}
        projects={workspace?.projects ?? []}
        onSwitch={(id) => {
          void switchProject(id);
        }}
        onClose={() => setProjectPaletteOpen(false)}
      />

      {/* 0698 polish: Create Skill modal — opened from top-rail button or
          from AUTHORING group header "+" via the studio:request-create-skill
          event. Pre-selected mode comes from the caller's context. */}
      <CreateSkillModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        initialMode={initialCreateMode}
        isClaudeCode={activeAgentId === "claude-code"}
        projectRoot={activeProject?.path ?? config?.projectName ?? ""}
        onCreated={(result) => {
          // 0704: use revealSkill (not selectSkill) so the sidebar
          // force-expands ancestors and scrolls the new row into view.
          // Manual row clicks still go through selectSkill, which does NOT
          // force-expand — only explicit creation flows reveal.
          //
          // For standalone skills the modal returns pluginName=null, so we
          // pass "" — StudioContext.revealSkill then resolves a project/
          // personal match by skillName against the latest skills list
          // (plugin-sourced matches are excluded to avoid slug collisions).
          // If the refreshSkills() fetch below has not landed by the time
          // the 500ms timer fires, revealSkill safely no-ops rather than
          // mutating the hash with an empty plugin. Plugin-owned skills
          // always pass pluginName explicitly and hit the exact-match path.
          refreshSkills();
          setTimeout(() => {
            revealSkill(result.pluginName ?? "", result.skillName);
          }, 500);
        }}
      />

      {/* 0700 phase 2B: MarketplaceDrawer — opened from the AVAILABLE > Plugins
          section header (via studio:open-marketplace). Lists configured
          marketplaces + available plugins with one-click install. */}
      <MarketplaceDrawer
        open={marketplaceOpen}
        onClose={() => setMarketplaceOpen(false)}
        installedNames={installedPluginNames}
        onInstall={(plugin, marketplace) => {
          setInstallJob({
            plugin,
            marketplace,
            ref: `${plugin}@${marketplace}`,
          });
          setMarketplaceOpen(false);
        }}
        onUninstall={async (plugin) => {
          // 0767: gate the request behind <ConfirmDialog>; the resolver
          // bridges the dialog's onConfirm/onCancel back into this async flow.
          const ok = await new Promise<boolean>((resolve) => {
            setPluginUninstallTarget({ plugin, resolve });
          });
          if (!ok) return;
          try {
            const res = await fetch(
              `/api/plugins/${encodeURIComponent(plugin)}/uninstall`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              },
            );
            const body = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              error?: string;
              fallback?: string;
            };
            if (!res.ok || !body.ok) {
              toast({
                message: body.error ?? `Uninstall failed (${res.status})`,
                severity: "error",
              });
              return;
            }
            const note =
              body.fallback === "orphan-cache-removed"
                ? `Removed orphaned ${plugin}.`
                : `Uninstalled ${plugin}.`;
            toast({ message: note, severity: "success" });
            refreshSkills();
          } catch (err) {
            toast({
              message: err instanceof Error ? err.message : String(err),
              severity: "error",
            });
          }
        }}
      />

      {/* 0702 T-042: App-level SettingsModal opened by the API-key-error toast.
          The AgentModelPicker keeps its own footer-triggered SettingsModal
          for user-initiated opens; this mount handles 401-driven opens so any
          surface can reach it via the studio:open-settings CustomEvent. */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialProvider={settingsInitialProvider}
        onToast={(message) => toast({ message, severity: "info" })}
      />

      {/* 0700 phase 2C: live SSE progress toast while `claude plugin install`
          runs. Auto-hides ~3s after success or stays pinned on failure. */}
      <InstallProgressToast
        job={installJob}
        onDone={(result) => {
          if (result.ok) {
            // Refresh the sidebar/skill state so the just-installed plugin
            // appears immediately — no manual page reload.
            refreshSkills();
            setTimeout(() => setInstallJob(null), 3000);
          }
          // On failure, leave the toast pinned so the user can expand it.
        }}
      />

      {/* 0722: skill delete confirmation. Opened by studio:request-delete
          events from the context-menu router and DetailHeader trash button. */}
      <ConfirmDialog
        open={pendingDeleteSkill !== null}
        title={pendingDeleteSkill ? `Delete "${pendingDeleteSkill.skill}"?` : ""}
        body={`It will be sent to your ${trashLabel}. You can recover it from there.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      {/* 0767: marketplace-driven plugin Uninstall confirmation. Mirrors the
          PluginActionMenu sidebar flow so both surfaces use the same dialog. */}
      <ConfirmDialog
        open={pluginUninstallTarget !== null}
        title={
          pluginUninstallTarget
            ? `Uninstall ${pluginUninstallTarget.plugin}?`
            : ""
        }
        body={
          pluginUninstallTarget
            ? `This removes the ${pluginUninstallTarget.plugin} plugin and all of its skills. You can reinstall it later from the marketplace.`
            : ""
        }
        confirmLabel="Uninstall"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => {
          pluginUninstallTarget?.resolve(true);
          setPluginUninstallTarget(null);
        }}
        onCancel={() => {
          pluginUninstallTarget?.resolve(false);
          setPluginUninstallTarget(null);
        }}
      />
    </>
  );
}
