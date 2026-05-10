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
import {
  RightPanel,
  readInitialTabFromSearch,
  readInitialSub,
  defaultSubFor,
  resolveLegacyTab,
  type DetailTab,
} from "./components/RightPanel";
import { UpdateToast } from "./components/UpdateToast";
import { ToastProvider, useToast } from "./components/ToastProvider";
import { ShortcutModal } from "./components/ShortcutModal";
import { ContextMenu } from "./components/ContextMenu";
import type { ContextMenuState } from "./components/ContextMenu";
import { ConfirmDialog, getTrashLabel } from "./components/ConfirmDialog";
import { CloneToAuthoringDialog } from "./components/CloneToAuthoringDialog";
import { usePendingDeletion } from "./hooks/usePendingDeletion";
import { ApiError } from "./api";
import { PendingActionsContext } from "./PendingActionsContext";
import { SetupDrawer } from "./components/SetupDrawer";
import { useSetupDrawer } from "./hooks/useSetupDrawer";
import { AgentScopePicker, agentsResponseToPickerEntries } from "./components/AgentScopePicker";
import { ClaudeCodeFirstUseBanner } from "./components/ClaudeCodeFirstUseBanner";
import { ConnectedRepoWidget } from "./components/ConnectedRepoWidget";
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
import { strings } from "./strings";

// 0741 T-016: FindSkillsPalette (⌘K) is lazy-loaded —
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
// 0831 T-011 (AC-US1-01, AC-US2-01): GitHub user dropdown in the top-rail.
// Renders nothing in browser mode (desktop-only feature — token storage
// requires the Tauri shell's OS credential vault).
import { UserDropdown } from "./components/UserDropdown";
// 0831 T-018 / T-022 (US-005, US-008, US-010): server-authoritative quota
// state lives in QuotaProvider mounted at the root. useTier / useQuota are
// the consumer surfaces; the paywall + grace banner read from them.
import { QuotaProvider } from "./contexts/QuotaContext";
import { useTier, PRICING_URL } from "./hooks/useTier";
import { PaywallModal } from "./components/PaywallModal";
import { QuotaGraceBanner } from "./components/QuotaGraceBanner";
import { useDesktopBridge } from "./preferences/lib/useDesktopBridge";
// 0834 T-027/T-028 (US-012): Account cabinet mount points.
//
//   - AccountProvider supplies the platform base URL + auth header to
//     useAccount() consumers.
//   - AccountSidebarEntry renders below the Skills sidebar (AC-US12-01).
//   - AccountShell renders inline in the main pane (NOT a webview pop-out
//     per Q2 resolution) when the entry is active.
//
// Auth strategy: cookie-mode in both bundles. The web bundle relies on
// platform same-origin cookies; the Tauri bundle proxies authenticated
// `/api/v1/account/*` calls through the eval-server, which injects the
// keyring bearer Rust-side. The deleted `account_get_token` IPC is gone
// (0836 US-003) — the WebView never holds the raw `gho_*` token.
import { AccountProvider, type AccountContextValue } from "./contexts/AccountContext";
import {
  createTauriAccountContext,
  isTauriHost,
} from "./contexts/AccountTauriBridge";
// 0836 US-002: install the X-Studio-Token fetch patch BEFORE any component
// renders so the very first /api/* call (typically the WebSocket / SSE
// init) carries the header. Calling more than once is a no-op.
import { installStudioTokenFetchPatch } from "./contexts/StudioTokenBridge";

// Side-effect: patch globalThis.fetch on first import (Tauri only). The
// helper is itself a no-op outside Tauri, so the web build is unchanged.
installStudioTokenFetchPatch();
import { AccountSidebarEntry } from "./components/AccountSidebarEntry";
import { AccountShell } from "./components/AccountShell";

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
      {/* 0831: QuotaProvider sits ABOVE StudioProvider so any descendant
          (status bar, paywall, grace banner, ConnectedRepoWidget) can read
          the snapshot via useQuota / useTier. The provider's internal
          1m soft-poll + Tauri visibility events keep the snapshot in sync
          with the Rust-side 1h background sync task. */}
      <QuotaProvider>
        <StudioProvider>
          <ToastProvider>
            <AccountProviderHost>
              <Shell />
              <UpdateToast />
            </AccountProviderHost>
          </ToastProvider>
        </StudioProvider>
      </QuotaProvider>
    </ConfigProvider>
  );
}

/**
 * 0834 — Wraps children in <AccountProvider> with a value resolved at boot.
 * In Tauri the bridge reads from the OS keyring; in web/npx-studio it falls
 * back to the cookie-mode default. Resolves async without blocking render —
 * children mount with the cookie default, then re-render with the bearer
 * value once the IPC round-trip lands. AC-US12-03.
 */
function AccountProviderHost({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<Partial<AccountContextValue> | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    if (!isTauriHost()) return;
    void createTauriAccountContext().then((ctx) => {
      if (cancelled) return;
      setValue(ctx);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <AccountProvider value={value}>{children}</AccountProvider>;
}

function Shell() {
  const { state, selectSkill, clearSelection, refreshSkills, outdatedByOrigin, revealSkill, clearReveal } = useStudio();
  const { config } = useConfig();
  const { resolvedTheme, setTheme } = useTheme();
  const { toast } = useToast();
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readSidebarWidth());
  const [sseConnected] = useState<boolean>(true); // SSE-connection hook lives outside Phase 2 scope
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // T-0684 (B4): Cmd+B sidebar visibility toggle. Per-session only — does
  // NOT persist across reloads (spec non-goal). Mobile-view auto-hiding
  // remains governed by StudioContext.mobileView.
  const [sidebarToggledHidden, setSidebarToggledHidden] = useState(false);
  // 0834 T-027/T-028 (AC-US12-01, AC-US12-02): which surface is showing
  // in the main pane. `false` = the existing skill detail / studio editor
  // path. `true` = the AccountShell cabinet (Profile / Plan / Repos /
  // Skills / Tokens / Notifications / Danger). Toggled by clicking the
  // AccountSidebarEntry below the Skills sidebar.
  const [accountView, setAccountView] = useState(false);
  // T-063 + 0792 T-013/T-014: active detail tab AND sub-mode live at the App
  // level so the production prop-driven RightPanel path (which is the only
  // path App actually mounts) can drive both surfaces. An earlier draft kept
  // sub state inside RightPanel.IntegratedDetailShell — but that branch is
  // unreachable in production because App always passes `selectedSkillInfo`
  // as a prop, so the sub clicks were silent no-ops. Lifting both into App
  // is symmetric with the existing tab pattern and centralizes URL effects.
  //
  // Initial values read from `?tab=` (legacy `?panel=` honored), and within
  // the resolved tab from `?mode=` (run) or `?view=` (history). Legacy
  // ?panel= and ?sub= bookmarks resolve via `resolveLegacyTab`.
  const [activeDetailTab, setActiveDetailTabState] = useState<DetailTab>(() => {
    if (typeof window === "undefined") return "overview";
    return readInitialTabFromSearch(window.location.search).tab;
  });
  const [activeDetailSub, setActiveDetailSub] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const target = readInitialTabFromSearch(window.location.search);
    if (target.mode) return target.mode;
    if (target.view) return target.view;
    return readInitialSub(target.tab, window.location.search);
  });

  // Tab setter used by RightPanel — resets sub to the default for the new
  // tab so stale `?mode=`/`?view=` doesn't bleed across switches.
  const setActiveDetailTab = useCallback((next: DetailTab) => {
    setActiveDetailTabState((prev) => {
      if (prev !== next) {
        setActiveDetailSub(defaultSubFor(next));
      }
      return next;
    });
  }, []);

  // 0792 T-014: one-shot deep-link redirect on mount + popstate. All legacy
  // tokens (?tab=tests / ?tab=trigger / ?tab=activation / ?tab=versions /
  // ?tab=leaderboard / ?tab=editor / legacy ?panel=…) resolve through
  // `resolveLegacyTab`. The URL is rewritten to canonical form via
  // `replaceState` (no back-button trap) and React state is synced.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const rewrite = () => {
      const params = new URLSearchParams(window.location.search);
      const rawTab = params.get("tab");
      const rawPanel = params.get("panel");
      const target = resolveLegacyTab(rawTab) ?? resolveLegacyTab(rawPanel);
      if (!target) return;
      const next = new URLSearchParams(window.location.search);
      next.delete("panel");
      next.delete("sub");
      if (target.tab === "overview") next.delete("tab");
      else next.set("tab", target.tab);
      next.delete("mode");
      next.delete("view");
      if (target.mode) next.set("mode", target.mode);
      if (target.view) next.set("view", target.view);
      const qs = next.toString();
      const url = `${window.location.pathname}${qs ? "?" + qs : ""}${window.location.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (url !== current) {
        window.history.replaceState(null, "", url);
      }
      setActiveDetailTabState(target.tab);
      // Resolve sub from explicit hint, else fall back to descriptor default
      // for the redirected tab.
      if (target.mode) setActiveDetailSub(target.mode);
      else if (target.view) setActiveDetailSub(target.view);
      else setActiveDetailSub(defaultSubFor(target.tab));
    };
    rewrite();
    window.addEventListener("popstate", rewrite);
    return () => window.removeEventListener("popstate", rewrite);
  }, []);

  // 0792 T-014: mirror (`activeDetailTab`, `activeDetailSub`) back to the
  // URL whenever either changes so clicks update the address bar in place.
  // Canonical contract: `?tab=` (top-level) + `?mode=` (run) / `?view=`
  // (history). Legacy `?panel=` and `?sub=` are stripped on every write so
  // the URL converges to the new form.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.delete("panel");
    params.delete("sub");
    if (activeDetailTab === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", activeDetailTab);
    }
    params.delete("mode");
    params.delete("view");
    // Only persist sub when it differs from the descriptor default —
    // omitting it keeps the URL short for the common case.
    const isDefault = activeDetailSub === defaultSubFor(activeDetailTab);
    if (!isDefault && activeDetailSub) {
      if (activeDetailTab === "run") params.set("mode", activeDetailSub);
      else if (activeDetailTab === "history") params.set("view", activeDetailSub);
    }
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? "?" + qs : ""}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (url !== current) {
      window.history.replaceState(null, "", url);
    }
  }, [activeDetailTab, activeDetailSub]);
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

  // 0831: keep the activeProjectPathRef in sync so openCreateModal can
  // pass the correct project root to the local skill counter without
  // re-binding its callback identity each render.
  useEffect(() => {
    activeProjectPathRef.current = activeProject?.path ?? null;
  }, [activeProject?.path]);

  // 0698 polish: CreateSkillModal — opened from TopRail "+ New Skill" or from
  // AUTHORING group header "+" (with pre-selected mode via initialCreateMode).
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [initialCreateMode, setInitialCreateMode] = useState<CreateSkillMode>("standalone");
  // 0833 pivot — paywall state. The paywall is now triggered by the
  // private-repo connect flow (ConnectedRepoWidget), NOT by skill-create.
  // We keep the state at App level so any consumer can request the modal
  // via the existing PaywallModal mount below; the create flow no longer
  // reaches into it.
  const [paywallOpen, setPaywallOpen] = useState<boolean>(false);
  // 0833 — paywall context (repo name, etc.) carried as its own typed
  // slot. The pre-0833 design overloaded `pendingCreateMode` for this
  // purpose; that field was removed when the create-quota gate went away.
  const [paywallContext, setPaywallContext] = useState<{ repoName?: string } | null>(null);
  // Stable ref to the current active project root — populated by the
  // useEffect below once useWorkspace() declares `activeProject`. Kept
  // for future inline gates that need a stable read of the active project
  // root without triggering re-renders. (0833: previously consumed by the
  // create-quota gate, which was removed in this pivot.)
  const activeProjectPathRef = useRef<string | null>(null);
  // 0833 — tierState drives the private-repo paywall trigger via
  // ConnectedRepoWidget mounted in Sidebar.topSlot. useTier() throws if
  // QuotaProvider is missing, which doubles as a context-wiring assertion.
  const tierState = useTier();
  const bridgeForCreate = useDesktopBridge();
  // Suppress unused-import warning for PRICING_URL — exported alongside
  // the tier hook so any future gate can open it via
  // bridgeForCreate.openExternalUrl(PRICING_URL) without re-importing.
  void PRICING_URL;
  const openCreateModal = useCallback(
    async (mode: CreateSkillMode = "standalone") => {
      // 0833 pivot: skill-create is no longer tier-gated. Free users
      // create unlimited public skills; the paywall fires on the
      // private-repo connect action instead. The `quota_can_create_skill`
      // IPC stays registered for future fair-use limits but is not
      // consulted here.
      setInitialCreateMode(mode);
      setCreateModalOpen(true);
    },
    [],
  );
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

  // 0833 — paywall request bus. ConnectedRepoWidget (when mounted into
  // the shell) dispatches `studio:request-paywall` with the repo name as
  // detail. Until the widget mount lands, the bus is also the e2e
  // entrypoint that drives the auth-and-paywall regression spec —
  // dispatching the event from a test reproduces the exact runtime path
  // a real Connect-button click would take.
  useEffect(() => {
    function onRequestPaywall(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      const detail = e.detail as { repoName?: string } | undefined;
      // Store repo context in its own typed slot — the PaywallModal's
      // `skillName` prop is purely advisory copy ("skill or repo context"
      // per PaywallModal.tsx post-0833) and reads from paywallContext.
      setPaywallContext(detail?.repoName ? { repoName: detail.repoName } : null);
      setPaywallOpen(true);
    }
    window.addEventListener("studio:request-paywall", onRequestPaywall);
    return () =>
      window.removeEventListener("studio:request-paywall", onRequestPaywall);
  }, []);

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

  // 0759 Phase 7: when EditorPanel saves a SKILL.md, it dispatches a
  // `studio:content-saved` CustomEvent. Re-fetch the skill list so the
  // sidebar version badge, header, and dirty indicator all reflect the
  // freshly-persisted frontmatter (especially the version field).
  useEffect(() => {
    function onContentSaved() {
      refreshSkills();
    }
    window.addEventListener("studio:content-saved", onContentSaved);
    return () => window.removeEventListener("studio:content-saved", onContentSaved);
  }, [refreshSkills]);

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

  // 0828: clone-to-authoring dialog opens on `studio:request-clone`. The
  // dispatcher in useContextMenuState fires this event when the user picks
  // "Clone to authoring…" from the context menu of an installed skill.
  const [pendingCloneSkill, setPendingCloneSkill] = useState<SkillInfo | null>(null);
  useEffect(() => {
    function onRequestClone(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      const detail = (e as CustomEvent).detail as { skill?: SkillInfo } | undefined;
      if (detail?.skill) setPendingCloneSkill(detail.skill);
    }
    window.addEventListener("studio:request-clone", onRequestClone);
    return () => window.removeEventListener("studio:request-clone", onRequestClone);
  }, []);

  // 0780: parallel buffer for installed-skill uninstall. Same 10s undo +
  // optimistic hide as the source-skill delete flow, but commits via
  // POST /api/skills/:plugin/:skill/uninstall which removes the lockfile
  // entry AND trashes the dir.
  const [pendingUninstallSkill, setPendingUninstallSkill] = useState<SkillInfo | null>(null);
  const pendingUninstall = usePendingDeletion({
    // 0784 hotfix: was 10_000 — the 10s debounce was silently dropping the
    // uninstall whenever the user navigated away before the timer fired.
    // Toast claimed "Sent to your system Trash" but the file + lockfile
    // entry stayed intact. Drop to 250ms so the API call commits before
    // any plausible navigation, while still giving the optimisticHide a
    // tick to flush. Real undo is provided by the OS Trash (user can
    // restore the dir from there) + reinstall via `vskill install`.
    delayMs: 250,
    apiCall: (plugin, skill) => api.uninstallSkill(plugin, skill),
    onCommit: (s) => {
      refreshSkills();
      optimisticRestore(s);
    },
    onFailure: (s, err) => {
      optimisticRestore(s);
      // 0786 AC-US3-04: when the server emits the structured 422
      // not-installed contract (lockfile-first gate, see api-routes.ts
      // uninstall route), the user clicked Uninstall on a source-authored
      // skill that has no lockfile entry. Render a friendly info toast
      // pointing them at Delete instead of the cryptic generic API error.
      if (err instanceof ApiError && err.details?.code === "not-installed") {
        toast({
          message: `${s.skill} is a source-authored skill — use Delete instead`,
          severity: "info",
          durationMs: 4000,
        });
        return;
      }
      toast({
        message: `Couldn't uninstall ${s.skill}: ${err.message}`,
        severity: "error",
        durationMs: 0,
        action: {
          label: strings.actions.retry,
          onInvoke: () => {
            optimisticHide(s);
            pendingUninstall.enqueueDelete(s);
          },
        },
      });
    },
  });
  useEffect(() => {
    function onRequestUninstall(e: Event) {
      if (!(e instanceof CustomEvent)) return;
      const detail = (e as CustomEvent).detail as { skill?: SkillInfo } | undefined;
      if (detail?.skill) setPendingUninstallSkill(detail.skill);
    }
    window.addEventListener("studio:request-uninstall", onRequestUninstall);
    return () => window.removeEventListener("studio:request-uninstall", onRequestUninstall);
  }, []);

  // 0786 AC-US1-01 / AC-US1-04: bridge for the Create Skill flow. Flushes
  // any pending source-skill delete OR installed-skill uninstall whose
  // skill name matches `skillName`, so the on-disk folder is gone before
  // the server's existsSync check runs in the create handler. Stable
  // identity so `useCreateSkill`'s useCallback deps don't churn.
  const flushPendingBySkillName = useCallback(
    async (skillName: string) => {
      await Promise.all([
        pendingDeletion.flushBySkillName(skillName),
        pendingUninstall.flushBySkillName(skillName),
      ]);
    },
    [pendingDeletion, pendingUninstall],
  );
  const pendingActionsValue = useMemo(
    () => ({ flushBySkillName: flushPendingBySkillName }),
    [flushPendingBySkillName],
  );

  const handleConfirmUninstall = useCallback(() => {
    const skill = pendingUninstallSkill;
    setPendingUninstallSkill(null);
    if (!skill) return;
    const target = { plugin: skill.plugin, skill: skill.skill };
    optimisticHide(target);
    pendingUninstall.enqueueDelete(target);
    // 0784 hotfix: toast wording is honest about what's happening. The 250ms
    // commit window is too short for a meaningful Undo, and OS Trash already
    // offers true undo for the on-disk dir. Reinstall via `vskill install`
    // restores the lockfile entry.
    toast({
      message: `Uninstalled ${skill.skill}. Sent to your ${trashLabel}.`,
      severity: "info",
      durationMs: 4000,
    });
  }, [pendingUninstallSkill, optimisticHide, pendingUninstall, toast, trashLabel]);
  const handleCancelUninstall = useCallback(() => {
    setPendingUninstallSkill(null);
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

  // 0823 AC-US1-06: read-only personas land on Source by default. Fires once
  // per skill change when the URL has no explicit `?tab=`. Authors keep the
  // pre-existing `overview` default. Skipped when the user has already
  // navigated within this skill (the URL has `?tab=`), so a deep link wins.
  //
  // 0823 F-004: effect intentionally re-runs only when the SELECTED skill
  // identity changes (plugin/skill/origin), NOT when the user toggles
  // activeDetailTab manually — including activeDetailTab in deps would yank
  // them back to Source after they clicked Overview. The lint rule has been
  // satisfied via a ref capture so future readers don't break this property.
  const lastFlippedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedInfo) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab")) return; // explicit deep link wins
    const isReadOnly = selectedInfo.origin === "installed";
    if (!isReadOnly) return;
    const key = `${selectedInfo.plugin}/${selectedInfo.skill}`;
    if (lastFlippedKey.current === key) return; // already flipped for this skill
    lastFlippedKey.current = key;
    if (activeDetailTab === "overview") {
      setActiveDetailTabState("source");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInfo?.plugin, selectedInfo?.skill, selectedInfo?.origin]);

  const onSelect = useCallback(
    // 0801: forward `source` (project|personal|plugin) so the breadcrumb
    // header can render PROJECT/PERSONAL/PLUGIN matching the sidebar group.
    // Sidebar passes a full SkillInfo, but typed locally here for back-compat
    // with the older narrowed shape.
    (s: { plugin: string; skill: string; origin: "source" | "installed"; source?: import("./types").SkillSource }) => {
      selectSkill({ plugin: s.plugin, skill: s.skill, origin: s.origin, source: s.source });
    },
    [selectSkill],
  );

  const liveMessage = useMemo(() => {
    if (!state.selectedSkill) return "";
    const origin = state.selectedSkill.origin === "installed" ? "Installed" : "Own";
    return `Viewing ${state.selectedSkill.skill} (${origin})`;
  }, [state.selectedSkill]);

  // 0741 T-019: Selected skill for the SkillDetailPanel — set by the
  // FindSkillsPalette `onSelect` callback, cleared when the panel closes.
  const [findDetailSkill, setFindDetailSkill] = useState<{
    owner: string;
    repo: string;
    slug: string;
    displayName: string;
  } | null>(null);

  useKeyboardShortcut([
    // ⌘K (Mac) and Ctrl+K (Win/Linux) open the FindSkillsPalette ONLY.
    // The agent+model picker used to also fire on plain Cmd+K, so both popovers
    // would open on the same keystroke. It now lives on Cmd+Shift+M (below).
    {
      key: "cmd+k",
      handler: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("openFindSkills"));
        }
      },
    },
    {
      key: "ctrl+k",
      handler: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("openFindSkills"));
        }
      },
    },
    // ⌘⇧M (Mac) and Ctrl+Shift+M (Win/Linux) toggle the AgentModelPicker.
    // Mnemonic: "M for Model". Goes through a CustomEvent so this hook stays
    // the single source of truth for keyboard wiring (the picker also still
    // honors a direct keydown for legacy unit-test paths, but production
    // keyboard handling flows through here).
    {
      key: "cmd+shift+m",
      handler: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("openAgentModelPicker"));
        }
      },
    },
    {
      key: "ctrl+shift+m",
      handler: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("openAgentModelPicker"));
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
  ]);

  const onCreateRoute = useIsCreateRoute();
  const onUpdatesRoute = useIsUpdatesRoute();

  // 0703 follow-up: keep StudioLayout chrome (TopRail, sidebar, ⌘K, brand)
  // visible when CreateSkillPage is active, so users don't feel teleported to
  // a standalone page and still have escape hatches. The page renders in the
  // main slot instead of replacing the whole tree.
  // 0740: same treatment for the `#/updates` route — clicking "View Updates"
  // in the toast/bell now lands here instead of the empty default slot.
  // 0834 T-027/T-028 (AC-US12-01): when the user clicks the Account
  // sidebar entry, replace the main pane with AccountShell instead of
  // routing to a webview pop-out. The Skills sidebar stays visible so
  // the user can navigate back without losing context.
  const mainContent = accountView ? (
    <AccountShell
      online={typeof navigator === "undefined" ? true : navigator.onLine !== false}
      onConnectRepo={() => {
        if (typeof window !== "undefined") {
          window.open(
            "https://verified-skill.com/account/repos/connect",
            "_blank",
            "noopener,noreferrer",
          );
        }
      }}
      onUpgradeClick={() => {
        if (typeof window !== "undefined") {
          window.open(PRICING_URL, "_blank", "noopener,noreferrer");
        }
      }}
    />
  ) : onUpdatesRoute ? (
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
      activeDetailSub={activeDetailSub}
      onDetailSubChange={setActiveDetailSub}
      allSkills={state.skills}
      onSelectSkill={onSelect}
    />
  );

  return (
    <PendingActionsContext.Provider value={pendingActionsValue}>
      <StudioLayout
        sidebarWidth={sidebarWidth}
        sidebarHidden={sidebarToggledHidden || (state.isMobile && state.mobileView === "detail")}
        banner={<DisconnectBanner connected={sseConnected} />}
        liveMessage={liveMessage}
        topRail={
          <TopRail
            projectName={config?.projectName ?? null}
            selected={state.selectedSkill}
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
            userDropdownSlot={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {/* 0831 US-010: grace banner — invisible while fresh, yellow at
                    7d, red past 8d. Mounts inline next to the user dropdown so
                    a stale subscription state is always visible without taking
                    full-width banner space. */}
                <QuotaGraceBanner />
                <UserDropdown />
              </span>
            }
          />
        }
        sidebar={
          <div
            data-testid="desktop-sidebar"
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              minHeight: 0,
            }}
          >
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Sidebar
            skills={visibleSkills}
            selectedKey={
              state.selectedSkill
                ? { plugin: state.selectedSkill.plugin, skill: state.selectedSkill.skill }
                : null
            }
            onSelect={(skill) => {
              // Switching to a skill exits the account view so the
              // selected skill's detail mounts in the main pane.
              setAccountView(false);
              onSelect(skill);
            }}
            isLoading={state.skillsLoading}
            error={state.skillsError ?? null}
            onRetry={refreshSkills}
            onContextMenu={openContextMenu}
            outdatedByOrigin={outdatedByOrigin}
            activeAgentId={activeAgentId}
            revealSkillId={state.revealSkillId}
            onRevealComplete={clearReveal}
            dirtySkillIds={dirtySkillIds}
            onSkillsChanged={refreshSkills}
            topSlot={
              <>
                {agentsResponse.status === "ready" && pickerEntries.length > 0 ? (
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
                ) : null}
                {/* 0833 — connected-repo widget. Renders the active
                    project's git/repo info and, for free users on a
                    private remote, surfaces the "Pro" upgrade chip that
                    fires the paywall. The widget internally short-circuits
                    when there's no active project (folder = null) so the
                    mount stays cheap. AC-US2-02 + AC-US2-04. */}
                {activeProject?.path ? (
                  <ConnectedRepoWidget
                    folder={activeProject.path}
                    tier={tierState.tier}
                    onUpgradeClick={() => {
                      // Dispatch through the same paywall bus the e2e
                      // regression spec exercises — keeps the runtime
                      // path identical to the test path. App.tsx listens
                      // for `studio:request-paywall` and opens
                      // PaywallModal with the repo name as context.
                      try {
                        window.dispatchEvent(
                          new CustomEvent("studio:request-paywall", {
                            detail: { repoName: activeProject.path },
                          }),
                        );
                      } catch { /* SSR/test fallback */ }
                    }}
                  />
                ) : null}
              </>
            }
          />
          </div>
          {/* 0834 T-027/T-028 (AC-US12-01, US-005, US-006): Account
              entry below Skills. Same component used by the desktop
              Tauri sidebar AND the npx vskill studio browser sidebar
              — single render path, identical-by-construction. */}
          <div
            style={{
              borderTop: "1px solid var(--border-default, rgba(128,128,128,0.25))",
              padding: "6px 0",
            }}
          >
            <AccountSidebarEntry
              active={accountView}
              onClick={() => setAccountView((v) => !v)}
            />
          </div>
          </div>
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
      {/* 0741 T-014/T-016: FindSkillsPalette (⌘K). Always mounted but the
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
          // 0831 telemetry — best-effort POST of the new local count to the
          // platform's `/api/v1/billing/quota/report`. Failure is silent;
          // the platform also gets the count via the next 1h sync GET.
          // Use the local count from the latest workspace state — the
          // counter is debounced server-side so a tiny over-report (e.g.
          // newly-created skill not yet in state) is harmless.
          void bridgeForCreate.quotaReportCount(visibleSkills.length + 1);
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

      {/* 0780: installed-skill uninstall confirmation. Opened by
          studio:request-uninstall events from the read-only-banner Uninstall
          button. Sends the dir to OS trash and removes the lockfile entry. */}
      <ConfirmDialog
        open={pendingUninstallSkill !== null}
        title={pendingUninstallSkill ? `Uninstall "${pendingUninstallSkill.skill}"?` : ""}
        body={`It will be sent to your ${trashLabel} and the lockfile entry will be removed. You can re-install with vskill install.`}
        confirmLabel="Uninstall"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={handleConfirmUninstall}
        onCancel={handleCancelUninstall}
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

      {/* 0833 pivot — paywall modal. Triggered by ConnectedRepoWidget when
          a free user clicks "Connect" on a private repo (was: 51st skill
          create in 0831). The modal internally fires a fresh quota sync;
          if the user is actually on Pro it auto-dismisses (AC-US2-06).
          Auto-resume of the connect action requires the widget mount to
          be live (deferred to a follow-up increment); until then,
          dismissing the paywall returns the user to the connect button to
          click again. */}
      <PaywallModal
        open={paywallOpen}
        skillName={paywallContext?.repoName ?? undefined}
        onClose={() => {
          setPaywallOpen(false);
          setPaywallContext(null);
        }}
        onProceed={() => {
          // Race-resolved: user is on Pro. Clear paywall context and let
          // the paid-tier UI take over. Auto-resume of the original
          // connect action will land alongside the widget mount in a
          // follow-up — there is currently no listener for a resume
          // event, so we don't dispatch one (avoids the appearance of
          // working wiring that doesn't actually exist).
          setPaywallContext(null);
        }}
      />

      {/* 0828: Clone to authoring — opened by studio:request-clone events from
          the context-menu router. Three targets (standalone / existing plugin
          / new plugin) — see CloneToAuthoringDialog.tsx. On success the dialog
          dispatches `studio:skills-changed` so the sidebar rescans and the
          new authoring skill appears without a manual reload. */}
      {pendingCloneSkill && (
        <CloneToAuthoringDialog
          skill={pendingCloneSkill}
          onCloned={(result) => {
            toast({
              message: strings.toasts.cloneSucceeded,
              severity: "info",
            });
            setPendingCloneSkill(null);
            try {
              window.dispatchEvent(new CustomEvent("studio:skills-changed", { detail: result }));
            } catch { /* SSR/test fallback */ }
            // Force a sidebar refresh on the next tick.
            refreshSkills();
          }}
          onCancel={() => setPendingCloneSkill(null)}
        />
      )}
    </PendingActionsContext.Provider>
  );
}
