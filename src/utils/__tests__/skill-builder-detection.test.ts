// ---------------------------------------------------------------------------
// Tests for isSkillBuilderInstalled() — covers detection branches + version parse.
// Ref: .specweave/increments/0734-studio-create-skill-engine-selector
// ACs: AC-US1-03, AC-US1-04
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const osMock = vi.hoisted(() => ({ home: "" }));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    default: { ...actual, homedir: () => osMock.home },
    homedir: () => osMock.home,
  };
});

const { isSkillBuilderInstalled, findSkillBuilderPath } = await import("../skill-builder-detection.js");

let projectRoot: string;
let fakeHome: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "vskill-sbd-proj-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-sbd-home-"));
  osMock.home = fakeHome;
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
  osMock.home = "";
});

function installAtDir(base: string, relative: string, withSkillMd = true, version = "0.1.0"): string {
  const dir = join(base, relative, "skill-builder");
  mkdirSync(dir, { recursive: true });
  if (withSkillMd) {
    writeFileSync(
      join(dir, "SKILL.md"),
      `---\nname: skill-builder\nversion: "${version}"\n---\n`
    );
  }
  return dir;
}

function installInSource(root: string, version = "0.1.0"): string {
  const dir = join(root, "plugins/skills/skills/skill-builder");
  mkdirSync(dir, { recursive: true });
  const skillMd = join(dir, "SKILL.md");
  writeFileSync(skillMd, `---\nname: skill-builder\nversion: "${version}"\n---\n`);
  return skillMd;
}

describe("AC-US1-03: detection paths", () => {
  it("detects in-source plugins/skills/skills/skill-builder/SKILL.md under projectRoot", () => {
    const skillMd = installInSource(projectRoot);
    const result = isSkillBuilderInstalled(projectRoot);
    expect(result.installed).toBe(true);
    expect(result.path).toBe(skillMd);
  });

  it("detects ~/.agents/skills/skill-builder when only global canonical present", () => {
    const dir = installAtDir(fakeHome, ".agents/skills");
    const result = isSkillBuilderInstalled(projectRoot);
    expect(result.installed).toBe(true);
    expect(result.path).toBe(dir);
  });

  it("detects project-local .agents/skills/skill-builder canonical path", () => {
    const dir = installAtDir(projectRoot, ".agents/skills");
    const result = isSkillBuilderInstalled(projectRoot);
    expect(result.installed).toBe(true);
    expect(result.path).toBe(dir);
  });

  it("detects project-local .claude/skills/skill-builder agent-native install", () => {
    const dir = installAtDir(projectRoot, ".claude/skills");
    const result = isSkillBuilderInstalled(projectRoot);
    expect(result.installed).toBe(true);
    expect(result.path).toBe(dir);
  });

  it("detects project-local .cursor/skills/skill-builder agent-native install", () => {
    const dir = installAtDir(projectRoot, ".cursor/skills");
    const result = isSkillBuilderInstalled(projectRoot);
    expect(result.installed).toBe(true);
    expect(result.path).toBe(dir);
  });

  it("returns installed:false with path:null when no candidate matches", () => {
    const result = isSkillBuilderInstalled(projectRoot);
    expect(result.installed).toBe(false);
    expect(result.path).toBe(null);
    expect(result.version).toBe(null);
  });

  it("returns installed:false when called without projectRoot AND no global match", () => {
    const result = isSkillBuilderInstalled();
    expect(result.installed).toBe(false);
    expect(result.path).toBe(null);
  });
});

describe("AC-US1-04: parses version from SKILL.md frontmatter", () => {
  it("returns the version string when SKILL.md has valid version frontmatter", () => {
    installInSource(projectRoot, "1.2.3");
    const result = isSkillBuilderInstalled(projectRoot);
    expect(result.installed).toBe(true);
    expect(result.version).toBe("1.2.3");
  });

  it("returns null when SKILL.md has no version field", () => {
    const dir = join(projectRoot, "plugins/skills/skills/skill-builder");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: skill-builder\n---\n");
    const result = isSkillBuilderInstalled(projectRoot);
    expect(result.installed).toBe(true);
    expect(result.version).toBe(null);
  });

  it("returns null when SKILL.md has malformed frontmatter (no closing ---)", () => {
    const dir = join(projectRoot, "plugins/skills/skills/skill-builder");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: skill-builder\nversion: 0.1.0\n");
    const result = isSkillBuilderInstalled(projectRoot);
    expect(result.installed).toBe(true);
    expect(result.version).toBe(null);
  });

  it("returns null when matched path has no SKILL.md inside (directory-only install)", () => {
    installAtDir(projectRoot, ".agents/skills", false);
    const result = isSkillBuilderInstalled(projectRoot);
    expect(result.installed).toBe(true);
    expect(result.version).toBe(null);
  });

  it("strips quotes from version string ('0.1.0' and \"0.1.0\" both yield 0.1.0)", () => {
    const dir = join(projectRoot, "plugins/skills/skills/skill-builder");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: skill-builder\nversion: '0.1.0'\n---\n");
    const result = isSkillBuilderInstalled(projectRoot);
    expect(result.version).toBe("0.1.0");
  });
});

// 0786 AC-US2-03 / AC-US2-05: marketplace-only presence does NOT count as
// installed. The marketplace catalog at
// ~/.claude/plugins/marketplaces/<mkt>/plugins/<name> is just the
// available-plugin index — actual installs live under .claude/plugins/cache/.
// Pre-0786 the marketplace branch caused Studio's Engine Selector to label
// uninstalled engines as installed.
describe("0786 — marketplace catalog is NOT installation", () => {
  it("AC-US2-03 (0786): isSkillBuilderInstalled returns false when only present in marketplace catalog", () => {
    const pluginRoot = join(
      fakeHome,
      ".claude/plugins/marketplaces/claude-plugins-official/plugins/skill-builder",
    );
    mkdirSync(pluginRoot, { recursive: true });
    writeFileSync(
      join(pluginRoot, "SKILL.md"),
      `---\nname: skill-builder\nversion: "1.0.0"\n---\n`,
    );
    const result = isSkillBuilderInstalled();
    expect(result.installed).toBe(false);
    expect(result.path).toBe(null);
  });

  it("AC-US2-05 (0786): findSkillBuilderPath returns null when only present in marketplace catalog", () => {
    const pluginRoot = join(
      fakeHome,
      ".claude/plugins/marketplaces/some-mkt/plugins/skill-builder",
    );
    mkdirSync(pluginRoot, { recursive: true });
    writeFileSync(
      join(pluginRoot, "SKILL.md"),
      `---\nname: skill-builder\nversion: "1.0.0"\n---\n`,
    );
    expect(findSkillBuilderPath()).toBe(null);
  });

  it("AC-US2-05 (0786): findSkillBuilderPath returns the cache path when actually installed", () => {
    const cacheDir = join(
      fakeHome,
      ".claude/plugins/cache/foo-mkt/skill-builder-plugin",
    );
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, "SKILL.md"),
      `---\nname: skill-builder\nversion: "1.0.0"\n---\n`,
    );
    expect(findSkillBuilderPath()).toBe(cacheDir);
  });
});
