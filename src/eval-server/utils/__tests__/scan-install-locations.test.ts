// ---------------------------------------------------------------------------
// 0747 T-001: scanSkillInstallLocations — find every install location of a
// skill across all installable agents (project + personal scopes) plus the
// Claude Code plugin cache.
//
// Strategy: build a tmp project with .claude/ and .codex/ skills dirs, plus a
// fake $HOME with personal copies and an optional plugin cache, invoke the
// scanner, and assert the returned InstallLocation[] is shaped right.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSkillInstallLocations } from "../scan-install-locations.js";

let tmpRoot: string;
let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-scan-loc-root-"));
  tmpHome = mkdtempSync(join(tmpdir(), "vskill-scan-loc-home-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

function makeSkillFile(dir: string, body = "# SKILL\n"): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body, "utf8");
}

describe("scanSkillInstallLocations", () => {
  it("TC-001: returns one location per project-scope agent dir that holds the skill", () => {
    makeSkillFile(join(tmpRoot, ".claude", "skills", "greet-anton"));
    makeSkillFile(join(tmpRoot, ".codex", "skills", "greet-anton"));

    const locations = scanSkillInstallLocations(
      "anton-abyzov/greet-anton/greet-anton",
      tmpRoot,
    );

    const projectLocations = locations.filter((l) => l.scope === "project");
    const agents = projectLocations.map((l) => l.agent).sort();
    expect(agents).toEqual(["claude-code", "codex"]);
    for (const loc of projectLocations) {
      expect(loc.readonly).toBe(false);
      expect(loc.symlinked).toBe(false);
      expect(loc.dir).toContain("greet-anton");
    }
  });

  it("TC-002: returns scope='personal' for installs under expandHome(globalSkillsDir)", () => {
    makeSkillFile(join(tmpHome, ".claude", "skills", "greet-anton"));

    const locations = scanSkillInstallLocations(
      "anton-abyzov/greet-anton/greet-anton",
      tmpRoot,
    );

    const personal = locations.filter((l) => l.scope === "personal");
    expect(personal.length).toBeGreaterThanOrEqual(1);
    const claude = personal.find((l) => l.agent === "claude-code");
    expect(claude).toBeDefined();
    expect(claude?.readonly).toBe(false);
  });

  it("TC-003: marks a location as symlinked when its dir is a symlink", () => {
    const canonicalDir = join(tmpRoot, ".agents", "skills", "anton-abyzov-greet-anton-greet-anton");
    makeSkillFile(canonicalDir);
    const linkParent = join(tmpRoot, ".claude", "skills");
    mkdirSync(linkParent, { recursive: true });
    symlinkSync(canonicalDir, join(linkParent, "greet-anton"), "dir");

    const locations = scanSkillInstallLocations(
      "anton-abyzov/greet-anton/greet-anton",
      tmpRoot,
    );

    const claudeProject = locations.find(
      (l) => l.scope === "project" && l.agent === "claude-code",
    );
    expect(claudeProject).toBeDefined();
    expect(claudeProject?.symlinked).toBe(true);
  });

  it("TC-004: includes plugin-cache locations as scope='plugin' with readonly=true", () => {
    // Mimic ~/.claude/plugins/cache/{marketplace}/{plugin}/{version}/skills/{skill}/SKILL.md
    const versionDir = join(
      tmpHome,
      ".claude",
      "plugins",
      "cache",
      "anthropic-skills",
      "mobile",
      "1.2.3",
    );
    makeSkillFile(join(versionDir, "skills", "greet-anton"));

    const locations = scanSkillInstallLocations(
      "anton-abyzov/greet-anton/greet-anton",
      tmpRoot,
    );

    const plugin = locations.find((l) => l.scope === "plugin");
    expect(plugin).toBeDefined();
    expect(plugin?.readonly).toBe(true);
    expect(plugin?.pluginSlug).toBe("mobile");
    expect(plugin?.pluginMarketplace).toBe("anthropic-skills");
  });

  it("TC-005: returns an empty array when no installs exist anywhere", () => {
    const locations = scanSkillInstallLocations(
      "anton-abyzov/greet-anton/greet-anton",
      tmpRoot,
    );
    expect(locations).toEqual([]);
  });

  it("TC-006: refuses canonical names containing path-traversal characters", () => {
    // Try to escape the sandbox via slug like "../../etc/passwd"
    const locations = scanSkillInstallLocations(
      "anton-abyzov/greet-anton/../../etc/passwd",
      tmpRoot,
    );
    expect(locations).toEqual([]);
  });

  it("TC-007: agentLabel matches the registry's displayName for known agents", () => {
    makeSkillFile(join(tmpRoot, ".claude", "skills", "greet-anton"));

    const locations = scanSkillInstallLocations(
      "anton-abyzov/greet-anton/greet-anton",
      tmpRoot,
    );

    const claude = locations.find((l) => l.agent === "claude-code");
    expect(claude).toBeDefined();
    expect(claude?.agentLabel).toBe("Claude Code");
  });

  it("TC-008: derives skill slug from canonical name's last segment", () => {
    // canonical with multiple segments — last segment is the slug on disk
    makeSkillFile(join(tmpRoot, ".claude", "skills", "my-skill"));

    const locations = scanSkillInstallLocations(
      "owner/repo/my-skill",
      tmpRoot,
    );

    expect(locations.length).toBeGreaterThanOrEqual(1);
    const claude = locations.find((l) => l.agent === "claude-code");
    expect(claude?.dir.endsWith("my-skill")).toBe(true);
  });
});
