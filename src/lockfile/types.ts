// ---------------------------------------------------------------------------
// vskill.lock schema
// ---------------------------------------------------------------------------

export interface SkillLockEntry {
  version: string;
  sha: string;
  tier: string;
  installedAt: string;
  source: string;
  /** Marketplace origin (e.g. "specweave") */
  marketplace?: string;
  /** Whether this entry is a plugin directory (not a single SKILL.md) */
  pluginDir?: boolean;
  /** Installation scope: user-global or project-local */
  scope?: "user" | "project";
  /** Absolute path where the plugin was installed */
  installedPath?: string;
}

export interface VskillLock {
  version: 1;
  agents: string[];
  skills: Record<string, SkillLockEntry>;
  createdAt: string;
  updatedAt: string;
}
