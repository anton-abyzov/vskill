/**
 * Central user-facing copy for vSkill Studio (T-035 / US-010).
 *
 * Every string the user can read in the Studio shell lives here so that:
 *   1. Voice stays consistent (short declarative sentence + concrete next step).
 *   2. A single CI regex pass (`scripts/check-strings-voice.ts`) can enforce
 *      voice rules via the forbidden-pattern set defined in that script.
 *   3. Copy can be reviewed and changed without touching component logic.
 *
 * Rules (voice) — enforced by scripts/check-strings-voice.ts:
 *   - Empty-state pattern: a short declarative sentence + concrete next step.
 *   - Success toasts: five words or fewer.
 *   - No trailing exclamation point at end of any value.
 *   - No celebration emoji (confetti, rockets, sparkles, check marks, etc.).
 *   - No casual-apology or hype words (see voice script for the regex set).
 *
 * Components MUST import from this module rather than inlining copy.
 * Existing inline strings are being migrated incrementally.
 */

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
const sidebar = {
  sectionOwn: "Own",
  sectionInstalled: "Installed",
  searchPlaceholder: "Search skills",
  searchShortcutHint: "Press / to search",
  emptyOwnHeadline: "No skills yet.",
  emptyOwnBody: "Run vskill new <name> to create one.",
  emptyInstalledHeadline: "No installed skills.",
  emptyInstalledBody: "Run vskill install <skill> to add one.",
  emptyFilteredHeadline: "No matches in this section.",
  emptyFilteredBody: "Clear the search or try another query.",
  loadErrorHeadline: "Couldn't load skills.",
  loadErrorRetry: "Retry",
  duplicateBadge: "synced from Own",
  updateAvailableBadge: "Update available",
  countBadgeFiltered: (shown: number, total: number) => `${shown} of ${total}`,
} as const;

// ---------------------------------------------------------------------------
// Top rail + status bar
// ---------------------------------------------------------------------------
const shell = {
  appTitle: "Skill Studio",
  commandPaletteButtonLabel: "Open command palette",
  commandPaletteHint: "⌘K",
  themeToggleLight: "Switch to light theme",
  themeToggleDark: "Switch to dark theme",
  themeToggleAuto: "Switch to auto theme",
  projectPathLabel: "Project",
  modelLabel: "Model",
  healthLabel: "Health",
} as const;

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
const detail = {
  tabOverview: "Overview",
  tabVersions: "Versions",
  tabBenchmark: "Benchmark",
  emptyHeadline: "Select a skill to see details.",
  emptyBody: "Pick one from the sidebar.",
  loadErrorHeadline: (skillName: string) =>
    `Couldn't load SKILL.md for ${skillName}.`,
  loadErrorBody: "Check the file path and your workspace permissions.",
  openInEditor: "Open in editor",
  copyPath: "Copy path",
  copyConfigSnippet: "Copy config snippet",
  depNotInstalledTooltip: "Not installed",
  missingValue: "—",
  announceViewingOwn: (name: string) => `Viewing ${name} (Own)`,
  announceViewingInstalled: (name: string) => `Viewing ${name} (Installed)`,
  moreFields: "More fields",
  sourceAgent: "Source agent",
  noMcpDependencies: "No MCP dependencies.",
  filesystemGroup: "Filesystem",
  benchmarkGroup: "Benchmark",
  metadataGroup: "Frontmatter",
} as const;

// ---------------------------------------------------------------------------
// Actions + context menu
// ---------------------------------------------------------------------------
const actions = {
  open: "Open",
  copyPath: "Copy Path",
  revealInEditor: "Reveal in Editor",
  edit: "Edit",
  duplicate: "Duplicate",
  // 0828: forks an installed skill into the authoring scope so the user
  // can edit/own a copy. Wired in useContextMenuState → POST /api/skills/clone.
  cloneToAuthoring: "Clone to authoring…",
  runBenchmark: "Run Benchmark",
  update: "Update",
  uninstall: "Uninstall",
  retry: "Retry",
  // 0722: delete a user-owned skill via OS trash.
  delete: "Delete",
  deletePluginTooltip:
    "Plugin skills are managed by their owning plugin — uninstall the plugin to remove.",
  undo: "Undo",
} as const;

// ---------------------------------------------------------------------------
// Command palette
// ---------------------------------------------------------------------------
const palette = {
  inputPlaceholder: "Type a command or search",
  emptyResults: "No matches. Try a different query.",
  groupNavigation: "Navigation",
  groupActions: "Actions",
  groupTheme: "Theme",
  actionSelectSkill: "Select skill",
  actionRunBenchmark: "Run benchmark",
  actionSwitchTheme: "Switch theme",
  actionNewSkill: "New skill",
  closeLabel: "Close palette",
} as const;

// ---------------------------------------------------------------------------
// Shortcut modal
// ---------------------------------------------------------------------------
const shortcuts = {
  title: "Keyboard shortcuts",
  closeLabel: "Close shortcuts",
  groupNavigation: "Navigation",
  groupActions: "Actions",
  groupTheme: "Theme",
  search: "Focus search",
  moveDown: "Move selection down",
  moveUp: "Move selection up",
  openSelected: "Open selected skill",
  openPalette: "Open command palette",
  openShortcuts: "Open this cheatsheet",
  toggleSidebar: "Toggle sidebar",
  toggleTheme: "Toggle theme",
} as const;

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
const toasts = {
  // Success toasts: ≤ 5 words.
  pathCopied: "Path copied.",
  configCopied: "Config copied.",
  skillDuplicated: "Skill duplicated.",
  // 0828: clone-to-authoring outcomes (wired in useContextMenuState).
  cloneStarted: "Cloning to authoring…",
  cloneSucceeded: "Cloned to authoring.",
  cloneFailed: "Clone failed. Check eval-server logs.",
  benchmarkQueued: "Benchmark queued.",
  themeUpdated: "Theme updated.",
  skillUpdated: "Skill updated.",
  // 0820 — Open / Reveal in Editor outcomes.
  openingInEditor: "Opening in editor…",
  noEditor: "No editor found. Set $VISUAL or $EDITOR, or install code/cursor.",
  openFailed: "Could not open in editor.",
  skillNotFound: "Skill not found on disk.",
  // 0820 — uninstall is wired to the menu but the confirm flow lands later.
  uninstallNotImplemented: "Uninstall is not yet available from this menu.",
  // Error toasts.
  actionFailed: "Action failed. Retry or check logs.",
  networkError: "Network error. Check your connection.",
  permissionDenied: "Permission denied. Check file access.",
  unknownError: "Something went wrong. Retry or check logs.",
} as const;

// ---------------------------------------------------------------------------
// Connection + loading
// ---------------------------------------------------------------------------
const connection = {
  disconnected: "Disconnected — reconnecting…",
  reconnected: "Reconnected.",
  loading: "Loading skills…",
  loadingPlaceholderCount: "—",
} as const;

// ---------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------
const forms = {
  fieldRequired: "This field is required.",
  nameInvalid: "Use letters, numbers, and hyphens.",
  descriptionRequired: "Description is required.",
  saveFailed: "Save failed. Check the form for errors.",
} as const;

// ---------------------------------------------------------------------------
// Errors + boundaries
// ---------------------------------------------------------------------------
const errors = {
  boundaryHeadline: "Something broke in this view.",
  boundaryBody: "Reload the page to recover.",
  boundaryAction: "Reload",
} as const;

// ---------------------------------------------------------------------------
// Agent + model picker (0682)
// ---------------------------------------------------------------------------
const picker = {
  triggerLabel: "Agent and model",
  popoverTitle: "Select agent and model",
  footerHint: "↑↓ navigate · Enter select · Esc close",
  settingsButton: "Settings",
  keyboardShortcut: "⌘K",
  noModelsYet: "No models yet.",
  searchPlaceholder: "Search 300+ models…",
  noMatches: (query: string) => `No models match "${query}"`,
  clearSearch: "Clear",
  currentlyActive: "Currently active",
} as const;

const providers = {
  claudeCli: {
    name: "Claude Code",
    caption: "Delegates to the `claude` CLI — your existing Claude Code session handles quota.",
    missingBinary: "Claude Code not found. Install it: `npm install -g @anthropic-ai/claude-code`. Or choose a provider with an API key.",
    installCta: "Install Claude Code →",
    installUrl: "https://docs.claude.com/en/docs/claude-code",
  },
  anthropic: {
    name: "Anthropic API",
    caption: "Direct access via your Anthropic API key.",
    addKeyCta: "Add API key →",
    keyIssuanceUrl: "https://platform.claude.com/settings/keys",
    keyPrefix: "sk-ant-",
  },
  openai: {
    name: "OpenAI",
    caption: "GPT-4, GPT-5, and the o-series reasoning models.",
    addKeyCta: "Add API key →",
    keyIssuanceUrl: "https://platform.openai.com/api-keys",
    keyPrefix: "sk-",
    pastePlaceholder: "Paste OpenAI API key (sk-proj-...)",
  },
  openrouter: {
    name: "OpenRouter",
    caption: "300+ models from every major vendor.",
    addKeyCta: "Add API key →",
    emptyCardBody: "Add your OpenRouter API key to browse 300+ models",
    keyIssuanceUrl: "https://openrouter.ai/settings/keys",
    keyPrefix: "sk-or-",
  },
  cursor: { name: "Cursor", caption: "Cursor IDE composer.", installCta: "Install Cursor →" },
  codexCli: { name: "Codex CLI", caption: "OpenAI Codex CLI.", installCta: "Install Codex CLI →" },
  geminiCli: { name: "Gemini CLI", caption: "Google Gemini CLI.", installCta: "Install Gemini CLI →" },
  copilot: { name: "GitHub Copilot", caption: "GitHub Copilot CLI.", installCta: "Install Copilot →" },
  zed: { name: "Zed", caption: "Zed editor.", installCta: "Install Zed →" },
  ollama: { name: "Ollama", caption: "Local models, free.", startServiceCta: "Start service →" },
  // 0701: LM Studio's CTA used to say "Start service →" which conflated
  // installing the app with starting its built-in OpenAI-compatible HTTP
  // server. Split the copy so users who already have the app know exactly
  // which step is missing (Developer tab → Start Server).
  lmStudio: {
    name: "LM Studio",
    caption: "Local models, free.",
    startServiceCta: "Start LM Studio server →",
    startServiceTooltip: "Open LM Studio → Developer tab → Start Server (default port 1234).",
  },
} as const;

const models = {
  subscriptionBilling: "· subscription",
  free: "· free",
} as const;

const settings = {
  title: "Settings",
  sectionApiKeys: "API Keys",
  banner: "Keys are stored locally on this device only. Never synced, never committed to git, never transmitted off-device except to the provider's own API.",
  storagePath: (path: string) => `Keys stored at ${path} · protected by file permissions (0600 on macOS/Linux)`,
  storagePathFallback: "Keys stored locally on this device.",
  copyPath: "Copy path",
  pathCopied: "Path copied.",
  show: "Show",
  hide: "Hide",
  paste: "Paste",
  save: "Save",
  remove: "Remove",
  removeConfirm: (provider: string) => `Remove ${provider} API key?`,
  keyStoredAt: (when: string) => `Key stored locally — updated ${when}`,
  noKey: "No key stored",
  enterNonEmpty: "Enter a non-empty key",
  prefixWarn: (provider: string) =>
    `This doesn't look like a typical ${provider} key. Save anyway?`,
  keySaved: (provider: string) => `${provider} API key saved (local only, never synced)`,
  keyRemoved: (provider: string) => `${provider} API key removed`,
} as const;

const statusBar = {
  providersLabel: "Providers",
  providerSummary: (n: number, m: number) => `${n}/${m} providers`,
  locked: (name: string) => `${name} — locked. Click to add a key.`,
  lockedCli: (name: string) => `${name} — locked. Click for install instructions.`,
  unlocked: (name: string) => `${name} — unlocked.`,
} as const;

// ---------------------------------------------------------------------------
// 0686 US-002 / US-005 / US-006: Scope picker + Setup drawer + Claude Code
// label copy. Every user-facing string for the 0686 surface lives here so
// the CI voice regex and SetupProviderView regression tests can pin it.
// ---------------------------------------------------------------------------

const scopePicker = {
  triggerAriaLabel: "Choose active agent for the sidebar",
  popoverTitle: "Choose active agent",
  statsInstalled: "Installed",
  statsGlobal: "Global",
  statsPlugins: "Plugins",
  statsLastSync: "Last sync",
  statsHealthOk: "Fresh",
  statsHealthStale: "Updates available",
  statsHealthMissing: "Not detected",
  switchCta: "Switch for this studio session",
  notDetectedSubheading: "Not detected",
  setUpCta: (agent: string) => `Set up ${agent}`,
  sharedFolderBanner: (consumers: string) => `Shared folder — consumed by ${consumers}`,
} as const;

const scopeSection = {
  ownLabel: "Own",
  installedLabel: "Installed",
  globalLabel: "Global",
  emptyOwn: "No authored skills — run vskill new.",
  emptyInstalled: (agent: string) =>
    `No skills installed for ${agent} in this project — run vskill install.`,
  emptyGlobal: (agent: string) =>
    `No global skills for ${agent} — run vskill install --global.`,
} as const;

const claudeCodeLabel = {
  /** Exact compact label rendered on the Claude Code row in AgentModelPicker
   *  and referenced by the AgentScopePicker stats pane. AC-US5-01 (0682) bans
   *  "Max/Pro" and "subscription" in picker / Settings / StatusBar surfaces. */
  compactLabel: "Uses your Claude Code session · overflow billed at API rates",
  tooltip:
    "vSkill delegates to the `claude` CLI — your existing Claude Code session " +
    "handles quota. If you've enabled extra usage in your account settings, " +
    "excess runs at standard API rates. Run /usage in Claude Code or visit " +
    "claude.com Settings → Usage to see remaining quota — vskill can't display it directly.",
  firstUseBanner:
    "Claude Code uses your existing session. No API key needed — vskill just " +
    "runs the official claude binary on your behalf.",
  learnMore: "Learn more",
} as const;

const setupDrawer = {
  title: (provider: string) => `Set up ${provider}`,
  close: "Close",
  copy: "Copy",
  copied: "Copied",
  requiredEnv: "Required env vars",
  getKey: "Get a key",
  installRun: "Install & run",
  learnMore: "Learn more",
  fallbackTitle: "No setup guide available",
  fallbackBody: "We don't ship a setup guide for this provider yet.",
} as const;

// ---------------------------------------------------------------------------
// 0698 T-007: Anthropic-aligned scope labels (two-tier sidebar).
// `scopeSection` above remains for 0688 overlap; new UI reads from here.
// ---------------------------------------------------------------------------
const scopeLabels = {
  groupAvailable: "Available",
  groupAuthoring: "Authoring",
  sourceProject: "Project",
  sourcePersonal: "Personal",
  sourcePlugin: "Plugins",
  authoringSkills: "Skills",
} as const;

const setupProviders = {
  anthropic: {
    name: "Anthropic API",
    description:
      "Direct API access to Claude via your Anthropic API key. Pay-per-token billing.",
    envVars: ["ANTHROPIC_API_KEY"],
    keyUrl: "https://platform.claude.com/settings/keys",
    learnMoreUrl: "https://docs.claude.com/en/docs/get-started",
  },
  openai: {
    name: "OpenAI",
    description:
      "Access to GPT-4, GPT-5 and the o-series reasoning models via your OpenAI API key.",
    envVars: ["OPENAI_API_KEY"],
    keyUrl: "https://platform.openai.com/api-keys",
    learnMoreUrl: "https://platform.openai.com/docs",
  },
  openrouter: {
    name: "OpenRouter",
    description:
      "One API key, 300+ models from Anthropic, OpenAI, Google, Meta, and more.",
    envVars: ["OPENROUTER_API_KEY"],
    keyUrl: "https://openrouter.ai/keys",
    learnMoreUrl: "https://openrouter.ai/docs",
  },
  gemini: {
    name: "Gemini",
    description:
      "Google Gemini models (2.5 Pro, Flash) via Google AI Studio. Free tier available.",
    envVars: ["GEMINI_API_KEY"],
    keyUrl: "https://aistudio.google.com/apikey",
    learnMoreUrl: "https://ai.google.dev/gemini-api/docs",
  },
  ollama: {
    name: "Ollama",
    description:
      "Local models on your own machine. Zero external calls, zero cost after download.",
    envVars: ["OLLAMA_HOST"],
    installCmd: "curl -fsSL https://ollama.com/install.sh | sh",
    startCmd: "ollama serve",
    pullExample: "ollama pull llama3.2",
    learnMoreUrl: "https://ollama.com/download",
  },
  lmStudio: {
    name: "LM Studio",
    description:
      "Desktop app + local server for running open models with a GUI. Compatible with the OpenAI API.",
    envVars: ["LM_STUDIO_BASE_URL"],
    installCmd:
      "Download from https://lmstudio.ai and launch the app, then start the local server.",
    startCmd: "# In LM Studio: Developer → Start Server (default port 1234)",
    pullExample: "# In LM Studio: Discover → download any GGUF model",
    learnMoreUrl: "https://lmstudio.ai/docs",
  },
  claudeCode: {
    name: "Claude Code",
    description:
      "No API key needed if you're logged into Claude Code. vskill just runs the official claude binary on your behalf — your existing Claude Code session handles quota.",
    loginHint:
      "If you're not logged in, run claude in your terminal and authenticate with your Anthropic account.",
    learnMoreUrl: "https://docs.claude.com/en/docs/claude-code",
  },
} as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export const strings = {
  sidebar,
  shell,
  detail,
  actions,
  palette,
  shortcuts,
  toasts,
  connection,
  forms,
  errors,
  picker,
  providers,
  models,
  settings,
  statusBar,
  // 0686 surfaces
  scopePicker,
  scopeSection,
  claudeCodeLabel,
  setupDrawer,
  setupProviders,
  // 0698 surfaces
  scopeLabels,
} as const;

export type Strings = typeof strings;
