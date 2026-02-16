// ---------------------------------------------------------------------------
// vskill.lock schema
// ---------------------------------------------------------------------------

export interface SkillLockEntry {
  version: string;
  sha: string;
  tier: string;
  installedAt: string;
  source: string;
}

export interface VskillLock {
  version: 1;
  agents: string[];
  skills: Record<string, SkillLockEntry>;
  createdAt: string;
  updatedAt: string;
}
