// ---------------------------------------------------------------------------
// 0740 T-009 (TDD RED) — readDiskVersion + reconcileLockfileVersion
// ---------------------------------------------------------------------------
// `vskill outdated --json` reports a stale `installed` version because it
// reads from `vskill.lock` instead of the on-disk SKILL.md frontmatter. This
// helper bridges the gap: given a lockfile entry's resolved install path, it
// returns the on-disk `metadata.version` (or top-level `version:`).
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDiskVersion, reconcileLockfileVersion } from "../disk-version.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-0740-disk-version-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeSkillMd(relDir: string, content: string): string {
  const dir = join(tmpRoot, relDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, content);
  return path;
}

describe("0740 readDiskVersion", () => {
  it("reads top-level `version:` from frontmatter", () => {
    const path = writeSkillMd("a", `---\nname: a\nversion: 1.2.3\n---\n# A\n`);
    expect(readDiskVersion(path)).toBe("1.2.3");
  });

  it("reads `metadata.version:` from frontmatter when no top-level version", () => {
    const path = writeSkillMd("b", `---\nname: b\nmetadata:\n  version: 2.5.7\n---\n# B\n`);
    expect(readDiskVersion(path)).toBe("2.5.7");
  });

  it("prefers top-level `version:` over `metadata.version:` when both present", () => {
    const path = writeSkillMd("c", `---\nname: c\nversion: 9.9.9\nmetadata:\n  version: 1.0.0\n---\n# C\n`);
    expect(readDiskVersion(path)).toBe("9.9.9");
  });

  it("returns null when frontmatter has no version", () => {
    const path = writeSkillMd("d", `---\nname: d\n---\n# D\n`);
    expect(readDiskVersion(path)).toBe(null);
  });

  it("returns null when no frontmatter block", () => {
    const path = writeSkillMd("e", `# Just a heading, no frontmatter\n`);
    expect(readDiskVersion(path)).toBe(null);
  });

  it("returns null when file does not exist", () => {
    expect(readDiskVersion(join(tmpRoot, "nope/SKILL.md"))).toBe(null);
  });

  it("strips quotes around the version", () => {
    const path = writeSkillMd("f", `---\nversion: "1.4.0"\n---\n`);
    expect(readDiskVersion(path)).toBe("1.4.0");
  });
});

describe("0740 reconcileLockfileVersion", () => {
  it("returns disk version when readable", () => {
    const path = writeSkillMd("a", `---\nmetadata:\n  version: 1.3.0\n---\n`);
    const out = reconcileLockfileVersion({ lockfileVersion: "1.0.0", skillMdPath: path });
    expect(out.version).toBe("1.3.0");
    expect(out.warning).toBeUndefined();
  });

  it("falls back to lockfile version with warning when SKILL.md missing", () => {
    const out = reconcileLockfileVersion({
      lockfileVersion: "1.0.0",
      skillMdPath: join(tmpRoot, "nope/SKILL.md"),
    });
    expect(out.version).toBe("1.0.0");
    expect(out.warning).toContain("disk version unreadable");
  });

  it("falls back to lockfile version with warning when frontmatter has no version", () => {
    const path = writeSkillMd("noversion", `---\nname: noversion\n---\n# No version here\n`);
    const out = reconcileLockfileVersion({ lockfileVersion: "0.5.0", skillMdPath: path });
    expect(out.version).toBe("0.5.0");
    expect(out.warning).toContain("disk version unreadable");
  });

  it("returns disk version even when it equals lockfile (no warning needed)", () => {
    const path = writeSkillMd("eq", `---\nversion: 1.0.0\n---\n`);
    const out = reconcileLockfileVersion({ lockfileVersion: "1.0.0", skillMdPath: path });
    expect(out.version).toBe("1.0.0");
    expect(out.warning).toBeUndefined();
  });
});
