// ---------------------------------------------------------------------------
// Studio scope-transfer — server-side shared types
// ---------------------------------------------------------------------------
// Source of truth for StudioOp, Provenance, and TransferEvent. The client
// (src/eval-ui/src/types.ts) mirrors these shapes manually per the existing
// client/server type-sync pattern.
//
// See .specweave/increments/0688-studio-skill-scope-transfer/plan.md §5.
// ---------------------------------------------------------------------------

export type SkillScope = "own" | "installed" | "global";

export type StudioOpName =
  | "promote"
  | "revert"
  | "test-install"
  | "skill-create"
  | "skill-edit"
  | "skill-delete"
  | "model-config-change";

export type StudioOp = {
  id: string;
  ts: number;
  op: StudioOpName;
  skillId?: string;
  fromScope?: SkillScope;
  toScope?: SkillScope;
  paths?: { source: string; dest: string };
  actor: "studio-ui";
  details?: Record<string, unknown>;
};

export type Provenance = {
  promotedFrom: "installed" | "global";
  sourcePath: string;
  promotedAt: number;
  sourceSkillVersion?: string;

  /** Set when this skill was created via `vskill clone`. */
  forkedFrom?: {
    source: string;
    version: string;
    clonedAt: string;
  };

  /** Set when the source itself was a fork — points to the deepest known ancestor. */
  originalSource?: {
    repoUrl?: string;
    skillPath?: string;
  };

  /** Chain of intermediate `forkedFrom.source` values when forking a fork. Oldest-first (`forkChain[0]` is the deepest ancestor; latest intermediate parent is appended at the end). */
  forkChain?: string[];
};

export type TransferEventName =
  | "started"
  | "copied"
  | "deleted"
  | "indexed"
  | "done"
  | "error";

export type TransferEvent =
  | {
      type: "started";
      opId: string;
      skillId: string;
      fromScope: string;
      toScope: string;
      sourcePath: string;
      destPath: string;
    }
  | { type: "copied"; filesWritten: number }
  | { type: "deleted"; filesDeleted: number }
  | { type: "indexed" }
  | { type: "done"; opId: string; destPath: string }
  | { type: "error"; code: string; message: string };
