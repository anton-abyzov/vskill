/**
 * Agent Registry — 39 AI coding agents with metadata.
 *
 * Each agent has detection paths, parent company info, and feature support.
 * Used to determine which agents can install/use verified skills.
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
}

/**
 * Complete registry of 39 AI coding agents.
 *
 * 7 universal agents, 32 non-universal agents.
 */
export const AGENTS_REGISTRY: AgentDefinition[] = [
  // ----------------------------------------------------------------
  // Universal agents (7)
  // ----------------------------------------------------------------
  {
    id: 'amp',
    displayName: 'Amp',
    localSkillsDir: '.amp/skills',
    globalSkillsDir: '~/.amp/skills',
    isUniversal: true,
    detectInstalled: 'which amp',
    parentCompany: 'Sourcegraph',
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
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    localSkillsDir: '.github/copilot/skills',
    globalSkillsDir: '~/.config/github-copilot/skills',
    isUniversal: true,
    detectInstalled: 'which github-copilot',
    parentCompany: 'GitHub (Microsoft)',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'kimi-cli',
    displayName: 'Kimi CLI',
    localSkillsDir: '.kimi/skills',
    globalSkillsDir: '~/.kimi/skills',
    isUniversal: true,
    detectInstalled: 'which kimi',
    parentCompany: 'Moonshot AI',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    localSkillsDir: '.opencode/skills',
    globalSkillsDir: '~/.opencode/skills',
    isUniversal: true,
    detectInstalled: 'which opencode',
    parentCompany: 'Community',
    featureSupport: { slashCommands: false, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'replit',
    displayName: 'Replit Agent',
    localSkillsDir: '.replit/skills',
    globalSkillsDir: '~/.replit/skills',
    isUniversal: true,
    detectInstalled: 'which replit',
    parentCompany: 'Replit',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },

  // ----------------------------------------------------------------
  // Non-universal agents (32)
  // ----------------------------------------------------------------
  {
    id: 'antigravity',
    displayName: 'Antigravity',
    localSkillsDir: '.antigravity/skills',
    globalSkillsDir: '~/.antigravity/skills',
    isUniversal: false,
    detectInstalled: 'which antigravity',
    parentCompany: 'Antigravity',
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
    localSkillsDir: '.claude/commands',
    globalSkillsDir: '~/.claude/commands',
    isUniversal: false,
    detectInstalled: 'which claude',
    parentCompany: 'Anthropic',
    featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
    pluginCacheDir: '~/.claude/plugins/cache',
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
    id: 'cline',
    displayName: 'Cline',
    localSkillsDir: '.cline/skills',
    globalSkillsDir: '~/.cline/skills',
    isUniversal: false,
    detectInstalled: 'which cline',
    parentCompany: 'Cline',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
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
    localSkillsDir: '.command-code/skills',
    globalSkillsDir: '~/.command-code/skills',
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
    globalSkillsDir: '~/.crush/skills',
    isUniversal: false,
    detectInstalled: 'which crush',
    parentCompany: 'Crush',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    localSkillsDir: '.cursor/skills',
    globalSkillsDir: '~/.cursor/skills',
    isUniversal: false,
    detectInstalled: 'which cursor',
    parentCompany: 'Anysphere',
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
  {
    id: 'droid',
    displayName: 'Droid',
    localSkillsDir: '.droid/skills',
    globalSkillsDir: '~/.droid/skills',
    isUniversal: false,
    detectInstalled: 'which droid',
    parentCompany: 'Droid',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'goose',
    displayName: 'Goose',
    localSkillsDir: '.goose/skills',
    globalSkillsDir: '~/.goose/skills',
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
    displayName: 'Kilo',
    localSkillsDir: '.kilo/skills',
    globalSkillsDir: '~/.kilo/skills',
    isUniversal: false,
    detectInstalled: 'which kilo',
    parentCompany: 'Kilo',
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
  },
  {
    id: 'kiro-cli',
    displayName: 'Kiro CLI',
    localSkillsDir: '.kiro/skills',
    globalSkillsDir: '~/.kiro/skills',
    isUniversal: false,
    detectInstalled: 'which kiro',
    parentCompany: 'Amazon',
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
    localSkillsDir: '.mistral/skills',
    globalSkillsDir: '~/.mistral/skills',
    isUniversal: false,
    detectInstalled: 'which mistral-vibe',
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
    globalSkillsDir: '~/.pi/skills',
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
    globalSkillsDir: '~/.windsurf/skills',
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
];

/** Total number of registered agents */
export const TOTAL_AGENTS = AGENTS_REGISTRY.length;

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
 * Gets a single agent by ID.
 *
 * @param id - Agent identifier
 * @returns The agent definition, or undefined if not found
 */
export function getAgent(id: string): AgentDefinition | undefined {
  return AGENTS_REGISTRY.find((a) => a.id === id);
}

/**
 * Detects which agents are installed on the current system
 * by running each agent's detectInstalled command.
 *
 * @returns Array of installed agent definitions
 */
export async function detectInstalledAgents(): Promise<AgentDefinition[]> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  const results: AgentDefinition[] = [];

  await Promise.allSettled(
    AGENTS_REGISTRY.map(async (agent) => {
      try {
        await execAsync(agent.detectInstalled);
        results.push(agent);
      } catch {
        // Not installed — skip
      }
    }),
  );

  return results.sort((a, b) => a.id.localeCompare(b.id));
}
