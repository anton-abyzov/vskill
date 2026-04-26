// ---------------------------------------------------------------------------
// 0737 RED: skill-metadata source-link fields
//
// AC-US4-03 / FR-001 / FR-003 — buildSkillMetadata MUST expose `repoUrl` and
// `skillPath` so DetailHeader.tsx can render a clickable GitHub blob anchor
// without a second network call. Source of provenance is the vskill.lock
// `source` field (e.g. `github:anton-abyzov/greet-anton`), which already
// records the upstream repo at install time. New explicit lockfile fields
// `sourceRepoUrl` / `sourceSkillPath` (added in T-006) take precedence.
//
// Coverage: legacy `github:owner/repo` source string (every existing user
// has these), explicit new fields, missing data (no lockfile / authored
// scope), and frontmatter-only `homepage` (regression).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillMetadata } from "../api-routes.js";

interface LockfileSeed {
  skills: Record<string, {
    version: string;
    sha: string;
    tier: string;
    installedAt: string;
    source: string;
    sourceRepoUrl?: string;
    sourceSkillPath?: string;
  }>;
}

function seedSkill(
  root: string,
  pluginName: string,
  skillName: string,
  frontmatter: string[],
): string {
  const skillDir = join(root, ".claude", "skills", pluginName, skillName);
  mkdirSync(skillDir, { recursive: true });
  const fm = ["---", ...frontmatter, "---", "", "# body", ""].join("\n");
  writeFileSync(join(skillDir, "SKILL.md"), fm, "utf-8");
  return skillDir;
}

function seedFlatSkill(root: string, name: string, frontmatter: string[]): string {
  const skillDir = join(root, ".claude", "skills", name);
  mkdirSync(skillDir, { recursive: true });
  const fm = ["---", ...frontmatter, "---", "", "# body", ""].join("\n");
  writeFileSync(join(skillDir, "SKILL.md"), fm, "utf-8");
  return skillDir;
}

function seedLockfile(root: string, lock: LockfileSeed): void {
  const full = {
    version: 1,
    agents: ["claude-code"],
    skills: lock.skills,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  writeFileSync(join(root, "vskill.lock"), JSON.stringify(full, null, 2), "utf-8");
}

describe("0737: buildSkillMetadata exposes repoUrl/skillPath", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "skill-source-link-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("derives repoUrl + skillPath from legacy lockfile `source: github:owner/repo` (flat layout)", () => {
    // Mirrors the user's actual greet-anton entry in vskill.lock — this is
    // the dominant case we need to cover for already-installed skills.
    const skillDir = seedFlatSkill(tmpRoot, "greet-anton", [
      "name: greet-anton",
      "version: 1.0.1",
      "description: greet-anton",
    ]);
    seedLockfile(tmpRoot, {
      skills: {
        "greet-anton": {
          version: "1.0.1",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-04-26T00:00:00.000Z",
          source: "github:anton-abyzov/greet-anton",
        },
      },
    });

    const md = buildSkillMetadata(skillDir, "installed", tmpRoot);
    expect(md.repoUrl).toBe("https://github.com/anton-abyzov/greet-anton");
    expect(md.skillPath).toBe("SKILL.md");
  });

  it("uses explicit `sourceRepoUrl` + `sourceSkillPath` from lockfile when present (forward-compat path)", () => {
    const skillDir = seedFlatSkill(tmpRoot, "analytics-tracking", [
      "name: analytics-tracking",
      "description: Track analytics events.",
    ]);
    seedLockfile(tmpRoot, {
      skills: {
        "analytics-tracking": {
          version: "0.1.0",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-04-26T00:00:00.000Z",
          source: "github:coreyhaines31/marketingskills",
          sourceRepoUrl: "https://github.com/coreyhaines31/marketingskills",
          sourceSkillPath: "skills/analytics-tracking/SKILL.md",
        },
      },
    });

    const md = buildSkillMetadata(skillDir, "installed", tmpRoot);
    expect(md.repoUrl).toBe("https://github.com/coreyhaines31/marketingskills");
    expect(md.skillPath).toBe("skills/analytics-tracking/SKILL.md");
  });

  it("returns null repoUrl/skillPath when no lockfile entry exists (authored scope)", () => {
    // Authored skills have no lockfile entry — fall through cleanly.
    const skillDir = seedFlatSkill(tmpRoot, "my-local-skill", [
      "name: my-local-skill",
      "description: local",
    ]);
    // No lockfile written.

    const md = buildSkillMetadata(skillDir, "source", tmpRoot);
    expect(md.repoUrl ?? null).toBeNull();
    expect(md.skillPath ?? null).toBeNull();
  });

  it("returns null repoUrl/skillPath when lockfile has the skill but `source` is non-github (defensive)", () => {
    const skillDir = seedFlatSkill(tmpRoot, "weird-source", [
      "name: weird-source",
      "description: weird",
    ]);
    seedLockfile(tmpRoot, {
      skills: {
        "weird-source": {
          version: "1.0.0",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-04-26T00:00:00.000Z",
          source: "marketplace:specweave/sw#weird-source",
        },
      },
    });

    const md = buildSkillMetadata(skillDir, "installed", tmpRoot);
    // `marketplace:` source is not a github: URL — we don't synthesise a
    // repo URL from it (would be guessing). Returns null.
    expect(md.repoUrl ?? null).toBeNull();
    expect(md.skillPath ?? null).toBeNull();
  });

  it("preserves frontmatter `homepage` regardless of lockfile derivation (no regression)", () => {
    // 0737 must NOT change how frontmatter `homepage` is read; downstream
    // components fall back to it when repoUrl is null.
    const skillDir = seedFlatSkill(tmpRoot, "with-homepage", [
      "name: with-homepage",
      "description: x",
      "homepage: https://example.com/skill",
    ]);

    const md = buildSkillMetadata(skillDir, "source", tmpRoot);
    expect(md.homepage).toBe("https://example.com/skill");
  });

  it("derives skillPath as `skills/<name>/SKILL.md` for nested-layout marketplace plugins", () => {
    // Nested layout: a plugin with multiple skills, each at
    // <repo>/skills/<skillname>/SKILL.md. The lockfile entry is keyed by
    // skill name and `source` is `github:owner/repo`. We can't tell flat vs
    // nested from `source` alone, but the on-disk skill being inside a
    // `skills/` parent (or anything other than the plugin root) is the
    // signal — for now we adopt the dominant convention of treating any
    // skill as flat unless `sourceSkillPath` is explicitly present.
    //
    // This case proves the explicit-field path (already covered above) is
    // what marketplaces will use; we are NOT auto-guessing nested layout
    // from the skill name alone — that would produce broken URLs for flat
    // plugins.
    const skillDir = seedSkill(tmpRoot, "marketingskills", "analytics-tracking", [
      "name: marketingskills/analytics-tracking",
      "description: x",
    ]);
    seedLockfile(tmpRoot, {
      skills: {
        "marketingskills": {
          version: "1.0.0",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-04-26T00:00:00.000Z",
          source: "github:coreyhaines31/marketingskills",
          sourceRepoUrl: "https://github.com/coreyhaines31/marketingskills",
          sourceSkillPath: "skills/analytics-tracking/SKILL.md",
        },
      },
    });

    const md = buildSkillMetadata(skillDir, "installed", tmpRoot);
    expect(md.repoUrl).toBe("https://github.com/coreyhaines31/marketingskills");
    expect(md.skillPath).toBe("skills/analytics-tracking/SKILL.md");
  });
});
