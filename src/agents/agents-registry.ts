/**
 * 39-Agent Registry for vskill CLI
 *
 * Complete registry of all AI coding agents that support the Agent Skills format.
 * Source: skills@1.3.9 npm package (vercel-labs/skills)
 *
 * @see research/agent-registry-data-model.md for full design documentation
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Unique identifier for each of the 39 supported agents */
export type AgentId =
  | 'amp' | 'antigravity' | 'augment' | 'claude-code' | 'openclaw'
  | 'cline' | 'codebuddy' | 'codex' | 'command-code' | 'continue'
  | 'crush' | 'cursor' | 'droid' | 'gemini-cli' | 'github-copilot'
  | 'goose' | 'junie' | 'iflow-cli' | 'kilo' | 'kimi-cli'
  | 'kiro-cli' | 'kode' | 'mcpjam' | 'mistral-vibe' | 'mux'
  | 'opencode' | 'openhands' | 'pi' | 'qoder' | 'qwen-code'
  | 'replit' | 'roo' | 'trae' | 'trae-cn' | 'windsurf'
  | 'zencoder' | 'neovate' | 'pochi' | 'adal';

/** Feature support matrix for SKILL.md capabilities */
export interface FeatureSupport {
  /** Basic SKILL.md parsing (always true) */
  basicSkills: boolean;
  /** Support for allowed-tools frontmatter */
  allowedTools: boolean;
  /** Support for context: fork (Claude Code only) */
  contextFork: boolean;
  /** Support for pre/post execution hooks */
  hooks: boolean;
}

/** Complete agent definition */
export interface AgentDefinition {
  /** Unique agent identifier */
  id: AgentId;
  /** Human-readable display name */
  displayName: string;
  /** Project-level skills directory relative to cwd */
  localSkillsDir: string;
  /** Global skills directory (absolute path pattern) */
  globalSkillsDir: string;
  /** Whether this agent uses .agents/skills */
  isUniversal: boolean;
  /** Whether shown in universal agents list */
  showInUniversalList: boolean;
  /** Detection logic — returns true if agent is installed */
  detectInstalled: () => Promise<boolean>;
  /** Environment variables that affect path resolution */
  envVars?: string[];
  /** Parent company or organization */
  parentCompany?: string;
  /** Feature support matrix */
  featureSupport: FeatureSupport;
  /** Special notes about this agent */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const home = homedir();
const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, '.config');
const claudeConfig = process.env.CLAUDE_CONFIG_DIR || join(home, '.claude');
const codexHome = process.env.CODEX_HOME || join(home, '.codex');

function exists(...segments: string[]): boolean {
  return existsSync(join(...segments));
}

const DEFAULT_FEATURES: FeatureSupport = {
  basicSkills: true,
  allowedTools: true,
  contextFork: false,
  hooks: false,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const AGENTS_REGISTRY: readonly AgentDefinition[] = [
  // ═══ Universal Agents (7) ═══

  {
    id: 'amp',
    displayName: 'Amp',
    localSkillsDir: '.agents/skills',
    globalSkillsDir: join(xdgConfig, 'agents/skills'),
    isUniversal: true,
    showInUniversalList: true,
    detectInstalled: async () => exists(xdgConfig, 'amp'),
    envVars: ['XDG_CONFIG_HOME'],
    parentCompany: 'Amp (Sourcegraph)',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'codex',
    displayName: 'Codex',
    localSkillsDir: '.agents/skills',
    globalSkillsDir: join(codexHome, 'skills'),
    isUniversal: true,
    showInUniversalList: true,
    detectInstalled: async () => exists(codexHome) || exists('/etc/codex'),
    envVars: ['CODEX_HOME'],
    parentCompany: 'OpenAI',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    localSkillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.gemini/skills'),
    isUniversal: true,
    showInUniversalList: true,
    detectInstalled: async () => exists(home, '.gemini'),
    parentCompany: 'Google',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    localSkillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.copilot/skills'),
    isUniversal: true,
    showInUniversalList: true,
    detectInstalled: async () => exists(process.cwd(), '.github') || exists(home, '.copilot'),
    parentCompany: 'Microsoft',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'Detection checks .github dir (common false positive)',
  },
  {
    id: 'kimi-cli',
    displayName: 'Kimi Code CLI',
    localSkillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.config/agents/skills'),
    isUniversal: true,
    showInUniversalList: true,
    detectInstalled: async () => exists(home, '.kimi'),
    parentCompany: 'Moonshot AI',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    localSkillsDir: '.agents/skills',
    globalSkillsDir: join(xdgConfig, 'opencode/skills'),
    isUniversal: true,
    showInUniversalList: true,
    detectInstalled: async () => exists(xdgConfig, 'opencode') || exists(home, '.claude/skills'),
    envVars: ['XDG_CONFIG_HOME'],
    parentCompany: 'sst (open source)',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'Cross-detects Claude Code skills directory as fallback',
  },
  {
    id: 'replit',
    displayName: 'Replit',
    localSkillsDir: '.agents/skills',
    globalSkillsDir: join(xdgConfig, 'agents/skills'),
    isUniversal: true,
    showInUniversalList: false,
    detectInstalled: async () => exists(process.cwd(), '.agents'),
    envVars: ['XDG_CONFIG_HOME'],
    parentCompany: 'Replit',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'Hidden universal agent (showInUniversalList: false)',
  },

  // ═══ Non-Universal Agents (32) ═══

  {
    id: 'antigravity',
    displayName: 'Antigravity',
    localSkillsDir: '.agent/skills',
    globalSkillsDir: join(home, '.gemini/antigravity/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(process.cwd(), '.agent') || exists(home, '.gemini/antigravity'),
    parentCompany: 'Google',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'Singular .agent/skills (not .agents/skills)',
  },
  {
    id: 'augment',
    displayName: 'Augment',
    localSkillsDir: '.augment/skills',
    globalSkillsDir: join(home, '.augment/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.augment'),
    parentCompany: 'Augment',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    localSkillsDir: '.claude/skills',
    globalSkillsDir: join(claudeConfig, 'skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(claudeConfig),
    envVars: ['CLAUDE_CONFIG_DIR'],
    parentCompany: 'Anthropic',
    featureSupport: { basicSkills: true, allowedTools: true, contextFork: true, hooks: true },
    notes: 'Most feature-rich agent. Only one supporting context: fork.',
  },
  {
    id: 'openclaw',
    displayName: 'OpenClaw',
    localSkillsDir: 'skills',
    globalSkillsDir: join(home, '.openclaw/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.openclaw') || exists(home, '.clawdbot') || exists(home, '.moltbot'),
    parentCompany: 'OpenClaw',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'Bare skills/ dir. 3 legacy global names from rebranding.',
  },
  {
    id: 'cline',
    displayName: 'Cline',
    localSkillsDir: '.cline/skills',
    globalSkillsDir: join(home, '.cline/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.cline'),
    parentCompany: 'Cline (open source)',
    featureSupport: { basicSkills: true, allowedTools: true, contextFork: false, hooks: true },
    notes: 'One of two agents supporting hooks (with Claude Code)',
  },
  {
    id: 'codebuddy',
    displayName: 'CodeBuddy',
    localSkillsDir: '.codebuddy/skills',
    globalSkillsDir: join(home, '.codebuddy/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(process.cwd(), '.codebuddy') || exists(home, '.codebuddy'),
    parentCompany: 'CodeBuddy',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'command-code',
    displayName: 'Command Code',
    localSkillsDir: '.commandcode/skills',
    globalSkillsDir: join(home, '.commandcode/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.commandcode'),
    parentCompany: 'Command Code',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'continue',
    displayName: 'Continue',
    localSkillsDir: '.continue/skills',
    globalSkillsDir: join(home, '.continue/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(process.cwd(), '.continue') || exists(home, '.continue'),
    parentCompany: 'Continue (open source)',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'crush',
    displayName: 'Crush',
    localSkillsDir: '.crush/skills',
    globalSkillsDir: join(home, '.config/crush/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.config/crush'),
    parentCompany: 'Charmbracelet',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    localSkillsDir: '.cursor/skills',
    globalSkillsDir: join(home, '.cursor/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.cursor'),
    parentCompany: 'Anysphere',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'droid',
    displayName: 'Droid',
    localSkillsDir: '.factory/skills',
    globalSkillsDir: join(home, '.factory/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.factory'),
    parentCompany: 'Factory AI',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'Dir is .factory/ not .droid/',
  },
  {
    id: 'goose',
    displayName: 'Goose',
    localSkillsDir: '.goose/skills',
    globalSkillsDir: join(xdgConfig, 'goose/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(xdgConfig, 'goose'),
    envVars: ['XDG_CONFIG_HOME'],
    parentCompany: 'Block',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'junie',
    displayName: 'Junie',
    localSkillsDir: '.junie/skills',
    globalSkillsDir: join(home, '.junie/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.junie'),
    parentCompany: 'JetBrains',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'iflow-cli',
    displayName: 'iFlow CLI',
    localSkillsDir: '.iflow/skills',
    globalSkillsDir: join(home, '.iflow/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.iflow'),
    parentCompany: 'iFlow',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'kilo',
    displayName: 'Kilo Code',
    localSkillsDir: '.kilocode/skills',
    globalSkillsDir: join(home, '.kilocode/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.kilocode'),
    parentCompany: 'Kilo Code',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'kiro-cli',
    displayName: 'Kiro CLI',
    localSkillsDir: '.kiro/skills',
    globalSkillsDir: join(home, '.kiro/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.kiro'),
    parentCompany: 'Amazon (AWS)',
    featureSupport: { basicSkills: true, allowedTools: false, contextFork: false, hooks: false },
    notes: 'Does NOT support allowed-tools. Requires manual registration.',
  },
  {
    id: 'kode',
    displayName: 'Kode',
    localSkillsDir: '.kode/skills',
    globalSkillsDir: join(home, '.kode/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.kode'),
    parentCompany: 'Kode',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'mcpjam',
    displayName: 'MCPJam',
    localSkillsDir: '.mcpjam/skills',
    globalSkillsDir: join(home, '.mcpjam/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.mcpjam'),
    parentCompany: 'MCPJam',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'mistral-vibe',
    displayName: 'Mistral Vibe',
    localSkillsDir: '.vibe/skills',
    globalSkillsDir: join(home, '.vibe/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.vibe'),
    parentCompany: 'Mistral AI',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'Dir is .vibe/ not .mistral-vibe/',
  },
  {
    id: 'mux',
    displayName: 'Mux',
    localSkillsDir: '.mux/skills',
    globalSkillsDir: join(home, '.mux/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.mux'),
    parentCompany: 'Mux',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'openhands',
    displayName: 'OpenHands',
    localSkillsDir: '.openhands/skills',
    globalSkillsDir: join(home, '.openhands/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.openhands'),
    parentCompany: 'All Hands AI (open source)',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'pi',
    displayName: 'Pi',
    localSkillsDir: '.pi/skills',
    globalSkillsDir: join(home, '.pi/agent/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.pi/agent'),
    parentCompany: 'Pi',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'Nested global path: ~/.pi/agent/skills',
  },
  {
    id: 'qoder',
    displayName: 'Qoder',
    localSkillsDir: '.qoder/skills',
    globalSkillsDir: join(home, '.qoder/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.qoder'),
    parentCompany: 'Qoder',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'qwen-code',
    displayName: 'Qwen Code',
    localSkillsDir: '.qwen/skills',
    globalSkillsDir: join(home, '.qwen/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.qwen'),
    parentCompany: 'Alibaba',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'Dir is .qwen/ not .qwen-code/',
  },
  {
    id: 'roo',
    displayName: 'Roo Code',
    localSkillsDir: '.roo/skills',
    globalSkillsDir: join(home, '.roo/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.roo'),
    parentCompany: 'Roo Code',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'trae',
    displayName: 'Trae',
    localSkillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.trae'),
    parentCompany: 'ByteDance',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'Shares localSkillsDir with Trae CN',
  },
  {
    id: 'trae-cn',
    displayName: 'Trae CN',
    localSkillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae-cn/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.trae-cn'),
    parentCompany: 'ByteDance',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'China variant. Shares localSkillsDir with Trae.',
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    localSkillsDir: '.windsurf/skills',
    globalSkillsDir: join(home, '.codeium/windsurf/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.codeium/windsurf'),
    parentCompany: 'Codeium',
    featureSupport: { ...DEFAULT_FEATURES },
    notes: 'Global path under ~/.codeium/windsurf/',
  },
  {
    id: 'zencoder',
    displayName: 'Zencoder',
    localSkillsDir: '.zencoder/skills',
    globalSkillsDir: join(home, '.zencoder/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.zencoder'),
    parentCompany: 'Zencoder',
    featureSupport: { basicSkills: true, allowedTools: false, contextFork: false, hooks: false },
    notes: 'Does NOT support allowed-tools',
  },
  {
    id: 'neovate',
    displayName: 'Neovate',
    localSkillsDir: '.neovate/skills',
    globalSkillsDir: join(home, '.neovate/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.neovate'),
    parentCompany: 'Neovate',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'pochi',
    displayName: 'Pochi',
    localSkillsDir: '.pochi/skills',
    globalSkillsDir: join(home, '.pochi/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.pochi'),
    parentCompany: 'Pochi',
    featureSupport: { ...DEFAULT_FEATURES },
  },
  {
    id: 'adal',
    displayName: 'AdaL',
    localSkillsDir: '.adal/skills',
    globalSkillsDir: join(home, '.adal/skills'),
    isUniversal: false,
    showInUniversalList: false,
    detectInstalled: async () => exists(home, '.adal'),
    parentCompany: 'AdaL',
    featureSupport: { ...DEFAULT_FEATURES },
  },
];

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/** Get all universal agents */
export function getUniversalAgents(): AgentDefinition[] {
  return AGENTS_REGISTRY.filter(a => a.isUniversal);
}

/** Get all non-universal agents */
export function getNonUniversalAgents(): AgentDefinition[] {
  return AGENTS_REGISTRY.filter(a => !a.isUniversal);
}

/** Find an agent by ID */
export function getAgent(id: AgentId): AgentDefinition | undefined {
  return AGENTS_REGISTRY.find(a => a.id === id);
}

/** Detect all installed agents */
export async function detectInstalledAgents(): Promise<AgentDefinition[]> {
  const results = await Promise.all(
    AGENTS_REGISTRY.map(async (agent) => ({
      agent,
      installed: await agent.detectInstalled(),
    }))
  );
  return results.filter(r => r.installed).map(r => r.agent);
}

/** Total agent count */
export const TOTAL_AGENTS = AGENTS_REGISTRY.length; // 39
