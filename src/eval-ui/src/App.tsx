import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { StudioProvider, useStudio } from "./StudioContext";
import { ConfigProvider, useConfig } from "./ConfigContext";
import { StudioLayout } from "./components/StudioLayout";
import { TopRail } from "./components/TopRail";
import { StatusBar } from "./components/StatusBar";
import { Sidebar } from "./components/Sidebar";
import { ResizeHandle, readSidebarWidth, DEFAULT_SIDEBAR_WIDTH } from "./components/ResizeHandle";
import { DisconnectBanner } from "./components/DisconnectBanner";
import { RightPanel } from "./components/RightPanel";
import { UpdateToast } from "./components/UpdateToast";
import { ToastProvider, useToast } from "./components/ToastProvider";
import { ShortcutModal } from "./components/ShortcutModal";
import { ContextMenu } from "./components/ContextMenu";
import type { ContextMenuState } from "./components/ContextMenu";
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
import { useTheme } from "./theme/useTheme";
import type { Command } from "./components/CommandPalette";
import { strings } from "./strings";

// T-039: CommandPalette is lazy-loaded so it stays out of the initial bundle.
const CommandPalette = lazy(() => import("./components/CommandPalette"));

// 0703 hotfix: lazy-load CreateSkillPage because it is only mounted when the
// hash is `/create` (the modal's Generate-with-AI branch). Keeping it out of
// the initial bundle preserves home-page LCP.
const CreateSkillPage = lazy(() =>
  import("./pages/CreateSkillPage").then((m) => ({ default: m.CreateSkillPage })),
);

function useIsCreateRoute(): boolean {
  const [onCreate, setOnCreate] = useState<boolean>(() =>
    typeof window !== "undefined" && window.location.hash.startsWith("#/create"),
  );
  useEffect(() => {
    function onHashChange(): void {
      setOnCreate(window.location.hash.startsWith("#/create"));
    }
    window.addEventListener("hashchange", onHashChange);
    // Fire once on mount — Vite HMR + some navigation paths (window.location
    // .assign before listener attach) need the sync read.
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return onCreate;
}

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
  const { state, selectSkill, clearSelection, refreshSkills, outdatedByOrigin } = useStudio();
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
  const [activeDetailTab, setActiveDetailTab] = useState<"overview" | "versions">("overview");
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
  useEffect(() => {
    // Hydrate from the server's `suggested` when no persisted choice exists.
    if (!activeAgentId && agentsResponse.response?.suggested) {
      setActiveAgentIdState(agentsResponse.response.suggested);
    }
  }, [activeAgentId, agentsResponse.response?.suggested]);
  const handleActiveAgentChange = useCallback((agentId: string) => {
    setActiveAgentIdState(agentId);
    writeStudioPreference("activeAgent", agentId);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("studio:agent-changed", { detail: { agentId } }),
      );
    }
  }, []);
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
  useEffect(() => {
    function onOpenSetup(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      const detail = e.detail as { provider?: string } | undefined;
      if (detail?.provider) setupDrawer.open(detail.provider);
    }
    window.addEventListener("studio:open-setup-drawer", onOpenSetup);
    return () => window.removeEventListener("studio:open-setup-drawer", onOpenSetup);
  }, [setupDrawer]);
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

  // Keep document.documentElement.style updated so CSS reads the live width.
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  }, [sidebarWidth]);

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

  useKeyboardShortcut([
    { key: "cmd+k", handler: () => setPaletteOpen((p) => !p) },
    { key: "ctrl+k", handler: () => setPaletteOpen((p) => !p) },
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

  // 0703 follow-up: keep StudioLayout chrome (TopRail, sidebar, ⌘K, brand)
  // visible when CreateSkillPage is active, so users don't feel teleported to
  // a standalone page and still have escape hatches. The page renders in the
  // main slot instead of replacing the whole tree.
  const mainContent = onCreateRoute ? (
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
          />
        }
        sidebar={
          <Sidebar
            skills={state.skills}
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
          // 0700 polish: open the new skill by default so the user sees their
          // creation immediately. The sidebar's SWR cache was invalidated
          // by the modal; refreshSkills() triggers a fresh /api/skills fetch.
          // Once the new skill lands in state we call selectSkill() — which
          // drives both the hash and the detail panel without needing the
          // route to match (selectSkill works off in-memory state).
          const plugin = result.pluginName ?? "";
          refreshSkills();
          // Give StudioContext one tick to fold the refetched skills into
          // state before we pick the new one out. selectSkill needs the
          // origin, which the modal doesn't know, so infer from mode:
          // standalone / new-plugin / existing-plugin all produce authored
          // skills (origin = "source").
          setTimeout(() => {
            selectSkill({
              plugin,
              skill: result.skillName,
              origin: "source",
            });
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
      />

      {/* 0700 phase 2C: live SSE progress toast while `claude plugin install`
          runs. Auto-hides ~3s after success or stays pinned on failure. */}
      <InstallProgressToast
        job={installJob}
        onDone={(result) => {
          if (result.ok) {
            setTimeout(() => setInstallJob(null), 3000);
          }
          // On failure, leave the toast pinned so the user can expand it.
        }}
      />
    </>
  );
}
