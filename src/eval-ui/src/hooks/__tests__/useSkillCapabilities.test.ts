// ---------------------------------------------------------------------------
// 0800 T-001 [RED]: useSkillCapabilities — split capability flags.
//
// Splits the legacy `isReadOnly` flag (origin === "installed") into two
// orthogonal capabilities:
//   - canEdit: user may mutate eval cases (Add/Edit/Delete) → origin "source"
//   - canRun:  user may execute eval cases → cases exist (any origin)
//
// AC-US2-01 (Run buttons visible for installed skills with cases),
// AC-US2-03 (Add/Edit/Delete hidden for installed).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { useSkillCapabilities } from "../useSkillCapabilities.js";

interface SkillLike {
  origin: "source" | "installed";
}

interface EvalsLike {
  exists: boolean;
  cases: Array<{ id: number }>;
}

describe("useSkillCapabilities", () => {
  it("installed skill with cases → canEdit=false, canRun=true", () => {
    const skill: SkillLike = { origin: "installed" };
    const evals: EvalsLike = {
      exists: true,
      cases: [{ id: 1 }, { id: 2 }, { id: 3 }],
    };
    const result = useSkillCapabilities(skill, evals);
    expect(result.canEdit).toBe(false);
    expect(result.canRun).toBe(true);
  });

  it("source skill with no cases → canEdit=true, canRun=false", () => {
    const skill: SkillLike = { origin: "source" };
    const evals: EvalsLike = { exists: true, cases: [] };
    const result = useSkillCapabilities(skill, evals);
    expect(result.canEdit).toBe(true);
    expect(result.canRun).toBe(false);
  });

  it("source skill with cases → canEdit=true, canRun=true", () => {
    const skill: SkillLike = { origin: "source" };
    const evals: EvalsLike = { exists: true, cases: [{ id: 1 }] };
    const result = useSkillCapabilities(skill, evals);
    expect(result.canEdit).toBe(true);
    expect(result.canRun).toBe(true);
  });

  it("installed skill with no evals.json (exists=false) → canEdit=false, canRun=false", () => {
    const skill: SkillLike = { origin: "installed" };
    const evals: EvalsLike = { exists: false, cases: [] };
    const result = useSkillCapabilities(skill, evals);
    expect(result.canEdit).toBe(false);
    expect(result.canRun).toBe(false);
  });

  it("source skill with evals.exists=false → canEdit=true, canRun=false", () => {
    const skill: SkillLike = { origin: "source" };
    const evals: EvalsLike = { exists: false, cases: [] };
    const result = useSkillCapabilities(skill, evals);
    expect(result.canEdit).toBe(true);
    expect(result.canRun).toBe(false);
  });

  it("treats missing skill as read-only (canEdit=false, canRun=false)", () => {
    const result = useSkillCapabilities(null, { exists: false, cases: [] });
    expect(result.canEdit).toBe(false);
    expect(result.canRun).toBe(false);
  });
});
