// ---------------------------------------------------------------------------
// 0809: copied-skill source-link sidecar reader.
//
// Studio's scope-transfer (Copy) flow persists the source skill's
// {repoUrl, skillPath} into a `.vskill-source.json` sidecar in the
// destination. readCopiedSkillSidecar surfaces it back into resolveSourceLink
// without bloating SKILL.md or touching the lockfile.
//
// Validation is strict: any deviation from the expected shape returns
// {null, null} so the resolver falls through to the authored detector
// instead of producing a confidently-wrong header anchor.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCopiedSkillSidecar,
  resetCopiedSkillSidecarCache,
} from "../source-link.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "0809-copied-source-link-"));
  resetCopiedSkillSidecarCache();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  resetCopiedSkillSidecarCache();
});

function makeSkillDir(name: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: x\n---\nbody\n", "utf-8");
  return dir;
}

function writeSidecar(skillDir: string, payload: unknown): void {
  writeFileSync(
    join(skillDir, ".vskill-source.json"),
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
    "utf-8",
  );
}

describe("0809 readCopiedSkillSidecar", () => {
  it("TC-002: returns {null, null} when sidecar file is absent", () => {
    const skillDir = makeSkillDir("a");
    expect(readCopiedSkillSidecar(skillDir)).toEqual({ repoUrl: null, skillPath: null });
  });

  it("TC-003: returns {null, null} on malformed JSON", () => {
    const skillDir = makeSkillDir("b");
    writeSidecar(skillDir, "not json{");
    expect(readCopiedSkillSidecar(skillDir)).toEqual({ repoUrl: null, skillPath: null });
  });

  it("TC-004: returns {null, null} when repoUrl field is missing", () => {
    const skillDir = makeSkillDir("c");
    writeSidecar(skillDir, { skillPath: "SKILL.md" });
    expect(readCopiedSkillSidecar(skillDir)).toEqual({ repoUrl: null, skillPath: null });
  });

  it("TC-005: returns {null, null} when repoUrl is non-https (http://)", () => {
    const skillDir = makeSkillDir("d");
    writeSidecar(skillDir, { repoUrl: "http://github.com/x/y", skillPath: "SKILL.md" });
    expect(readCopiedSkillSidecar(skillDir)).toEqual({ repoUrl: null, skillPath: null });
  });

  it("TC-006: returns {null, null} when repoUrl host is non-github", () => {
    const skillDir = makeSkillDir("e");
    writeSidecar(skillDir, { repoUrl: "https://gitlab.com/x/y", skillPath: "SKILL.md" });
    expect(readCopiedSkillSidecar(skillDir)).toEqual({ repoUrl: null, skillPath: null });
  });

  it("TC-007a: returns valid payload verbatim", () => {
    const skillDir = makeSkillDir("f");
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/anton-abyzov/greet-anton-test",
      skillPath: "SKILL.md",
    });
    expect(readCopiedSkillSidecar(skillDir)).toEqual({
      repoUrl: "https://github.com/anton-abyzov/greet-anton-test",
      skillPath: "SKILL.md",
    });
  });

  it("TC-007b: skillPath null is preserved (multi-skill repo case)", () => {
    const skillDir = makeSkillDir("g");
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/anton-abyzov/marketingskills",
      skillPath: null,
    });
    expect(readCopiedSkillSidecar(skillDir)).toEqual({
      repoUrl: "https://github.com/anton-abyzov/marketingskills",
      skillPath: null,
    });
  });

  it("TC-007c: skillPath nested path is preserved verbatim", () => {
    const skillDir = makeSkillDir("h");
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/coreyhaines31/marketingskills",
      skillPath: "skills/customer-research/SKILL.md",
    });
    expect(readCopiedSkillSidecar(skillDir)).toEqual({
      repoUrl: "https://github.com/coreyhaines31/marketingskills",
      skillPath: "skills/customer-research/SKILL.md",
    });
  });

  it("TC-007d: rejects repoUrl with trailing path segments", () => {
    const skillDir = makeSkillDir("i");
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/x/y/tree/main",
      skillPath: "SKILL.md",
    });
    expect(readCopiedSkillSidecar(skillDir)).toEqual({ repoUrl: null, skillPath: null });
  });

  it("TC-007e: rejects repoUrl with .git suffix", () => {
    const skillDir = makeSkillDir("j");
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/x/y.git",
      skillPath: "SKILL.md",
    });
    expect(readCopiedSkillSidecar(skillDir)).toEqual({ repoUrl: null, skillPath: null });
  });

  it("TC-008: memoizes per skillDir — second read returns cached value when on-disk content changes", () => {
    const skillDir = makeSkillDir("k");
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/x/y",
      skillPath: "SKILL.md",
    });
    const first = readCopiedSkillSidecar(skillDir);
    expect(first.repoUrl).toBe("https://github.com/x/y");

    // mutate disk; without cache invalidation, the read must still return the
    // memoized result (proves memoization is in effect).
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/zzz/changed",
      skillPath: "SKILL.md",
    });
    const second = readCopiedSkillSidecar(skillDir);
    expect(second.repoUrl).toBe("https://github.com/x/y");
  });

  it("TC-009: resetCopiedSkillSidecarCache forces a re-read from disk", () => {
    const skillDir = makeSkillDir("l");
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/x/y",
      skillPath: "SKILL.md",
    });
    expect(readCopiedSkillSidecar(skillDir).repoUrl).toBe("https://github.com/x/y");

    writeSidecar(skillDir, {
      repoUrl: "https://github.com/zzz/changed",
      skillPath: "SKILL.md",
    });
    resetCopiedSkillSidecarCache();
    expect(readCopiedSkillSidecar(skillDir).repoUrl).toBe("https://github.com/zzz/changed");
  });

  it("memoizes the empty result too — second read with no sidecar does not stat the file again", () => {
    const skillDir = makeSkillDir("m");
    expect(readCopiedSkillSidecar(skillDir)).toEqual({ repoUrl: null, skillPath: null });

    // adding a sidecar AFTER the memo set null should still return null until
    // the cache is reset.
    writeSidecar(skillDir, {
      repoUrl: "https://github.com/x/y",
      skillPath: "SKILL.md",
    });
    expect(readCopiedSkillSidecar(skillDir)).toEqual({ repoUrl: null, skillPath: null });

    resetCopiedSkillSidecarCache();
    expect(readCopiedSkillSidecar(skillDir).repoUrl).toBe("https://github.com/x/y");
  });
});
