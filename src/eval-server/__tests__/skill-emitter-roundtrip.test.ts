// ---------------------------------------------------------------------------
// skill-emitter-roundtrip.test.ts — 0679 F-001 / F-006 regression coverage
//
// Closes the gap left by skill-emitter-spec-compliance.test.ts: the original
// suite parses emitted SKILL.md content with a *test-local* parser, so it
// proves the writer is consistent with itself but not that production readers
// survive the migration. This file runs the emitter output through every
// production code path that reads SKILL.md frontmatter and asserts each one
// recovers `tags` (and `target-agents`) under the new metadata-nested shape.
//
// Production readers exercised here:
//   1. parseSkillFrontmatter            (api-routes.ts) — drives /api/skills
//   2. matchExistingPlugin              (skill-create-routes.ts) — plugin matcher
//   3. activation-test SkillMeta        (api-routes.ts) — activation tester
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSkillMdForTest } from "./helpers/skill-md-test-helpers.js";
import { matchExistingPlugin } from "../skill-create-routes.js";
import { parseSkillFrontmatter } from "../api-routes.js";

const FIXED_INPUT = {
  name: "sql-formatter",
  plugin: "devtools",
  layout: 2 as const,
  description:
    "Format SQL queries into canonical, readable form. Activate when the user asks to format, prettify, normalize, or clean up SQL.",
  model: "sonnet",
  allowedTools: "Read, Write, Edit",
  body: "# /sql-formatter\n\nYou are a helpful assistant. Describe what this skill does.",
  tags: ["devtools", "cli", "sql"],
  targetAgents: ["claude-code", "cursor"],
};

describe("0679 round-trip: emitted SKILL.md parses correctly through production readers", () => {
  // -------------------------------------------------------------------------
  // F-006 + F-001 reader (1): parseSkillFrontmatter
  // -------------------------------------------------------------------------
  describe("parseSkillFrontmatter (api-routes.ts) — used by /api/skills metadata", () => {
    it("recovers tags from the metadata block", () => {
      const out = buildSkillMdForTest(FIXED_INPUT);
      const fm = parseSkillFrontmatter(out);
      expect(fm.tags).toEqual(["devtools", "cli", "sql"]);
    });

    it("recovers target-agents from the metadata block", () => {
      const out = buildSkillMdForTest(FIXED_INPUT);
      const fm = parseSkillFrontmatter(out);
      expect(fm["target-agents"]).toEqual(["claude-code", "cursor"]);
    });

    it("preserves top-level scalar fields (description, model, allowed-tools)", () => {
      const out = buildSkillMdForTest(FIXED_INPUT);
      const fm = parseSkillFrontmatter(out);
      expect(fm.description).toBe(FIXED_INPUT.description);
      expect(fm.model).toBe("sonnet");
      expect(fm["allowed-tools"]).toBe("Read, Write, Edit");
    });

    it("returns empty when metadata block omitted (no tags / target-agents)", () => {
      const out = buildSkillMdForTest({
        name: "bare",
        plugin: "",
        layout: 3,
        description: "Bare skill.",
        body: "# /bare",
      });
      const fm = parseSkillFrontmatter(out);
      expect(fm.tags).toBeUndefined();
      expect(fm["target-agents"]).toBeUndefined();
    });

    // Forward-compat: a hand-edited SKILL.md may still have top-level tags.
    // The reader must accept both shapes during the transition window.
    it("falls back to top-level tags when metadata block absent (forward-compat)", () => {
      const legacy = [
        "---",
        'description: "legacy"',
        "tags:",
        "  - alpha",
        "  - beta",
        "---",
        "",
        "# /legacy",
        "",
      ].join("\n");
      const fm = parseSkillFrontmatter(legacy);
      expect(fm.tags).toEqual(["alpha", "beta"]);
    });
  });

  // -------------------------------------------------------------------------
  // F-001 reader (2): matchExistingPlugin reads SKILL.md from disk
  // -------------------------------------------------------------------------
  describe("matchExistingPlugin (skill-create-routes.ts) — plugin matcher", () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = mkdtempSync(join(tmpdir(), "skill-rt-"));
    });

    afterEach(() => {
      rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("recovers metadata-nested tags from a SKILL.md emitted by the new shape", () => {
      // Lay out an existing plugin with one skill whose SKILL.md was emitted
      // by `buildSkillMd` (metadata-nested shape).
      const skillDir = join(tmpRoot, "devtools", "skills", "sql-formatter");
      mkdirSync(skillDir, { recursive: true });
      const emitted = buildSkillMdForTest(FIXED_INPUT);
      writeFileSync(join(skillDir, "SKILL.md"), emitted, "utf-8");

      // A new skill that overlaps on tags should match the existing plugin.
      const suggestion = matchExistingPlugin(
        "sql-pretty",
        "Pretty-print SQL queries",
        ["devtools", "sql"],
        tmpRoot,
      );

      expect(suggestion).not.toBeNull();
      expect(suggestion!.plugin).toBe("devtools");
      // Reason should mention matching tags — proves the reader saw them.
      expect(suggestion!.reason).toMatch(/matching tags/i);
    });
  });

  // -------------------------------------------------------------------------
  // F-001 reader (3): activation-test SkillMeta tags extraction
  // The activation route uses the same regex pattern as matchExistingPlugin;
  // we extract the small parsing helper inline here so the test is hermetic.
  // -------------------------------------------------------------------------
  describe("activation-test SkillMeta (api-routes.ts) — uses same reader semantics", () => {
    it("the production reader (parseSkillFrontmatter) returns tags suitable for SkillMeta", () => {
      // The activation route now reads via parseSkillFrontmatter (post-fix).
      // This test guards that the swap from regex to parser still produces
      // the array shape SkillMeta expects.
      const out = buildSkillMdForTest(FIXED_INPUT);
      const fm = parseSkillFrontmatter(out);
      const tags = Array.isArray(fm.tags) ? fm.tags : [];
      expect(tags).toEqual(["devtools", "cli", "sql"]);
      expect(tags.every((t) => typeof t === "string")).toBe(true);
    });
  });
});
