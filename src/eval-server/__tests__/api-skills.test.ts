// ---------------------------------------------------------------------------
// T-021 + T-025: server-side contract tests for the /api/skills endpoint.
//
// These tests exercise the public helpers that feed the handler response
// against real filesystem fixtures (temp dirs) so the SkillInfo contract is
// locked in on the emitting side — complementing the client-boundary tests
// in src/eval-ui/src/__tests__/api-{origin,frontmatter}.test.ts.
//
// Covers:
//   - T-021: origin is present ("source" | "installed") on every scanned skill
//   - T-025: buildSkillMetadata() returns the full frontmatter + filesystem
//            shape with `null` for any missing field (never undefined)
//   - deriveSourceAgent() maps installed skill dirs to registry agent ids
//   - parseSkillFrontmatter() handles inline-array and YAML-list syntaxes
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseSkillFrontmatter,
  buildSkillMetadata,
  deriveSourceAgent,
} from "../api-routes.js";
import { classifyOrigin, scanSkills } from "../../eval/skill-scanner.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-api-skills-test-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeSkill(
  relDir: string,
  skillMdContent: string,
  extraFiles: Record<string, string> = {},
): string {
  const full = join(tmpRoot, relDir);
  mkdirSync(full, { recursive: true });
  writeFileSync(join(full, "SKILL.md"), skillMdContent, "utf8");
  for (const [name, body] of Object.entries(extraFiles)) {
    writeFileSync(join(full, name), body, "utf8");
  }
  return full;
}

// ---------------------------------------------------------------------------
// T-021: origin guarantee
// ---------------------------------------------------------------------------

describe("T-021: /api/skills origin guarantee (server-side)", () => {
  it("every scanSkills() result carries a non-null origin", async () => {
    writeSkill("my-plugin/skills/own-skill", "---\nname: own-skill\n---\n# Own");
    writeSkill(".claude/skills/installed-skill", "---\nname: installed-skill\n---\n# Installed");

    const skills = await scanSkills(tmpRoot);
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) {
      expect(s.origin === "source" || s.origin === "installed").toBe(true);
    }
  });

  it("classifies agent-config dirs as 'installed' and project dirs as 'source'", async () => {
    writeSkill("my-plugin/skills/own-skill", "---\nname: own-skill\n---");
    writeSkill(".claude/skills/installed-skill", "---\nname: installed-skill\n---");

    const skills = await scanSkills(tmpRoot);
    const own = skills.find((s) => s.skill === "own-skill");
    const installed = skills.find((s) => s.skill === "installed-skill");
    expect(own?.origin).toBe("source");
    expect(installed?.origin).toBe("installed");
  });

  it("classifyOrigin is the SSoT — direct call produces the same result", () => {
    const ownDir = join(tmpRoot, "my-plugin/skills/own-skill");
    const installedDir = join(tmpRoot, ".claude/skills/installed-skill");
    expect(classifyOrigin(ownDir, tmpRoot)).toBe("source");
    expect(classifyOrigin(installedDir, tmpRoot)).toBe("installed");
  });
});

// ---------------------------------------------------------------------------
// T-025: parseSkillFrontmatter
// ---------------------------------------------------------------------------

describe("T-025: parseSkillFrontmatter() YAML coverage", () => {
  it("parses scalar fields (quoted and unquoted)", () => {
    const fm = parseSkillFrontmatter(
      `---\nname: "my-skill"\ndescription: short description\nversion: 1.2.3\n---\n# body`,
    );
    expect(fm.name).toBe("my-skill");
    expect(fm.description).toBe("short description");
    expect(fm.version).toBe("1.2.3");
  });

  it("parses inline arrays: [a, b, c]", () => {
    const fm = parseSkillFrontmatter(
      `---\ntags: [productivity, "obsidian", notes]\n---\nbody`,
    );
    expect(fm.tags).toEqual(["productivity", "obsidian", "notes"]);
  });

  it("parses YAML list syntax", () => {
    const fm = parseSkillFrontmatter(
      `---\ntags:\n  - one\n  - two\n  - three\n---\nbody`,
    );
    expect(fm.tags).toEqual(["one", "two", "three"]);
  });

  it("returns an empty object when no frontmatter is present", () => {
    expect(parseSkillFrontmatter("no frontmatter here")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// T-025: buildSkillMetadata
// ---------------------------------------------------------------------------

describe("T-025: buildSkillMetadata() response shape", () => {
  it("extracts all frontmatter fields + filesystem stats for a source skill", () => {
    const dir = writeSkill(
      "my-plugin/skills/rich-skill",
      `---
name: rich-skill
description: A rich skill for testing
version: 2.1.0
category: productivity
author: Anton
license: MIT
homepage: https://example.com
tags: [alpha, beta]
skill-deps: [other-skill]
mcp-deps:
  - obsidian
  - filesystem
entryPoint: SKILL.md
---
# Body`,
      { "reference.md": "extra content" },
    );

    const meta = buildSkillMetadata(dir, "source", tmpRoot);
    expect(meta.description).toBe("A rich skill for testing");
    expect(meta.version).toBe("2.1.0");
    expect(meta.category).toBe("productivity");
    expect(meta.author).toBe("Anton");
    expect(meta.license).toBe("MIT");
    expect(meta.homepage).toBe("https://example.com");
    expect(meta.tags).toEqual(["alpha", "beta"]);
    expect(meta.deps).toEqual(["other-skill"]);
    expect(meta.mcpDeps).toEqual(["obsidian", "filesystem"]);
    expect(meta.entryPoint).toBe("SKILL.md");
    expect(meta.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
    expect(meta.sizeBytes).toBeGreaterThan(0);
    expect(meta.sourceAgent).toBeNull(); // source skill → no sourceAgent
  });

  it("returns null for every missing field (no undefined, no omissions)", () => {
    const dir = writeSkill("my-plugin/skills/bare", `---\nname: bare\n---\n# Just a name`);
    const meta = buildSkillMetadata(dir, "source", tmpRoot);

    // Scalars missing → null
    expect(meta.description).toBeNull();
    expect(meta.version).toBeNull();
    expect(meta.category).toBeNull();
    expect(meta.author).toBeNull();
    expect(meta.license).toBeNull();
    expect(meta.homepage).toBeNull();
    // Arrays missing → null (NOT empty array)
    expect(meta.tags).toBeNull();
    expect(meta.deps).toBeNull();
    expect(meta.mcpDeps).toBeNull();
    // entryPoint defaults to "SKILL.md"
    expect(meta.entryPoint).toBe("SKILL.md");
    // Filesystem stats populated
    expect(meta.sizeBytes).toBeGreaterThan(0);
    expect(meta.lastModified).not.toBeNull();
  });

  it("populates sourceAgent='claude-code' for .claude/skills/* installed skills", () => {
    const dir = writeSkill(".claude/skills/my-installed", `---\nname: my-installed\n---`);
    const meta = buildSkillMetadata(dir, "installed", tmpRoot);
    expect(meta.sourceAgent).toBe("claude-code");
  });

  it("returns EMPTY_METADATA-shaped object when SKILL.md is missing", () => {
    const dir = join(tmpRoot, "nonexistent-skill");
    mkdirSync(dir, { recursive: true });
    const meta = buildSkillMetadata(dir, "source", tmpRoot);
    // Every field present, every scalar null
    const keys = [
      "description", "version", "category", "author", "license",
      "homepage", "tags", "deps", "mcpDeps", "entryPoint",
      "lastModified", "sizeBytes", "sourceAgent",
    ] as const;
    for (const k of keys) {
      expect(meta).toHaveProperty(k);
      expect(meta[k]).toBeNull();
    }
  });

  it("accepts both 'skill-deps' and 'deps' frontmatter keys (camelCase or kebab-case)", () => {
    const dir1 = writeSkill(
      "p1/skills/kebab",
      `---\nname: kebab\nskill-deps: [a, b]\n---`,
    );
    const dir2 = writeSkill(
      "p2/skills/plain",
      `---\nname: plain\ndeps: [c, d]\n---`,
    );
    expect(buildSkillMetadata(dir1, "source", tmpRoot).deps).toEqual(["a", "b"]);
    expect(buildSkillMetadata(dir2, "source", tmpRoot).deps).toEqual(["c", "d"]);
  });

  it("JSON.stringify round-trips every field (no undefined values in payload)", () => {
    const dir = writeSkill("p/skills/s", `---\nname: s\n---`);
    const meta = buildSkillMetadata(dir, "source", tmpRoot);
    const json = JSON.stringify(meta);
    // If any value were `undefined`, JSON.stringify would drop the key.
    // This assertion fails if T-025's null-never-undefined contract is broken.
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "author", "category", "deps", "description", "entryPoint",
        "homepage", "lastModified", "license", "mcpDeps", "repoUrl",
        "sizeBytes", "skillPath", "sourceAgent", "tags", "version",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// T-025: deriveSourceAgent
// ---------------------------------------------------------------------------

describe("T-025: deriveSourceAgent() registry mapping", () => {
  it("returns null for origin='source'", () => {
    const dir = join(tmpRoot, ".claude/skills/foo");
    expect(deriveSourceAgent(dir, tmpRoot, "source")).toBeNull();
  });

  it("maps .claude/skills/* to 'claude-code'", () => {
    const dir = join(tmpRoot, ".claude/skills/foo");
    expect(deriveSourceAgent(dir, tmpRoot, "installed")).toBe("claude-code");
  });

  it("returns null when first segment matches no registry agent", () => {
    const dir = join(tmpRoot, ".unknown-agent/skills/foo");
    expect(deriveSourceAgent(dir, tmpRoot, "installed")).toBeNull();
  });
});
