// ---------------------------------------------------------------------------
// skill-spec-validator.test.ts — 0679 T-004 / T-005
//
// Exercises the post-creation `skills-ref validate` helper that wraps the
// external binary. The helper itself is a pure function over
// `spawnSync`-style inputs, so tests cover all four scenarios from
// AC-US3-01..AC-US3-04 + AC-US3-03 (strict mode).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  interpretValidatorResult,
  formatValidatorReport,
  type SpawnResultLike,
} from "../skill-create-routes.js";

const skillPath = "/tmp/fake/SKILL.md";

describe("interpretValidatorResult — post-creation `skills-ref validate` wrapper", () => {
  it("returns ok=true and no warnings when validator exits 0 (AC-US3-01 happy path)", () => {
    const res: SpawnResultLike = { status: 0, stdout: "", stderr: "", error: undefined };
    const out = interpretValidatorResult(skillPath, res, { strict: false });
    expect(out.ok).toBe(true);
    expect(out.exitCode).toBe(0);
    expect(out.kind).toBe("success");
  });

  it("returns ok=true (warn-only) when validator exits non-zero without --strict (AC-US3-02)", () => {
    const res: SpawnResultLike = {
      status: 1,
      stdout: "",
      stderr: "tags at root level",
      error: undefined,
    };
    const out = interpretValidatorResult(skillPath, res, { strict: false });
    expect(out.ok).toBe(true);
    expect(out.exitCode).toBe(0);
    expect(out.kind).toBe("warning");
    expect(out.messages).toEqual(["tags at root level"]);
  });

  it("returns ok=false (blocking) when validator exits non-zero with --strict (AC-US3-03)", () => {
    const res: SpawnResultLike = {
      status: 1,
      stdout: "",
      stderr: "tags at root level",
      error: undefined,
    };
    const out = interpretValidatorResult(skillPath, res, { strict: true });
    expect(out.ok).toBe(false);
    expect(out.exitCode).toBe(1);
    expect(out.kind).toBe("error");
    expect(out.messages).toEqual(["tags at root level"]);
  });

  it("returns ok=true and a single install hint when binary is missing (AC-US3-04)", () => {
    // ENOENT is how node's spawnSync reports missing binaries.
    const enoent = Object.assign(new Error("spawn skills-ref ENOENT"), { code: "ENOENT" }) as NodeJS.ErrnoException;
    const res: SpawnResultLike = { status: null, stdout: "", stderr: "", error: enoent };
    const out = interpretValidatorResult(skillPath, res, { strict: false });
    expect(out.ok).toBe(true);
    expect(out.exitCode).toBe(0);
    expect(out.kind).toBe("missing-binary");
    expect(out.messages).toEqual([
      "Install `skills-ref` to enable spec validation: `npm i -g skills-ref`",
    ]);
  });

  it("returns ok=true when binary is missing even in strict mode (graceful degradation)", () => {
    // Design choice: missing binary is always non-blocking. CI enforces via lint:skills-spec.
    const enoent = Object.assign(new Error("spawn skills-ref ENOENT"), { code: "ENOENT" }) as NodeJS.ErrnoException;
    const res: SpawnResultLike = { status: null, stdout: "", stderr: "", error: enoent };
    const out = interpretValidatorResult(skillPath, res, { strict: true });
    expect(out.ok).toBe(true);
    expect(out.kind).toBe("missing-binary");
  });

  it("falls back to stdout when stderr is empty on non-zero exit", () => {
    const res: SpawnResultLike = {
      status: 1,
      stdout: "validation failed: missing field",
      stderr: "",
      error: undefined,
    };
    const out = interpretValidatorResult(skillPath, res, { strict: false });
    expect(out.kind).toBe("warning");
    expect(out.messages).toEqual(["validation failed: missing field"]);
  });

  it("reports a generic failure message when both streams are empty", () => {
    const res: SpawnResultLike = { status: 2, stdout: "", stderr: "", error: undefined };
    const out = interpretValidatorResult(skillPath, res, { strict: false });
    expect(out.kind).toBe("warning");
    expect(out.messages).toEqual(["skills-ref exited with code 2"]);
  });

  it("strips blank lines from multi-line validator output", () => {
    const res: SpawnResultLike = {
      status: 1,
      stdout: "",
      stderr: "line1\n\nline2\n  \nline3\n",
      error: undefined,
    };
    const out = interpretValidatorResult(skillPath, res, { strict: false });
    expect(out.messages).toEqual(["line1", "line2", "line3"]);
  });
});

describe("formatValidatorReport — human-readable output for the CLI", () => {
  it("produces no output on success", () => {
    const report = formatValidatorReport({
      ok: true,
      exitCode: 0,
      kind: "success",
      messages: [],
      skillPath,
    });
    expect(report).toBe("");
  });

  it("prints a yellow 'Validation warnings' block for non-strict failures", () => {
    const report = formatValidatorReport({
      ok: true,
      exitCode: 0,
      kind: "warning",
      messages: ["tags at root level", "target-agents at root level"],
      skillPath,
    });
    expect(report).toContain("Validation warnings");
    expect(report).toContain("tags at root level");
    expect(report).toContain("target-agents at root level");
    expect(report).toContain(skillPath);
  });

  it("prints a red 'Validation failed' block for strict failures", () => {
    const report = formatValidatorReport({
      ok: false,
      exitCode: 1,
      kind: "error",
      messages: ["tags at root level"],
      skillPath,
    });
    expect(report).toContain("Validation failed");
    expect(report).toContain("tags at root level");
  });

  it("prints a one-line install hint for missing binary", () => {
    const report = formatValidatorReport({
      ok: true,
      exitCode: 0,
      kind: "missing-binary",
      messages: ["Install `skills-ref` to enable spec validation: `npm i -g skills-ref`"],
      skillPath,
    });
    expect(report.trim().split("\n")).toHaveLength(1);
    expect(report).toContain("Install `skills-ref`");
    expect(report).toContain("npm i -g skills-ref");
  });
});
