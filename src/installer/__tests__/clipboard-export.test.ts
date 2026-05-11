// 0845 T-015 — buildClipboardBlob unit tests.
//
// Contract (plan.md §5, AC-US5-03):
//   buildClipboardBlob(parsedSkill, agentId) →
//     { blob: string, pasteInstructionsUrl: string, docsUrl?: string }
//   - The blob contains the skill name, description, and body.
//   - Tier-1/2 agentIds throw — clipboard is Tier 3 only.
//   - No filesystem side effects.

import { describe, it, expect } from "vitest";
import { buildClipboardBlob } from "../clipboard-export.js";
import type { ParsedSkill } from "../transformers/index.js";

const skill: ParsedSkill = {
  name: "obsidian-brain",
  description: "PARA + LLM Wiki",
  body: "## Workflow\n\nDrop notes in raw/inbox.\n",
  originalFrontmatter: "name: obsidian-brain\ndescription: PARA + LLM Wiki",
};

describe("buildClipboardBlob", () => {
  it("returns blob + pasteInstructionsUrl for ChatGPT (Tier 3)", () => {
    const r = buildClipboardBlob(skill, "chatgpt");
    expect(r.blob).toContain("obsidian-brain");
    expect(r.blob).toContain("PARA + LLM Wiki");
    expect(r.blob).toContain("Drop notes in raw/inbox.");
    expect(r.pasteInstructionsUrl).toMatch(/^https:\/\//);
  });

  it("returns docsUrl when the registry entry has one", () => {
    const r = buildClipboardBlob(skill, "chatgpt");
    expect(r.docsUrl).toBeDefined();
    expect(r.docsUrl!.length).toBeGreaterThan(0);
  });

  it("works for v0 and bolt-new (other Tier 3 agents)", () => {
    expect(() => buildClipboardBlob(skill, "v0")).not.toThrow();
    expect(() => buildClipboardBlob(skill, "bolt-new")).not.toThrow();
  });

  it("throws for a Tier 1 agentId (codex)", () => {
    expect(() => buildClipboardBlob(skill, "codex")).toThrow(/tier|clipboard/i);
  });

  it("throws for a Tier 2 agentId (cursor)", () => {
    expect(() => buildClipboardBlob(skill, "cursor")).toThrow(/tier|clipboard/i);
  });

  it("throws for an unknown agentId", () => {
    expect(() => buildClipboardBlob(skill, "no-such-agent")).toThrow(/unknown/i);
  });

  it("is idempotent — byte-equal output for the same input", () => {
    const a = buildClipboardBlob(skill, "chatgpt");
    const b = buildClipboardBlob(skill, "chatgpt");
    expect(a).toEqual(b);
  });
});
