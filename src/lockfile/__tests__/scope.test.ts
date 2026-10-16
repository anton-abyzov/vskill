// ---------------------------------------------------------------------------
// Which vskill.lock update / outdated / list work on (project vs user-level).
// Real files in temp dirs; process.cwd() is stubbed, the real home untouched.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLockfile } from "../lockfile.js";
import { globalLockTargets, mergedSkills, resolveLockTargets } from "../scope.js";

let root: string;
let home: string;
let project: string;

function writeLock(dir: string, names: string[]): void {
  mkdirSync(dir, { recursive: true });
  const skills = Object.fromEntries(
    names.map((n) => [n, { version: "1.0.0", sha: n, tier: "VERIFIED", installedAt: "", source: `github:o/${n}` }]),
  );
  writeFileSync(join(dir, "vskill.lock"), JSON.stringify({ version: 1, agents: [], skills, createdAt: "", updatedAt: "" }));
}

function cwdAt(dir: string): void {
  vi.spyOn(process, "cwd").mockReturnValue(dir);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "vskill-scope-")));
  home = join(root, "home");
  project = join(root, "work", "app");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("resolveLockTargets", () => {
  it("uses the project lock when one is found", () => {
    writeLock(project, ["proj-skill"]);
    writeLock(join(home, ".agents"), ["user-skill"]);
    cwdAt(project);

    const r = resolveLockTargets({ read: readLockfile, home });
    expect(r.scope).toBe("project");
    expect(r.fellBackToGlobal).toBe(false);
    expect(r.targets.map((t) => [t.dir, t.names])).toEqual([[project, ["proj-skill"]]]);
  });

  it("--global reads ~/.agents/vskill.lock even inside a project", () => {
    writeLock(project, ["proj-skill"]);
    writeLock(join(home, ".agents"), ["user-skill"]);
    cwdAt(project);

    const r = resolveLockTargets({ global: true, read: readLockfile, home });
    expect(r.scope).toBe("global");
    expect(r.fellBackToGlobal).toBe(false);
    expect(r.displayPath).toBe(join(home, ".agents", "vskill.lock"));
    expect(r.targets.map((t) => [t.dir, t.names])).toEqual([[join(home, ".agents"), ["user-skill"]]]);
  });

  it("falls back to the global lock outside a project", () => {
    writeLock(join(home, ".agents"), ["user-skill"]);
    cwdAt(project);

    const r = resolveLockTargets({ read: readLockfile, home });
    expect(r.scope).toBe("global");
    expect(r.fellBackToGlobal).toBe(true);
    expect(r.targets[0].names).toEqual(["user-skill"]);
  });

  it("stays in project scope inside a SpecWeave project that has no lock", () => {
    mkdirSync(join(project, ".specweave"), { recursive: true });
    writeFileSync(join(project, ".specweave", "config.json"), "{}");
    writeLock(join(home, ".agents"), ["user-skill"]);
    cwdAt(project);

    const r = resolveLockTargets({ read: readLockfile, home });
    expect(r.scope).toBe("project");
    expect(r.targets).toEqual([]);
  });

  it("treats $HOME as global: ~/vskill.lock is the legacy global lock, not a project", () => {
    writeLock(join(home, ".agents"), ["current"]);
    writeLock(home, ["current", "legacy-only"]);
    cwdAt(home);

    const r = resolveLockTargets({ read: readLockfile, home });
    expect(r.scope).toBe("global");
    expect(r.targets.map((t) => [t.dir, t.legacy ?? false, t.names])).toEqual([
      [join(home, ".agents"), false, ["current"]],
      [home, true, ["legacy-only"]],
    ]);
  });

  it("treats ~/.agents itself as global", () => {
    writeLock(join(home, ".agents"), ["user-skill"]);
    cwdAt(join(home, ".agents"));

    const r = resolveLockTargets({ read: readLockfile, home });
    expect(r.scope).toBe("global");
    expect(r.targets).toHaveLength(1);
  });

  it("returns no targets when no global lock exists", () => {
    cwdAt(project);
    const r = resolveLockTargets({ global: true, read: readLockfile, home });
    expect(r.targets).toEqual([]);
  });
});

describe("globalLockTargets / mergedSkills", () => {
  it("uses the legacy ~/vskill.lock alone when ~/.agents has none", () => {
    writeLock(home, ["old"]);
    const targets = globalLockTargets(readLockfile, home);
    expect(targets.map((t) => [t.dir, t.legacy])).toEqual([[home, true]]);
  });

  it("merges entries with the current lock winning", () => {
    writeLock(join(home, ".agents"), ["a"]);
    writeLock(home, ["a", "b"]);
    const targets = globalLockTargets(readLockfile, home);
    const merged = mergedSkills(targets);
    expect(Object.keys(merged).sort()).toEqual(["a", "b"]);
    expect(merged.a).toBe(targets[0].lock.skills.a);
  });
});
