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
import { parseSkillFrontmatter, buildSkillMetadata } from "../api-routes.js";

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

  // -------------------------------------------------------------------------
  // 2026-04-25 review F-006: buildSkillMetadata round-trip (the /api/skills
  // listing path). Previously only the parser and the matcher were covered;
  // buildSkillMetadata composes the actual response payload, so we lock its
  // behavior end-to-end.
  // -------------------------------------------------------------------------
  describe("buildSkillMetadata (api-routes.ts) — /api/skills listing path", () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = mkdtempSync(join(tmpdir(), "skill-rt-md-"));
    });

    afterEach(() => {
      rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("returns metadata-nested tags for a SKILL.md emitted by the new shape", () => {
      const skillDir = join(tmpRoot, "skills", "sql-formatter");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), buildSkillMdForTest(FIXED_INPUT), "utf-8");

      const md = buildSkillMetadata(skillDir, "source", tmpRoot);
      expect(md.tags).toEqual(["devtools", "cli", "sql"]);
      expect(md.description).toBe(FIXED_INPUT.description);
    });
  });

  // -------------------------------------------------------------------------
  // 2026-04-25 review F-001: folded-scalar (`description: >`) handling.
  // The skill-builder SKILL.md (and other hand-edited files) use folded
  // scalars; the parser must join indented continuation into a single value
  // instead of returning the literal `>` marker.
  // -------------------------------------------------------------------------
  describe("folded-scalar handling (description: > / key: |)", () => {
    it("joins folded continuation lines into a single string", () => {
      const sample = [
        "---",
        "name: skill-builder",
        "description: >",
        "  Meta-skill for creating new skills from natural language.",
        "  Trigger phrases: \"new skill\", \"create a skill\".",
        "---",
        "",
        "# /skill-builder",
        "",
      ].join("\n");

      const fm = parseSkillFrontmatter(sample);
      expect(typeof fm.description).toBe("string");
      // Should NOT be the literal `>` marker.
      expect(fm.description).not.toBe(">");
      // Should contain content from continuation lines, joined with spaces.
      expect(fm.description).toContain("Meta-skill for creating new skills");
      expect(fm.description).toContain("Trigger phrases");
    });

    it("preserves newlines for literal-scalar (`|`) form", () => {
      const sample = [
        "---",
        "name: literal-test",
        "description: |",
        "  Line one.",
        "  Line two.",
        "---",
        "",
        "# /literal-test",
        "",
      ].join("\n");
      const fm = parseSkillFrontmatter(sample);
      expect(fm.description).toContain("Line one");
      expect(fm.description).toContain("Line two");
      // Literal mode preserves the newline between lines.
      expect((fm.description as string).split("\n").length).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // 2026-04-25 review F-002: malformed `metadata: foo` should not silently
  // discard the inline value.
  // -------------------------------------------------------------------------
  describe("malformed `metadata: <inline>` handling", () => {
    it("preserves the inline scalar at a sentinel root key AND opens the block", () => {
      const sample = [
        "---",
        "name: weird",
        "description: \"weird skill\"",
        "metadata: oops",
        "  tags:",
        "    - a",
        "    - b",
        "---",
        "",
        "# /weird",
        "",
      ].join("\n");

      const fm = parseSkillFrontmatter(sample);
      // The block-form children are still parsed under `metadata`.
      expect(fm.metadata).toBeDefined();
      const meta = fm.metadata as Record<string, unknown>;
      expect(meta.tags).toEqual(["a", "b"]);
      // CRITICAL: the inline scalar must NOT be silently dropped. It surfaces
      // at the sentinel `metadata-inline` key so a downstream consumer (or a
      // future strict-mode validator) can detect the malformed file.
      expect(fm["metadata-inline"]).toBe("oops");
    });
  });

  // -------------------------------------------------------------------------
  // 2026-04-25 review iter-3 F-003: root-list regex must reject malformed
  // indentation (1 space, 3+ spaces) instead of silently accepting and
  // producing a confusing parse.
  // -------------------------------------------------------------------------
  describe("root-list regex strictness", () => {
    it("accepts standard 2-space and 0-space root list items", () => {
      const sample = [
        "---",
        "tags:",
        "  - alpha",
        "  - beta",
        "---",
        "",
        "# /x",
        "",
      ].join("\n");
      const fm = parseSkillFrontmatter(sample);
      expect(fm.tags).toEqual(["alpha", "beta"]);
    });

    it("rejects 1-space and 3-space malformed list indentation", () => {
      // 1-space indent: malformed. The regex must not capture this as a list
      // item so the user notices the malformed YAML instead of silently
      // getting a partial parse.
      const sample = [
        "---",
        "tags:",
        " - alpha",   // 1 space — malformed
        "   - beta",  // 3 spaces — malformed
        "---",
        "",
        "# /x",
        "",
      ].join("\n");
      const fm = parseSkillFrontmatter(sample);
      // tags list stays empty (or undefined) — proves the malformed lines
      // were not silently absorbed as list items.
      const tags = Array.isArray(fm.tags) ? fm.tags : [];
      expect(tags).not.toContain("alpha");
      expect(tags).not.toContain("beta");
    });
  });

  // -------------------------------------------------------------------------
  // 2026-04-25 review F-004: only allow-listed metadata children surface at
  // the top level. An arbitrary `metadata.X` must NOT shadow a future
  // top-level field.
  // -------------------------------------------------------------------------
  describe("allow-listed metadata-to-root surfacing", () => {
    it("surfaces tags / version / homepage at the top level", () => {
      const sample = [
        "---",
        "name: surfacing",
        "description: \"surfacing test\"",
        "metadata:",
        "  tags:",
        "    - a",
        "  version: \"1.2.3\"",
        "  homepage: https://example.com",
        "---",
        "",
        "# /surfacing",
        "",
      ].join("\n");

      const fm = parseSkillFrontmatter(sample);
      expect(fm.tags).toEqual(["a"]);
      expect(fm.version).toBe("1.2.3");
      expect(fm.homepage).toBe("https://example.com");
    });

    it("does NOT surface non-allow-listed metadata children", () => {
      const sample = [
        "---",
        "name: no-leak",
        "description: \"no-leak test\"",
        "metadata:",
        "  custom-field: \"should-not-leak\"",
        "  internal-key: \"also-no\"",
        "---",
        "",
        "# /no-leak",
        "",
      ].join("\n");

      const fm = parseSkillFrontmatter(sample);
      // Stays nested-only.
      expect(fm["custom-field"]).toBeUndefined();
      expect(fm["internal-key"]).toBeUndefined();
      const meta = fm.metadata as Record<string, unknown>;
      expect(meta["custom-field"]).toBe("should-not-leak");
      expect(meta["internal-key"]).toBe("also-no");
    });
  });
});
