// ---------------------------------------------------------------------------
// Tests for isSkillCreatorInstalled() — covers 6 detection branches.
// Ref: .specweave/increments/0675-skill-creator-detection-hotfix
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
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

const { isSkillCreatorInstalled } = await import("../skill-creator-detection.js");
const { AGENTS_REGISTRY } = await import("../../agents/agents-registry.js");

let projectRoot: string;
let fakeHome: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "vskill-skd-proj-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-skd-home-"));
  osMock.home = fakeHome;
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
  osMock.home = "";
});

function installAt(base: string, relative: string): void {
  const dir = join(base, relative, "skill-creator");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: skill-creator\n---\n");
}

describe("US-001: Project-local agent-native installs", () => {
  it("AC-US1-01: detects .claude/skills/skill-creator under projectRoot", () => {
    installAt(projectRoot, ".claude/skills");
    expect(isSkillCreatorInstalled(projectRoot)).toBe(true);
  });

  it("AC-US1-02: detects .cursor/skills/skill-creator under projectRoot", () => {
    installAt(projectRoot, ".cursor/skills");
    expect(isSkillCreatorInstalled(projectRoot)).toBe(true);
  });

  it("AC-US1-03: detects .opencode/skills/skill-creator under projectRoot", () => {
    installAt(projectRoot, ".opencode/skills");
    expect(isSkillCreatorInstalled(projectRoot)).toBe(true);
  });

  it("AC-US1-04: returns false when projectRoot is undefined and no global install", () => {
    expect(isSkillCreatorInstalled()).toBe(false);
  });

  it("AC-US1-05: detection iterates AGENTS_REGISTRY.localSkillsDir (no hardcoded strings)", () => {
    // Pick a less-common agent to prove generic iteration, not just the top 3
    const windsurfDir = AGENTS_REGISTRY.find((a) => a.id === "windsurf")!.localSkillsDir;
    expect(windsurfDir).toBe(".windsurf/skills");
    installAt(projectRoot, windsurfDir);
    expect(isSkillCreatorInstalled(projectRoot)).toBe(true);
  });

  it("AC-US1-06: serve.ts checkSkillCreator passes projectRoot (source-level assertion)", () => {
    const serveSource = readFileSync(
      new URL("../../commands/eval/serve.ts", import.meta.url),
      "utf8",
    );
    // The call must pass a non-empty argument. Accept root/projectRoot/opts.root.
    expect(serveSource).toMatch(/isSkillCreatorInstalled\(\s*(root|projectRoot|opts\.root)/);
  });
});

describe("US-002: Marketplace-synced Claude Code installs", () => {
  it("AC-US2-01: AgentDefinition declares optional pluginMarketplaceDir field", () => {
    const regSource = readFileSync(
      new URL("../../agents/agents-registry.ts", import.meta.url),
      "utf8",
    );
    expect(regSource).toMatch(/pluginMarketplaceDir\?:\s*string/);
  });

  it("AC-US2-02: claude-code entry populates pluginMarketplaceDir", () => {
    const claudeCode = AGENTS_REGISTRY.find((a) => a.id === "claude-code")!;
    expect((claudeCode as { pluginMarketplaceDir?: string }).pluginMarketplaceDir).toBe(
      "~/.claude/plugins/marketplaces",
    );
  });

  it("AC-US2-04 (0786): marketplace-only does NOT count as installed — catalog presence is availability, not installation", () => {
    // 0786: prior to this increment, the marketplace catalog dir at
    // ~/.claude/plugins/marketplaces/<mkt>/plugins/<name> was treated as
    // evidence of installation. That dir is just the available-plugin
    // index — actual installs live under ~/.claude/plugins/cache/. The
    // Engine Selector and /api/skill-creator-status mislabelled
    // un-installed engines as installed. Detection now ignores the
    // marketplace branch.
    const pluginRoot = join(
      fakeHome,
      ".claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator",
    );
    mkdirSync(pluginRoot, { recursive: true });
    writeFileSync(join(pluginRoot, "README.md"), "# marketplace-synced\n");
    expect(isSkillCreatorInstalled()).toBe(false);
  });

  it("AC-US2-04: returns false when marketplace exists but no skill-creator plugin", () => {
    const otherPlugin = join(
      fakeHome,
      ".claude/plugins/marketplaces/some-other-marketplace/plugins/nothing-related",
    );
    mkdirSync(otherPlugin, { recursive: true });
    expect(isSkillCreatorInstalled()).toBe(false);
  });

  it("AC-US2-05: only claude-code has pluginMarketplaceDir set", () => {
    for (const agent of AGENTS_REGISTRY) {
      const mktDir = (agent as { pluginMarketplaceDir?: string }).pluginMarketplaceDir;
      if (agent.id === "claude-code") {
        expect(mktDir).toBe("~/.claude/plugins/marketplaces");
      } else {
        expect(mktDir).toBeUndefined();
      }
    }
  });
});

describe("US-003: Existing detection paths preserved", () => {
  it("AC-US3-01: detects ~/.agents/skills/skill-creator (global canonical)", () => {
    installAt(fakeHome, ".agents/skills");
    expect(isSkillCreatorInstalled()).toBe(true);
  });

  it("AC-US3-02: detects {projectRoot}/.agents/skills/skill-creator (project canonical)", () => {
    installAt(projectRoot, ".agents/skills");
    expect(isSkillCreatorInstalled(projectRoot)).toBe(true);
  });

  it("AC-US3-03: detects ~/.claude/skills/skill-creator (globalSkillsDir)", () => {
    installAt(fakeHome, ".claude/skills");
    expect(isSkillCreatorInstalled()).toBe(true);
  });

  it("AC-US3-04: detects ~/.claude/plugins/cache/{mkt}/*skill-creator* (pluginCacheDir walker)", () => {
    const pluginDir = join(
      fakeHome,
      ".claude/plugins/cache/foo-marketplace/skill-creator-plugin",
    );
    mkdirSync(pluginDir, { recursive: true });
    expect(isSkillCreatorInstalled()).toBe(true);
  });

  it("AC-US3-05: returns false when nothing is installed anywhere", () => {
    expect(isSkillCreatorInstalled(projectRoot)).toBe(false);
  });
});
