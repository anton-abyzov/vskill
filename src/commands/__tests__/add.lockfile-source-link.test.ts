// ---------------------------------------------------------------------------
// 0743: lockfile entries written by `vskill add` must carry both
// `sourceRepoUrl` and `sourceSkillPath` so the studio detail header can
// construct the correct GitHub blob anchor (no 404s for skills installed
// from multi-skill repos like `anton-abyzov/vskill`).
//
// Two install code paths are covered here:
//
//   1. Direct-repo install (multi-skill repo, e.g. `vskill add owner/repo`)
//      threads `DiscoveredSkill.path` from `selectedSkills` into
//      `installOneGitHubSkill` and back through `SkillInstallResult` to the
//      lockfile-write loop.
//
//   2. Single-skill legacy install (`vskill add owner/repo --skill foo`)
//      derives the path locally as `skills/<foo>/SKILL.md` (or whatever
//      `skillSubpathOverride` provides) and persists it directly.
//
// Both paths share a small `buildGitHubInstallLockEntry` helper extracted to
// keep the lockfile shape under unit-test control. The helper is the unit
// of behaviour we assert against — it eliminates duplication between the
// two write sites and gives Layer 1 a fast, deterministic test surface.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { buildGitHubInstallLockEntry } from "../add-lockfile.js";

describe("0743: buildGitHubInstallLockEntry persists source-link provenance", () => {
  const baseArgs = {
    version: "1.0.1",
    sha: "abc123",
    owner: "anton-abyzov",
    repo: "vskill",
    global: false,
    installedAt: "2026-04-26T05:10:00.000Z",
  };

  it("persists `sourceRepoUrl` and `sourceSkillPath` for nested-layout skills (direct-repo install)", () => {
    const entry = buildGitHubInstallLockEntry({
      ...baseArgs,
      sourceSkillPath: "plugins/sw/skills/greet-anton/SKILL.md",
    });

    expect(entry.sourceRepoUrl).toBe("https://github.com/anton-abyzov/vskill");
    expect(entry.sourceSkillPath).toBe("plugins/sw/skills/greet-anton/SKILL.md");
    // Pre-0743 fields preserved for backward compatibility with readers that
    // still inspect the legacy `source` string (resolveSourceLink falls
    // through to it when `sourceRepoUrl` is absent).
    expect(entry.source).toBe("github:anton-abyzov/vskill");
    expect(entry.version).toBe("1.0.1");
    expect(entry.sha).toBe("abc123");
    expect(entry.tier).toBe("VERIFIED");
    expect(entry.scope).toBe("project");
    expect(entry.files).toEqual(["SKILL.md"]);
  });

  it("persists `sourceSkillPath` derived from `skillSubpath` for single-skill legacy install", () => {
    // The legacy single-skill path computes `skillSubpath` as
    // `skills/<name>/SKILL.md` (or "SKILL.md" for root SKILL.md repos);
    // that exact value must be persisted, even when it equals the old
    // resolver default — the explicit field is what makes the studio
    // anchor work without falling back to copy-chip.
    const entry = buildGitHubInstallLockEntry({
      ...baseArgs,
      repo: "easychamp-mcp",
      sourceSkillPath: "skills/foo/SKILL.md",
    });

    expect(entry.sourceRepoUrl).toBe("https://github.com/anton-abyzov/easychamp-mcp");
    expect(entry.sourceSkillPath).toBe("skills/foo/SKILL.md");
    expect(entry.source).toBe("github:anton-abyzov/easychamp-mcp");
  });

  it("falls back gracefully when `sourceSkillPath` is absent (defensive — caller should pass it but null is allowed)", () => {
    const entry = buildGitHubInstallLockEntry({
      ...baseArgs,
      sourceSkillPath: null,
    });

    expect(entry.sourceRepoUrl).toBe("https://github.com/anton-abyzov/vskill");
    expect(entry.sourceSkillPath).toBeUndefined();
  });

  it("emits `scope: 'user'` when global install is requested", () => {
    const entry = buildGitHubInstallLockEntry({
      ...baseArgs,
      global: true,
      sourceSkillPath: "SKILL.md",
    });

    expect(entry.scope).toBe("user");
  });
});
