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
  emptyInstalledBody: "Run vskill install <plugin> to add one.",
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
  runBenchmark: "Run Benchmark",
  update: "Update",
  uninstall: "Uninstall",
  retry: "Retry",
  editPlaceholder: "Edit lands with 0675. Open the file in your editor.",
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
  benchmarkQueued: "Benchmark queued.",
  themeUpdated: "Theme updated.",
  skillUpdated: "Skill updated.",
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
} as const;

export type Strings = typeof strings;
