// ---------------------------------------------------------------------------
// 0728 — buildSkillMd default-version emission
//
// AC-US2-01: buildSkillMd called with no `version` field (or an empty string)
//            must emit `version: "1.0.0"` in the frontmatter block.
// AC-US2-02: An explicit `version` overrides the default.
//
// Locks the contract that EVERY emitter output contains a `version:` line.
// Closes the structural reason save-draft and other callers can produce a
// versionless SKILL.md on disk.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import { buildSkillMdForTest } from "./helpers/skill-md-test-helpers.js";

const MINIMAL_INPUT = {
  name: "demo-skill",
  plugin: "",
  layout: 3 as const,
  description: "Demo skill description.",
  body: "# /demo-skill\n",
};

describe("0728 — buildSkillMd version emission", () => {
  it("AC-US2-01: emits version: \"1.0.0\" when version is omitted", () => {
    const out = buildSkillMdForTest(MINIMAL_INPUT);
    expect(out).toMatch(/^version: "1\.0\.0"$/m);
  });

  it("AC-US2-01: emits version: \"1.0.0\" when version is an empty string", () => {
    const out = buildSkillMdForTest({
      ...MINIMAL_INPUT,
      version: "",
    } as typeof MINIMAL_INPUT & { version: string });
    expect(out).toMatch(/^version: "1\.0\.0"$/m);
  });

  it("AC-US2-01: emits version: \"1.0.0\" when version is whitespace-only", () => {
    const out = buildSkillMdForTest({
      ...MINIMAL_INPUT,
      version: "   ",
    } as typeof MINIMAL_INPUT & { version: string });
    expect(out).toMatch(/^version: "1\.0\.0"$/m);
  });

  it("AC-US2-02: emits the explicit version when provided", () => {
    const out = buildSkillMdForTest({
      ...MINIMAL_INPUT,
      version: "2.3.4",
    } as typeof MINIMAL_INPUT & { version: string });
    expect(out).toMatch(/^version: "2\.3\.4"$/m);
    expect(out).not.toMatch(/^version: "1\.0\.0"$/m);
  });

  it("AC-US2-02: trims whitespace around the explicit version before emitting", () => {
    const out = buildSkillMdForTest({
      ...MINIMAL_INPUT,
      version: "  3.1.4  ",
    } as typeof MINIMAL_INPUT & { version: string });
    expect(out).toMatch(/^version: "3\.1\.4"$/m);
  });

  it("emits version line in stable position: after description, before allowed-tools / model / metadata", () => {
    const out = buildSkillMdForTest({
      ...MINIMAL_INPUT,
      allowedTools: "Read, Write",
      model: "sonnet",
      tags: ["alpha"],
    });
    const fmBlock = out.split("---\n")[1] ?? "";
    const descIdx = fmBlock.indexOf("description:");
    const versionIdx = fmBlock.indexOf("version:");
    const toolsIdx = fmBlock.indexOf("allowed-tools:");
    const modelIdx = fmBlock.indexOf("model:");
    const metaIdx = fmBlock.indexOf("metadata:");
    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(versionIdx).toBeGreaterThan(descIdx);
    expect(toolsIdx).toBeGreaterThan(versionIdx);
    expect(modelIdx).toBeGreaterThan(toolsIdx);
    expect(metaIdx).toBeGreaterThan(modelIdx);
  });
});
