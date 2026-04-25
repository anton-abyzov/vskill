// ---------------------------------------------------------------------------
// skill-emitter-spec-compliance.test.ts — 0679
//
// Golden-file tests that lock the SKILL.md frontmatter shape against the
// canonical agentskills.io specification:
//
//   https://agentskills.io/specification
//
// The spec requires `tags` and `target-agents` to live under a `metadata:`
// block, NOT at the top level of the frontmatter. This test is the primary
// guardrail — any regression produces a readable diff.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { buildSkillMdForTest, parseFrontmatterForTest } from "./helpers/skill-md-test-helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

// Canonical input payload — mirrors the AI-generation pipeline output.
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

describe("SKILL.md spec compliance (0679) — golden-file frontmatter shape", () => {
  it("emits tags and target-agents under metadata: (AC-US1-01, AC-US5-01)", () => {
    const out = buildSkillMdForTest(FIXED_INPUT);
    const golden = readFileSync(join(FIXTURES, "skill-emitter-after.md"), "utf-8");
    expect(out).toBe(golden);
  });

  it("parses so that doc.metadata.tags and doc.metadata['target-agents'] are arrays; root keys are undefined (AC-US1-02)", () => {
    const out = buildSkillMdForTest(FIXED_INPUT);
    const fm = parseFrontmatterForTest(out);

    // metadata nesting
    expect(fm.metadata).toBeDefined();
    expect(Array.isArray(fm.metadata.tags)).toBe(true);
    expect(fm.metadata.tags).toEqual(["devtools", "cli", "sql"]);
    expect(Array.isArray(fm.metadata["target-agents"])).toBe(true);
    expect(fm.metadata["target-agents"]).toEqual(["claude-code", "cursor"]);

    // root-level MUST NOT have these keys
    expect(fm.tags).toBeUndefined();
    expect(fm["target-agents"]).toBeUndefined();
  });

  it("preserves existing top-level fields (name, description, allowed-tools, model) in position (AC-US1-03)", () => {
    const out = buildSkillMdForTest(FIXED_INPUT);
    const fm = parseFrontmatterForTest(out);

    expect(fm.name).toBe(FIXED_INPUT.name);
    expect(fm.description).toBe(FIXED_INPUT.description);
    expect(fm["allowed-tools"]).toBe(FIXED_INPUT.allowedTools);
    expect(fm.model).toBe(FIXED_INPUT.model);

    // Line ordering: name → description → allowed-tools → model → metadata.
    // This locks the emitter's key order so golden diffs stay minimal.
    const frontmatterBlock = out.split("---\n")[1];
    const nameIdx = frontmatterBlock.indexOf("name:");
    const descIdx = frontmatterBlock.indexOf("description:");
    const toolsIdx = frontmatterBlock.indexOf("allowed-tools:");
    const modelIdx = frontmatterBlock.indexOf("model:");
    const metaIdx = frontmatterBlock.indexOf("metadata:");
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(descIdx).toBeGreaterThan(nameIdx);
    expect(toolsIdx).toBeGreaterThan(descIdx);
    expect(modelIdx).toBeGreaterThan(toolsIdx);
    expect(metaIdx).toBeGreaterThan(modelIdx);
  });

  it("before→after diff is limited to moving tags and target-agents into metadata (AC-US1-04)", () => {
    const before = readFileSync(join(FIXTURES, "skill-emitter-before.md"), "utf-8");
    const after = readFileSync(join(FIXTURES, "skill-emitter-after.md"), "utf-8");

    // The "before" fixture has top-level tags/target-agents; "after" has them under metadata:.
    expect(before).toContain("\ntags: devtools, cli, sql\n");
    expect(before).toContain("\ntarget-agents: claude-code, cursor\n");
    expect(before).not.toContain("metadata:");

    expect(after).not.toMatch(/^tags:/m);
    expect(after).not.toMatch(/^target-agents:/m);
    expect(after).toContain("metadata:");
    expect(after).toContain("  tags:");
    expect(after).toContain("  target-agents:");

    // Shared lines: description, allowed-tools, model, body heading all appear in both.
    for (const shared of [
      `description: "${FIXED_INPUT.description}"`,
      "allowed-tools: Read, Write, Edit",
      "model: sonnet",
      "# /sql-formatter",
    ]) {
      expect(before).toContain(shared);
      expect(after).toContain(shared);
    }
  });

  it("omits metadata block when no tags and no target-agents are provided (backwards compatibility)", () => {
    const out = buildSkillMdForTest({
      name: "bare-skill",
      plugin: "",
      layout: 3,
      description: "Bare skill.",
      body: "# /bare-skill",
    });
    expect(out).not.toContain("metadata:");
    expect(out).not.toContain("tags:");
    expect(out).not.toContain("target-agents:");
  });

  it("emits metadata block with only tags when target-agents is empty", () => {
    const out = buildSkillMdForTest({
      name: "tags-only",
      plugin: "",
      layout: 3,
      description: "Skill with tags only.",
      body: "# /tags-only",
      tags: ["alpha", "beta"],
    });
    expect(out).toContain("metadata:\n  tags:\n    - alpha\n    - beta\n");
    expect(out).not.toContain("target-agents:");
  });

  it("emits metadata block with only target-agents when tags is empty", () => {
    const out = buildSkillMdForTest({
      name: "agents-only",
      plugin: "",
      layout: 3,
      description: "Skill with target-agents only.",
      body: "# /agents-only",
      targetAgents: ["claude-code"],
    });
    expect(out).toContain("metadata:\n  target-agents:\n    - claude-code\n");
    expect(out).not.toMatch(/^\s*tags:/m);
  });

  it("ignores claude-code-only target-agents lists when the user did not explicitly opt in (no-op edge case)", () => {
    // Explicit opt-in MUST still emit metadata.target-agents — only absence/empty omits it.
    const out = buildSkillMdForTest({
      name: "claude-only",
      plugin: "",
      layout: 3,
      description: "Claude-only skill.",
      body: "# /claude-only",
      targetAgents: ["claude-code"],
    });
    expect(out).toContain("  target-agents:\n    - claude-code\n");
  });
});
