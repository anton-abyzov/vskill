// ---------------------------------------------------------------------------
// Unit tests for src/clone/target-router.ts (T-011 supplemental, AC-US1-03,
// AC-US2-01..03, AC-US3-01).
//
// All three writers stage at <final>.tmp. Tests verify:
//   - writeStandalone copies files + filters vskill sidecars at root only
//   - writeToPlugin pre-flight detects malformed plugin.json BEFORE staging
//   - writeToPlugin appends new skill to manifest's skills[] without dropping prior entries
//   - writeNewPlugin scaffolds a fresh plugin.json + skills/<name>/ tree
//   - tmpSibling and bareSkillName helpers behave correctly
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  writeStandalone,
  writeToPlugin,
  writeNewPlugin,
  tmpSibling,
  bareSkillName,
} from "../target-router.js";

let tmpRoot: string;
let sourceSkill: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-target-router-"));
  sourceSkill = join(tmpRoot, "source");
  mkdirSync(sourceSkill, { recursive: true });
  // Standard fixture: SKILL.md + agents/ subdir + a vskill sidecar that
  // MUST NOT propagate into the staged copy.
  writeFileSync(
    join(sourceSkill, "SKILL.md"),
    "---\nname: sw/foo\ndescription: foo\nversion: 1.0.0\n---\nbody",
  );
  mkdirSync(join(sourceSkill, "agents"), { recursive: true });
  writeFileSync(join(sourceSkill, "agents", "sub.md"), "agent prose");
  writeFileSync(
    join(sourceSkill, ".vskill-meta.json"),
    JSON.stringify({ promotedFrom: "global", sourcePath: "x", promotedAt: 0 }),
  );
  writeFileSync(join(sourceSkill, ".vskill-source.json"), JSON.stringify({ origin: "x" }));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("tmpSibling", () => {
  it("appends .tmp to the final path", () => {
    expect(tmpSibling("/abs/path/to/final")).toBe("/abs/path/to/final.tmp");
  });
});

describe("bareSkillName", () => {
  it("returns the segment after the slash for namespaced names", () => {
    expect(bareSkillName("anton/ado-mapper")).toBe("ado-mapper");
  });

  it("returns the input unchanged for non-namespaced names", () => {
    expect(bareSkillName("ado-mapper")).toBe("ado-mapper");
  });
});

// ---------------------------------------------------------------------------

describe("writeStandalone", () => {
  it("stages the skill at <finalDir>.tmp without touching <finalDir>", async () => {
    const finalDir = join(tmpRoot, "out", "ado-mapper");
    const result = await writeStandalone({
      sourceSkillDir: sourceSkill,
      finalDir,
    });

    expect(result.stagingDir).toBe(`${finalDir}.tmp`);
    expect(existsSync(result.stagingDir)).toBe(true);
    expect(existsSync(finalDir)).toBe(false);
  });

  it("copies SKILL.md and nested agents/ files", async () => {
    const finalDir = join(tmpRoot, "out", "skill");
    const result = await writeStandalone({ sourceSkillDir: sourceSkill, finalDir });

    expect(existsSync(join(result.stagingDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(result.stagingDir, "agents", "sub.md"))).toBe(true);
    expect(result.filesCopied).toBeGreaterThanOrEqual(2);
  });

  it("filters .vskill-meta.json and .vskill-source.json at the root", async () => {
    const finalDir = join(tmpRoot, "out", "skill");
    const result = await writeStandalone({ sourceSkillDir: sourceSkill, finalDir });

    expect(existsSync(join(result.stagingDir, ".vskill-meta.json"))).toBe(false);
    expect(existsSync(join(result.stagingDir, ".vskill-source.json"))).toBe(false);
  });

  it("clears any leftover .tmp from a prior failed run", async () => {
    const finalDir = join(tmpRoot, "out", "skill-leftover");
    const stagingDir = `${finalDir}.tmp`;
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, "stale-file"), "stale");

    const result = await writeStandalone({ sourceSkillDir: sourceSkill, finalDir });

    expect(existsSync(join(result.stagingDir, "stale-file"))).toBe(false);
    expect(existsSync(join(result.stagingDir, "SKILL.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("writeToPlugin", () => {
  function buildPlugin(opts: { manifest: string }): string {
    const pluginRoot = join(tmpRoot, "plugin");
    mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), opts.manifest);
    return pluginRoot;
  }

  it("rejects when the manifest is missing entirely", async () => {
    const pluginRoot = join(tmpRoot, "no-manifest-plugin");
    mkdirSync(pluginRoot, { recursive: true });

    await expect(
      writeToPlugin({
        sourceSkillDir: sourceSkill,
        pluginRoot,
        newSkillName: "foo",
      }),
    ).rejects.toThrow(/plugin manifest not found/);
  });

  it("rejects on malformed plugin.json BEFORE staging any files (AC-US2-03)", async () => {
    const pluginRoot = buildPlugin({ manifest: "{ this is not json" });

    await expect(
      writeToPlugin({
        sourceSkillDir: sourceSkill,
        pluginRoot,
        newSkillName: "foo",
      }),
    ).rejects.toThrow(/malformed JSON/);

    // The skills/ subtree should not have been touched.
    expect(existsSync(join(pluginRoot, "skills"))).toBe(false);
  });

  it("stages skill files at <plugin>/skills/<name>.tmp and manifest at .tmp sibling", async () => {
    const pluginRoot = buildPlugin({
      manifest: JSON.stringify({ name: "my-plugin", description: "x", skills: ["existing"] }),
    });

    const result = await writeToPlugin({
      sourceSkillDir: sourceSkill,
      pluginRoot,
      newSkillName: "anton-foo",
    });

    expect(result.stagingDir).toBe(join(pluginRoot, "skills", "anton-foo.tmp"));
    expect(result.manifestTmpPath).toBe(
      join(pluginRoot, ".claude-plugin", "plugin.json.tmp"),
    );
    expect(existsSync(join(result.stagingDir, "SKILL.md"))).toBe(true);

    // Manifest is staged but original is unchanged at this point.
    const tmpManifest = JSON.parse(readFileSync(result.manifestTmpPath, "utf-8"));
    expect(tmpManifest.skills).toEqual(["existing", "anton-foo"]);

    const liveManifest = JSON.parse(
      readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf-8"),
    );
    expect(liveManifest.skills).toEqual(["existing"]);
  });

  it("creates skills[] when the original manifest does not have one", async () => {
    const pluginRoot = buildPlugin({
      manifest: JSON.stringify({ name: "my-plugin", description: "x" }),
    });

    const result = await writeToPlugin({
      sourceSkillDir: sourceSkill,
      pluginRoot,
      newSkillName: "anton-foo",
    });

    const tmpManifest = JSON.parse(readFileSync(result.manifestTmpPath, "utf-8"));
    expect(tmpManifest.skills).toEqual(["anton-foo"]);
  });

  it("does not duplicate the skill name when it already exists in skills[]", async () => {
    const pluginRoot = buildPlugin({
      manifest: JSON.stringify({ name: "my-plugin", skills: ["anton-foo", "other"] }),
    });

    const result = await writeToPlugin({
      sourceSkillDir: sourceSkill,
      pluginRoot,
      newSkillName: "anton-foo",
    });

    const tmpManifest = JSON.parse(readFileSync(result.manifestTmpPath, "utf-8"));
    expect(tmpManifest.skills).toEqual(["anton-foo", "other"]);
  });

  it("preserves unknown manifest fields (description, author, version, etc.)", async () => {
    const pluginRoot = buildPlugin({
      manifest: JSON.stringify({
        name: "my-plugin",
        description: "Original description",
        version: "2.0.0",
        author: { name: "Jane" },
      }),
    });

    const result = await writeToPlugin({
      sourceSkillDir: sourceSkill,
      pluginRoot,
      newSkillName: "anton-foo",
    });

    const tmpManifest = JSON.parse(readFileSync(result.manifestTmpPath, "utf-8"));
    expect(tmpManifest.description).toBe("Original description");
    expect(tmpManifest.version).toBe("2.0.0");
    expect(tmpManifest.author).toEqual({ name: "Jane" });
  });
});

// ---------------------------------------------------------------------------

describe("writeNewPlugin", () => {
  it("scaffolds a fresh plugin tree at <pluginRoot>.tmp with manifest + skills/<name>/", async () => {
    const pluginRoot = join(tmpRoot, "new-plugin");

    const result = await writeNewPlugin({
      sourceSkillDir: sourceSkill,
      pluginRoot,
      pluginName: "anton-skills",
      newSkillName: "ado-mapper",
    });

    expect(result.stagingDir).toBe(`${pluginRoot}.tmp`);
    expect(existsSync(join(result.stagingDir, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(result.stagingDir, "skills", "ado-mapper", "SKILL.md"))).toBe(true);

    // Final directory is NOT yet created (atomic rename happens in orchestrator).
    expect(existsSync(pluginRoot)).toBe(false);
  });

  it("writes the requested plugin name into manifest", async () => {
    const pluginRoot = join(tmpRoot, "new-plugin-2");
    const result = await writeNewPlugin({
      sourceSkillDir: sourceSkill,
      pluginRoot,
      pluginName: "my-cool-plugin",
      newSkillName: "x",
    });

    const manifest = JSON.parse(
      readFileSync(join(result.stagingDir, ".claude-plugin", "plugin.json"), "utf-8"),
    );
    expect(manifest.name).toBe("my-cool-plugin");
    expect(manifest.skills).toEqual(["x"]);
  });

  it("includes author in manifest when supplied", async () => {
    const pluginRoot = join(tmpRoot, "new-plugin-3");
    const result = await writeNewPlugin({
      sourceSkillDir: sourceSkill,
      pluginRoot,
      pluginName: "p",
      newSkillName: "x",
      author: "Anton",
    });

    const manifest = JSON.parse(
      readFileSync(join(result.stagingDir, ".claude-plugin", "plugin.json"), "utf-8"),
    );
    expect(manifest.author).toEqual({ name: "Anton" });
  });

  it("clears any leftover .tmp from a prior failed run", async () => {
    const pluginRoot = join(tmpRoot, "new-plugin-leftover");
    const stagingDir = `${pluginRoot}.tmp`;
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, "stale"), "x");

    const result = await writeNewPlugin({
      sourceSkillDir: sourceSkill,
      pluginRoot,
      pluginName: "p",
      newSkillName: "x",
    });

    expect(existsSync(join(result.stagingDir, "stale"))).toBe(false);
  });
});
