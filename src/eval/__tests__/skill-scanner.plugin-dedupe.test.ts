// ---------------------------------------------------------------------------
// 0740 T-005 (TDD RED) — Layout 2 walker must skip manifest-bearing plugin dirs
// ---------------------------------------------------------------------------
// The bug: the legacy `scanSkills` Layout 2 walker (`scanPluginDirs(<root>/
// plugins/...)`) walks every `plugins/<plugin>/skills/<skill>/SKILL.md`. The
// dedicated `scanAuthoredPluginSkills()` walker also walks the same subtree
// when `<plugin>/.claude-plugin/plugin.json` exists. Concatenating both
// without dedupe duplicates the same `dir` in the sidebar, with different
// `scopeV2` ("authoring-project" + "authoring-plugin").
//
// Fix: Layout 2 must early-exit on a plugin dir that has the manifest, since
// `scanAuthoredPluginSkills` owns those.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSkills } from "../skill-scanner.js";

let tmpRoot: string;

function writeSkill(base: string, relDir: string, version = "1.0.0"): string {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${relDir.split("/").pop()}\nmetadata:\n  version: ${version}\n---\n# skill\n`,
  );
  return dir;
}

function writePluginManifest(base: string, pluginName: string): void {
  const dir = join(base, "plugins", pluginName, ".claude-plugin");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify({ name: pluginName, version: "1.0.0" }),
  );
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-0740-dedupe-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("0740 scanSkills Layout 2 — manifest-bearing plugin dirs are skipped", () => {
  it("when plugins/<name>/.claude-plugin/plugin.json exists, Layout 2 skips that subtree", async () => {
    // Set up the bug fixture:
    //   <tmp>/plugins/personal/.claude-plugin/plugin.json
    //   <tmp>/plugins/personal/skills/foo/SKILL.md
    writePluginManifest(tmpRoot, "personal");
    writeSkill(tmpRoot, "plugins/personal/skills/foo", "1.3.0");

    const skills = await scanSkills(tmpRoot);
    const fooEntries = skills.filter((s) => s.skill === "foo");

    // Bug today: scanSkills emits one entry. After fix: scanSkills emits
    // ZERO (the manifest-bearing dir is owned by scanAuthoredPluginSkills,
    // which is invoked separately at the api-routes layer).
    expect(fooEntries.length).toBe(0);
  });

  it("when plugins/<name>/ has NO manifest, Layout 2 still emits the skill (regression)", async () => {
    // Same fixture but WITHOUT the .claude-plugin/plugin.json manifest.
    writeSkill(tmpRoot, "plugins/no-manifest/skills/bar", "1.0.0");

    const skills = await scanSkills(tmpRoot);
    const barEntries = skills.filter((s) => s.skill === "bar");

    // Layout 2 owns this subtree because no plugin manifest exists.
    expect(barEntries.length).toBe(1);
    expect(barEntries[0].plugin).toBe("no-manifest");
    expect(barEntries[0].dir).toContain("plugins/no-manifest/skills/bar");
  });

  it("two plugins side by side (one with manifest, one without) emit only the no-manifest one from Layout 2", async () => {
    writePluginManifest(tmpRoot, "with-manifest");
    writeSkill(tmpRoot, "plugins/with-manifest/skills/alpha", "2.0.0");
    writeSkill(tmpRoot, "plugins/no-manifest/skills/beta", "2.0.0");

    const skills = await scanSkills(tmpRoot);
    const names = skills.map((s) => s.skill).sort();

    expect(names).toContain("beta");
    expect(names).not.toContain("alpha");
  });
});
