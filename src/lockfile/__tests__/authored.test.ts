import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addAuthoredSkill, removeAuthoredSkill, readAuthored } from "../authored.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "vskill-authored-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("authored.ts", () => {
  it("creates vskill.authored.json on first add with correct shape", () => {
    addAuthoredSkill(tmpDir, "owner/repo/skill", "skills/skill/SKILL.md");
    const filePath = join(tmpDir, "vskill.authored.json");
    expect(existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    expect(parsed.version).toBe(1);
    expect(parsed.skills["owner/repo/skill"].sourcePath).toBe("skills/skill/SKILL.md");
    expect(parsed.skills["owner/repo/skill"].publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("upserts on second add — no duplicate entries, refreshes publishedAt", async () => {
    addAuthoredSkill(tmpDir, "a/b/c", "old/path", "2026-01-01T00:00:00.000Z");
    // Tiny delay so the new timestamp differs
    await new Promise((r) => setTimeout(r, 5));
    addAuthoredSkill(tmpDir, "a/b/c", "new/path");
    const list = readAuthored(tmpDir);
    expect(list).toHaveLength(1);
    expect(list[0].sourcePath).toBe("new/path");
    expect(list[0].publishedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("removes a single entry preserving the rest", () => {
    addAuthoredSkill(tmpDir, "a/b/c", "p1");
    addAuthoredSkill(tmpDir, "x/y/z", "p2");
    removeAuthoredSkill(tmpDir, "a/b/c");
    const list = readAuthored(tmpDir);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("x/y/z");
  });

  it("removeAuthoredSkill on missing name is a no-op", () => {
    addAuthoredSkill(tmpDir, "a/b/c", "p1");
    removeAuthoredSkill(tmpDir, "does/not/exist");
    expect(readAuthored(tmpDir)).toHaveLength(1);
  });

  it("readAuthored returns [] for missing file", () => {
    expect(readAuthored(tmpDir)).toEqual([]);
  });

  it("readAuthored survives malformed file (graceful)", () => {
    writeFileSync(join(tmpDir, "vskill.authored.json"), "not json{");
    expect(readAuthored(tmpDir)).toEqual([]);
  });

  it("readAuthored tolerates missing version field", () => {
    writeFileSync(
      join(tmpDir, "vskill.authored.json"),
      JSON.stringify({ skills: { "a/b/c": { sourcePath: "p", publishedAt: "2026-01-01T00:00:00.000Z" } } }),
    );
    const list = readAuthored(tmpDir);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("a/b/c");
  });
});
