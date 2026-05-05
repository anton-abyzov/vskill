// 0827 — Mirror of the server-side InstallStateResponse shape.
//
// This file is the source of truth for the UI; it is intentionally NOT
// imported from the eval-server module so the eval-ui bundle stays free of
// any server-only code paths (Node FS, agents-registry detection, etc.).
//
// Keep these types in lockstep with
//   src/eval-server/install-state-routes.ts → InstallStateResponse
// any drift breaks the SkillDetailPanel scope picker contract.

export interface DetectedAgentTool {
  id: string;
  displayName: string;
  /** Project-relative directory, e.g. ".claude/skills". */
  localDir: string;
  /** Tilde-expandable user-level directory, e.g. "~/.claude/skills". */
  globalDir: string;
}

export interface InstallStateForScope {
  installed: boolean;
  /** Dedup'd agent ids; empty when installed=false. */
  installedAgentTools: string[];
  /** currentVersion from vskill.lock; null if missing/placeholder. */
  version: string | null;
}

export interface InstallStateResponse {
  /** Echoed query param. */
  skill: string;
  detectedAgentTools: DetectedAgentTool[];
  scopes: {
    project: InstallStateForScope;
    user: InstallStateForScope;
  };
}
