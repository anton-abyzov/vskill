/**
 * Agent Registry — 53 AI coding agents with metadata.
 *
 * Each agent has detection paths, parent company info, and feature support.
 * Used to determine which agents can install/use verified skills.
 *
 * Source of truth for the count: `TOTAL_AGENTS` (derived from AGENTS_REGISTRY.length).
 * The numbers in this header are documentation only; tests assert against TOTAL_AGENTS.
 */

/** Feature support flags for an agent */
export interface FeatureSupport {
  /** Supports slash commands */
  slashCommands: boolean;
  /** Supports hooks/lifecycle events */
  hooks: boolean;
  /** Supports MCP (Model Context Protocol) */
  mcp: boolean;
  /** Supports custom system prompts (CLAUDE.md, AGENTS.md, etc.) */
  customSystemPrompt: boolean;
}

/** Definition for a single AI coding agent */
export interface AgentDefinition {
  /** Unique agent identifier */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Local skills directory path pattern (relative to project) */
  localSkillsDir: string;
  /** Global skills directory path pattern */
  globalSkillsDir: string;
  /** Whether this agent supports the universal skill format */
  isUniversal: boolean;
  /** Shell command to detect if the agent is installed */
  detectInstalled: string;
  /** Parent company or organization */
  parentCompany: string;
  /** Feature support matrix */
  featureSupport: FeatureSupport;
  /** Directory path for cached plugin installations (agent-specific) */
  pluginCacheDir?: string;
  /** Directory where marketplace-synced plugin SOURCES live. Differs from pluginCacheDir:
   *  cache holds INSTALLED plugins at `{dir}/{marketplace}/{plugin}/`, marketplaces hold
   *  SOURCES at `{dir}/{marketplace}/plugins/{plugin}/` (extra `/plugins/` segment). */
  pluginMarketplaceDir?: string;
  /** Win32 override for POSIX-only globalSkillsDir entries (0686 AC-US7-03).
   *  When set, `resolveGlobalSkillsDir` uses this on win32 instead of the
   *  deterministic `~/.config/X/` → `%APPDATA%/X/` fallback. Ignored on
   *  darwin + linux so POSIX hosts retain existing behavior. */
  win32PathOverride?: string;
  /** 0694 (AC-US4-01): Web-only "agents" with no local CLI. When true,
   *  install commands MUST refuse and Studio renders a "Remote" badge
   *  instead of install affordances. The catalog still lists the entry
   *  so users searching for the brand can discover it. */
  isRemoteOnly?: boolean;
}

/** 0694 (AC-US1-04): Backward-compat alias map for renamed agent ids.
 *  Consumed by `getAgent()` so existing scripts/lockfiles continue to work
 *  after a rename. Keys are legacy ids, values are current canonical ids. */
export const LEGACY_AGENT_IDS: Readonly<Record<string, string>> = Object.freeze({
  // 0694 US-001: split conflated `github-copilot` into VS Code extension
  // (renamed to `github-copilot-ext`) and standalone CLI (`copilot-cli`).
  "github-copilot": "github-copilot-ext",
});

/**
 * Complete registry of 53 AI coding agents.
 *
 * 8 universal agents, 45 non-universal agents.
 * Use TOTAL_AGENTS for programmatic access to the count.
 */
export const AGENTS_REGISTRY: AgentDefinition[] = [
  // ----------------------------------------------------------------
  // Universal agents (8)
  // ----------------------------------------------------------------
  {
    id: 'amp',
    displayName: 'Amp',
    localSkillsDir: '.amp/skills',
    globalSkillsDir: '~/.config/agents/skills',
    isUniversal: true,
    detectInstalled: 'which amp',
    parentCompany: 'Sourcegraph',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'cline',
    displayName: 'Cline',
    localSkillsDir: '.cline/skills',
    globalSkillsDir: '~/.cline/skills',
    isUniversal: true,
    detectInstalled: 'which cline',
    parentCompany: 'Cline',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    localSkillsDir: '.codex/skills',
    globalSkillsDir: '~/.codex/skills',
    isUniversal: true,
    detectInstalled: 'which codex',
    parentCompany: 'OpenAI',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    localSkillsDir: '.cursor/skills',
    globalSkillsDir: '~/.cursor/skills',
    isUniversal: true,
    detectInstalled: 'which cursor',
    parentCompany: 'Anysphere',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    localSkillsDir: '.gemini/skills',
    globalSkillsDir: '~/.gemini/skills',
    isUniversal: true,
    detectInstalled: 'which gemini',
    parentCompany: 'Google',
    featureSupport: { slashCommands: false, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    // 0694 US-001 (AC-US1-02): renamed from `github-copilot`. Targets the
    // VS Code Copilot extension's skills folder (`.github/copilot/skills/`).
    // The standalone `copilot` binary uses the new `copilot-cli` entry below.
    //
    // VERIFY: VS Code extensions are installed under versioned dirs
    // (`~/.vscode/extensions/github.copilot-<version>/`), so a stable
    // unversioned `globalSkillsDir` does not exist for the extension.
    // Using `~/.config/github-copilot/skills` as a vskill-managed fallback
    // — independent of the `~/.copilot/` path claimed by `copilot-cli` so
    // the two adapters do not collide on shared filesystem state.
    //
    // detectInstalled uses `which code` (VS Code on PATH) as a necessary-
    // but-not-sufficient proxy. Many VS Code users will appear "detected"
    // even without the Copilot extension installed; that is acceptable
    // because the local `.github/copilot/skills/` folder presence (checked
    // independently by `buildAgentsResponse`) is the authoritative signal.
    id: 'github-copilot-ext',
    displayName: 'GitHub Copilot (VS Code)',
    localSkillsDir: '.github/copilot/skills',
    globalSkillsDir: '~/.config/github-copilot/skills',
    isUniversal: true,
    detectInstalled: 'which code',
    parentCompany: 'GitHub (Microsoft)',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'kimi-cli',
    displayName: 'Kimi CLI',
    localSkillsDir: '.kimi/skills',
    globalSkillsDir: '~/.config/agents/skills',
    isUniversal: true,
    detectInstalled: 'which kimi',
    parentCompany: 'Moonshot AI',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    localSkillsDir: '.opencode/skills',
    globalSkillsDir: '~/.config/opencode/skills',
    isUniversal: true,
    detectInstalled: 'which opencode',
    parentCompany: 'Community',
    featureSupport: { slashCommands: false, hooks: false, mcp: true, customSystemPrompt: true },
  },

  // ----------------------------------------------------------------
  // Non-universal agents (45)
  // ----------------------------------------------------------------
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    localSkillsDir: '.agent/skills',
    globalSkillsDir: '~/.gemini/antigravity/skills',
    isUniversal: false,
    detectInstalled: 'which antigravity',
    parentCompany: 'Google',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'augment',
    displayName: 'Augment Code',
    localSkillsDir: '.augment/skills',
    globalSkillsDir: '~/.augment/skills',
    isUniversal: false,
    detectInstalled: 'which augment',
    parentCompany: 'Augment',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    localSkillsDir: '.claude/skills',
    globalSkillsDir: '~/.claude/skills',
    isUniversal: false,
    detectInstalled: 'which claude',
    parentCompany: 'Anthropic',
    featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
    pluginCacheDir: '~/.claude/plugins/cache',
    pluginMarketplaceDir: '~/.claude/plugins/marketplaces',
  },
  {
    id: 'openclaw',
    displayName: 'OpenClaw',
    localSkillsDir: '.openclaw/skills',
    globalSkillsDir: '~/.openclaw/skills',
    isUniversal: false,
    detectInstalled: 'which openclaw',
    parentCompany: 'Community',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'replit',
    displayName: 'Replit Agent',
    localSkillsDir: '.replit/skills',
    globalSkillsDir: '~/.config/agents/skills',
    isUniversal: false,
    detectInstalled: 'which replit',
    parentCompany: 'Replit',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
    isRemoteOnly: true,
  },
  {
    id: 'codebuddy',
    displayName: 'CodeBuddy',
    localSkillsDir: '.codebuddy/skills',
    globalSkillsDir: '~/.codebuddy/skills',
    isUniversal: false,
    detectInstalled: 'which codebuddy',
    parentCompany: 'CodeBuddy',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'command-code',
    displayName: 'Command Code',
    localSkillsDir: '.commandcode/skills',
    globalSkillsDir: '~/.commandcode/skills',
    isUniversal: false,
    detectInstalled: 'which command-code',
    parentCompany: 'Command',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'continue',
    displayName: 'Continue',
    localSkillsDir: '.continue/skills',
    globalSkillsDir: '~/.continue/skills',
    isUniversal: false,
    detectInstalled: 'which continue',
    parentCompany: 'Continue',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'crush',
    displayName: 'Crush',
    localSkillsDir: '.crush/skills',
    globalSkillsDir: '~/.config/crush/skills',
    isUniversal: false,
    detectInstalled: 'which crush',
    parentCompany: 'Crush',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'droid',
    displayName: 'Droid (Factory)',
    localSkillsDir: '.factory/skills',
    globalSkillsDir: '~/.factory/skills',
    isUniversal: false,
    detectInstalled: 'which droid',
    parentCompany: 'Factory',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'goose',
    displayName: 'Goose',
    localSkillsDir: '.goose/skills',
    globalSkillsDir: '~/.config/goose/skills',
    isUniversal: false,
    detectInstalled: 'which goose',
    parentCompany: 'Block',
    featureSupport: { slashCommands: false, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'junie',
    displayName: 'Junie',
    localSkillsDir: '.junie/skills',
    globalSkillsDir: '~/.junie/skills',
    isUniversal: false,
    detectInstalled: 'which junie',
    parentCompany: 'JetBrains',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'iflow-cli',
    displayName: 'iFlow CLI',
    localSkillsDir: '.iflow/skills',
    globalSkillsDir: '~/.iflow/skills',
    isUniversal: false,
    detectInstalled: 'which iflow',
    parentCompany: 'iFlow',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'kilo',
    displayName: 'Kilo Code',
    localSkillsDir: '.kilocode/skills',
    globalSkillsDir: '~/.kilocode/skills',
    isUniversal: false,
    detectInstalled: 'which kilocode',
    parentCompany: 'Kilo Code',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'kiro-cli',
    displayName: 'Kiro CLI',
    localSkillsDir: '.kiro/skills',
    globalSkillsDir: '~/.kiro/skills',
    isUniversal: false,
    detectInstalled: 'which kiro',
    parentCompany: 'AWS',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'kode',
    displayName: 'Kode',
    localSkillsDir: '.kode/skills',
    globalSkillsDir: '~/.kode/skills',
    isUniversal: false,
    detectInstalled: 'which kode',
    parentCompany: 'Kode',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'mcpjam',
    displayName: 'MCPJam',
    localSkillsDir: '.mcpjam/skills',
    globalSkillsDir: '~/.mcpjam/skills',
    isUniversal: false,
    detectInstalled: 'which mcpjam',
    parentCompany: 'MCPJam',
    featureSupport: { slashCommands: false, hooks: false, mcp: true, customSystemPrompt: false },
  },
  {
    id: 'mistral-vibe',
    displayName: 'Mistral Vibe',
    localSkillsDir: '.vibe/skills',
    globalSkillsDir: '~/.vibe/skills',
    isUniversal: false,
    detectInstalled: 'which vibe',
    parentCompany: 'Mistral AI',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'mux',
    displayName: 'Mux',
    localSkillsDir: '.mux/skills',
    globalSkillsDir: '~/.mux/skills',
    isUniversal: false,
    detectInstalled: 'which mux',
    parentCompany: 'Mux',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'openhands',
    displayName: 'OpenHands',
    localSkillsDir: '.openhands/skills',
    globalSkillsDir: '~/.openhands/skills',
    isUniversal: false,
    detectInstalled: 'which openhands',
    parentCompany: 'All Hands AI',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'pi',
    displayName: 'Pi',
    localSkillsDir: '.pi/skills',
    globalSkillsDir: '~/.pi/agent/skills',
    isUniversal: false,
    detectInstalled: 'which pi',
    parentCompany: 'Pi',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'qoder',
    displayName: 'Qoder',
    localSkillsDir: '.qoder/skills',
    globalSkillsDir: '~/.qoder/skills',
    isUniversal: false,
    detectInstalled: 'which qoder',
    parentCompany: 'Qoder',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'qwen-code',
    displayName: 'Qwen Code',
    localSkillsDir: '.qwen/skills',
    globalSkillsDir: '~/.qwen/skills',
    isUniversal: false,
    detectInstalled: 'which qwen-code',
    parentCompany: 'Alibaba',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'roo',
    displayName: 'Roo Code',
    localSkillsDir: '.roo/skills',
    globalSkillsDir: '~/.roo/skills',
    isUniversal: false,
    detectInstalled: 'which roo',
    parentCompany: 'Roo',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'trae',
    displayName: 'Trae',
    localSkillsDir: '.trae/skills',
    globalSkillsDir: '~/.trae/skills',
    isUniversal: false,
    detectInstalled: 'which trae',
    parentCompany: 'ByteDance',
    featureSupport: { slashCommands: false, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'trae-cn',
    displayName: 'Trae CN',
    localSkillsDir: '.trae-cn/skills',
    globalSkillsDir: '~/.trae-cn/skills',
    isUniversal: false,
    detectInstalled: 'which trae-cn',
    parentCompany: 'ByteDance',
    featureSupport: { slashCommands: false, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    localSkillsDir: '.windsurf/skills',
    globalSkillsDir: '~/.codeium/windsurf/skills',
    isUniversal: false,
    detectInstalled: 'which windsurf',
    parentCompany: 'Codeium',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'zencoder',
    displayName: 'ZenCoder',
    localSkillsDir: '.zencoder/skills',
    globalSkillsDir: '~/.zencoder/skills',
    isUniversal: false,
    detectInstalled: 'which zencoder',
    parentCompany: 'ZenCoder',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'neovate',
    displayName: 'Neovate',
    localSkillsDir: '.neovate/skills',
    globalSkillsDir: '~/.neovate/skills',
    isUniversal: false,
    detectInstalled: 'which neovate',
    parentCompany: 'Neovate',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'pochi',
    displayName: 'Pochi',
    localSkillsDir: '.pochi/skills',
    globalSkillsDir: '~/.pochi/skills',
    isUniversal: false,
    detectInstalled: 'which pochi',
    parentCompany: 'Pochi',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'adal',
    displayName: 'Adal',
    localSkillsDir: '.adal/skills',
    globalSkillsDir: '~/.adal/skills',
    isUniversal: false,
    detectInstalled: 'which adal',
    parentCompany: 'Adal',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'cortex',
    displayName: 'Cortex',
    localSkillsDir: '.cortex/skills',
    globalSkillsDir: '~/.snowflake/cortex/skills',
    isUniversal: false,
    detectInstalled: 'which cortex',
    parentCompany: 'Cortex',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'aider',
    displayName: 'Aider',
    localSkillsDir: '.aider/skills',
    globalSkillsDir: '~/.aider/skills',
    isUniversal: false,
    detectInstalled: 'which aider',
    parentCompany: 'Aider',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'tabnine',
    displayName: 'Tabnine Chat',
    localSkillsDir: '.tabnine/skills',
    globalSkillsDir: '~/.tabnine/skills',
    isUniversal: false,
    detectInstalled: 'which tabnine',
    parentCompany: 'Tabnine',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    // 0694 US-004: Devin is a hosted web service — no local CLI to install
    // skills into. Catalog entry retained for discoverability; isRemoteOnly
    // suppresses install affordances and shows a "Remote" badge in Studio.
    id: 'devin',
    displayName: 'Devin',
    localSkillsDir: '.devin/skills',
    globalSkillsDir: '~/.devin/skills',
    isUniversal: false,
    detectInstalled: 'which devin',
    parentCompany: 'Cognition',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
    isRemoteOnly: true,
  },
  {
    // 0694 US-004: bolt.new is a browser-only product. See devin entry above.
    id: 'bolt-new',
    displayName: 'bolt.new',
    localSkillsDir: '.bolt/skills',
    globalSkillsDir: '~/.bolt/skills',
    isUniversal: false,
    detectInstalled: 'which bolt',
    parentCompany: 'StackBlitz',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
    isRemoteOnly: true,
  },
  {
    // 0694 US-004: v0 is a Vercel hosted UI generator. See devin entry above.
    id: 'v0',
    displayName: 'v0',
    localSkillsDir: '.v0/skills',
    globalSkillsDir: '~/.v0/skills',
    isUniversal: false,
    detectInstalled: 'which v0',
    parentCompany: 'Vercel',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
    isRemoteOnly: true,
  },
  {
    id: 'gpt-pilot',
    displayName: 'GPT Pilot',
    localSkillsDir: '.gpt-pilot/skills',
    globalSkillsDir: '~/.gpt-pilot/skills',
    isUniversal: false,
    detectInstalled: 'which gpt-pilot',
    parentCompany: 'Pythagora',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'plandex',
    displayName: 'Plandex',
    localSkillsDir: '.plandex/skills',
    globalSkillsDir: '~/.plandex/skills',
    isUniversal: false,
    detectInstalled: 'which plandex',
    parentCompany: 'Plandex',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'sweep',
    displayName: 'Sweep',
    localSkillsDir: '.sweep/skills',
    globalSkillsDir: '~/.sweep/skills',
    isUniversal: false,
    detectInstalled: 'which sweep',
    parentCompany: 'Sweep AI',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'mentat',
    displayName: 'Mentat',
    localSkillsDir: '.mentat/skills',
    globalSkillsDir: '~/.mentat/skills',
    isUniversal: false,
    detectInstalled: 'which mentat',
    parentCompany: 'AbanteAI',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },

  // ----------------------------------------------------------------
  // 0694: New CLI adapters (US-001 / US-002 / US-003 / US-005)
  // ----------------------------------------------------------------
  {
    // 0694 US-001 (AC-US1-01): standalone `copilot` binary (GA Apr 2026),
    // separate from the VS Code Copilot extension above.
    id: 'copilot-cli',
    displayName: 'GitHub Copilot CLI',
    localSkillsDir: '.copilot/skills',
    globalSkillsDir: '~/.copilot/skills',
    isUniversal: false,
    detectInstalled: 'which copilot',
    parentCompany: 'GitHub (Microsoft)',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    // 0694 US-002 (AC-US2-01): Warp Terminal "Oz" Agent Mode.
    // VERIFY: docs.warp.dev/agent-platform did not document a skills/rules
    // path at the time of this entry; using community-default `.warp/skills`
    // and `~/.warp/skills` until vendor confirms a canonical location.
    id: 'warp',
    displayName: 'Warp',
    localSkillsDir: '.warp/skills',
    globalSkillsDir: '~/.warp/skills',
    isUniversal: false,
    detectInstalled: 'which warp',
    parentCompany: 'Warp',
    featureSupport: { slashCommands: false, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    // 0694 US-003 (AC-US3-01): Amazon Q Developer CLI (`q` binary).
    // Confirmed binary name from github.com/aws/amazon-q-developer-cli.
    // VERIFY: skills dir convention not documented at time of entry; using
    // `~/.aws/amazonq/skills` (matches `~/.aws/amazonq` config root pattern).
    id: 'amazon-q-cli',
    displayName: 'Amazon Q CLI',
    localSkillsDir: '.amazonq/skills',
    globalSkillsDir: '~/.aws/amazonq/skills',
    isUniversal: false,
    detectInstalled: 'which q',
    parentCompany: 'AWS',
    featureSupport: { slashCommands: false, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    // 0694 US-005 (AC-US5-01): Zed editor agent panel.
    // Schema parity with specweave/src/adapters/registry.yaml (id: zed,
    // .zed/skills, MCP support). VERIFY: zed.dev/docs/ai/agent-panel does
    // not document a skills dir; following the .zed/ + .zed/skills/
    // convention used elsewhere in the registry.
    id: 'zed',
    displayName: 'Zed',
    localSkillsDir: '.zed/skills',
    globalSkillsDir: '~/.config/zed/skills',
    isUniversal: false,
    detectInstalled: 'which zed',
    parentCompany: 'Zed Industries',
    featureSupport: { slashCommands: false, hooks: false, mcp: true, customSystemPrompt: true },
  },
];

/** Total number of registered agents */
export const TOTAL_AGENTS = AGENTS_REGISTRY.length;

// ---------------------------------------------------------------------------
// Non-agent config dirs — co-located here so all known config-dir
// prefixes have a single audit point alongside AGENTS_REGISTRY.
//
// These dirs are *not* agent install targets; they are sibling config dirs
// that the skill scanner / path validator must still recognize as
// "installed-style" first-segments (e.g., to avoid treating files inside
// .vscode or .github as user-authored skills).
// ---------------------------------------------------------------------------
export const NON_AGENT_CONFIG_DIRS = Object.freeze([
  ".specweave",
  ".vscode",
  ".idea",
  ".zed",
  ".devcontainer",
  ".github",
  ".agents",
  ".agent",
] as const);

// ---------------------------------------------------------------------------
// Agent Creation Profile
// ---------------------------------------------------------------------------

/** Profile for generating skills targeted at a specific agent */
export interface AgentCreationProfile {
  agent: AgentDefinition;
  /** Claude-specific frontmatter fields to remove for this agent */
  stripFields: string[];
  /** Agent-specific guidance to inject into the generation prompt */
  addGuidance: string[];
  /** Feature support snapshot for generation context */
  featureSupport: FeatureSupport;
}

/** Claude-specific frontmatter fields that non-Claude agents don't support */
const CLAUDE_STRIP_FIELDS = [
  'user-invocable',
  'allowed-tools',
  'model',
  'argument-hint',
  'context',
];

/**
 * Filter agents by feature requirements.
 * Returns agents where ALL specified features are true (AND logic).
 * Empty requirements object returns all agents.
 */
export function filterAgentsByFeatures(
  requirements: Partial<FeatureSupport>,
): AgentDefinition[] {
  const entries = Object.entries(requirements) as [keyof FeatureSupport, boolean][];
  if (entries.length === 0) return [...AGENTS_REGISTRY];
  return AGENTS_REGISTRY.filter((agent) =>
    entries.every(([key, value]) => agent.featureSupport[key] === value),
  );
}

/**
 * Get the creation profile for a specific agent.
 * Returns guidance on what to strip/add when generating skills for this agent.
 *
 * - Claude Code: empty stripFields, empty addGuidance (full feature support)
 * - Non-Claude: stripFields lists Claude-specific fields, addGuidance warns about unsupported features
 */
export function getAgentCreationProfile(agentId: string): AgentCreationProfile | undefined {
  const agent = AGENTS_REGISTRY.find((a) => a.id === agentId);
  if (!agent) return undefined;

  const { featureSupport } = agent;

  // Claude Code has full feature support — no stripping or guidance needed
  if (agent.id === 'claude-code') {
    return { agent, stripFields: [], addGuidance: [], featureSupport };
  }

  const addGuidance: string[] = [];
  if (!featureSupport.slashCommands) {
    addGuidance.push('Do NOT reference slash commands (/command syntax) in the skill body.');
  }
  if (!featureSupport.hooks) {
    addGuidance.push('Do NOT include hook examples or lifecycle hook references.');
  }
  if (!featureSupport.mcp) {
    addGuidance.push('Do NOT reference MCP tools; use CLI/filesystem alternatives only.');
  }
  if (!featureSupport.customSystemPrompt) {
    addGuidance.push('Keep the skill as plain instructions without system prompt framing.');
  }

  return {
    agent,
    stripFields: CLAUDE_STRIP_FIELDS,
    addGuidance,
    featureSupport,
  };
}

/**
 * Returns all universal agents (support the universal skill format).
 */
export function getUniversalAgents(): AgentDefinition[] {
  return AGENTS_REGISTRY.filter((a) => a.isUniversal);
}

/**
 * Returns all non-universal agents.
 */
export function getNonUniversalAgents(): AgentDefinition[] {
  return AGENTS_REGISTRY.filter((a) => !a.isUniversal);
}

/**
 * Gets a single agent by ID. Honors `LEGACY_AGENT_IDS` so callers using a
 * renamed legacy id (e.g. `github-copilot`) still resolve to the current
 * canonical entry (e.g. `github-copilot-ext`).
 *
 * @param id - Agent identifier (current or legacy alias)
 * @returns The agent definition, or undefined if not found
 */
export function getAgent(id: string): AgentDefinition | undefined {
  const canonical = LEGACY_AGENT_IDS[id] ?? id;
  return AGENTS_REGISTRY.find((a) => a.id === canonical);
}

/**
 * 0694 (AC-US4-03): Returns agents that can be installed locally.
 * Excludes any entry flagged `isRemoteOnly: true` (web-only tools like
 * Devin / bolt.new / v0 / Replit). Used by `vskill add`, the Studio
 * AgentScopePicker install affordances, and any caller that needs the
 * "real" installable agent list.
 */
export function getInstallableAgents(): AgentDefinition[] {
  return AGENTS_REGISTRY.filter((a) => a.isRemoteOnly !== true);
}

/**
 * Resolve a tilde-prefixed path to an absolute path.
 */
function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return home + p.slice(1);
  }
  return p;
}

/**
 * Detects which agents are installed on the current system.
 *
 * Detection strategy (in order):
 * 1. Run agent's `detectInstalled` shell command (typically `which <binary>`)
 * 2. Fallback: check if the agent's global config directory exists
 *    (e.g. ~/.cursor, ~/.windsurf — derived from globalSkillsDir parent)
 *
 * This two-tier approach catches desktop apps and IDE extensions that
 * create config directories but don't install CLI binaries in PATH.
 *
 * @returns Array of installed agent definitions
 */
export async function detectInstalledAgents(): Promise<AgentDefinition[]> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { existsSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const execAsync = promisify(exec);

  const results: AgentDefinition[] = [];

  await Promise.allSettled(
    AGENTS_REGISTRY.map(async (agent) => {
      // Tier 1: CLI binary detection
      try {
        await execAsync(agent.detectInstalled);
        results.push(agent);
        return;
      } catch {
        // Binary not found — try directory fallback
      }

      // Tier 2: Config directory detection
      // Only check if the agent's global skills dir itself exists.
      // Checking the parent config dir (e.g. ~/.cursor/) caused massive false positives —
      // many tools leave config dirs behind even when not actively used,
      // leading to unwanted local skill directories being created for every detected agent.
      try {
        const globalDir = expandHome(agent.globalSkillsDir);
        const home = process.env.HOME || process.env.USERPROFILE || '';
        const configDir = dirname(globalDir);
        // Guard: don't match on generic dirs like $HOME or $HOME/.config
        if (configDir !== home && configDir !== `${home}/.config`) {
          if (existsSync(globalDir)) {
            results.push(agent);
          }
        }
      } catch {
        // Skip on any error
      }
    }),
  );

  return results.sort((a, b) => a.id.localeCompare(b.id));
}
