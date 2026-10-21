import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({ path: "", generate: vi.fn(), create: vi.fn() }));
vi.mock("../../utils/skill-creator-detection.js", () => ({
  isSkillCreatorInstalled: () => !!mocks.path,
  findSkillCreatorPath: () => mocks.path || null,
}));
vi.mock("../../eval/llm.js", () => ({ createLlmClient: (...args: unknown[]) => { mocks.create(...args); return { generate: mocks.generate }; } }));
import { generateWithSkillCreator, mergeNativeSkillMd } from "../skill-authoring-engine.js";

const native = `---
name: native-skill
description: Native description
context: fork
agent: Explore
allowed-tools:
  - Read
  - Bash(git status:*)
hooks:
  Stop:
    - matcher: ""
metadata:
  custom: keep-me
  target-agents: [codex]
---
# Native body
`;

describe("installed skill-creator execution", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "native-authoring-"));
    mocks.path = root;
    vi.clearAllMocks();
    writeFileSync(join(root, "SKILL.md"), "# Skill creator\nActual installed authoring instructions.");
    mocks.generate.mockResolvedValue({ text: native });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("uses installed instructions through Claude and retains the native schema", async () => {
    const result = await generateWithSkillCreator({ prompt: "Build native", model: "opus" }, { root });
    expect(mocks.create).toHaveBeenCalledWith({ provider: "claude-cli", model: "opus" });
    expect(mocks.generate).toHaveBeenCalledWith(expect.stringContaining("Actual installed authoring instructions"), "Build native");
    expect(result.nativeSkillMd).toContain("context: fork");
    expect(result.nativeSkillMd).toContain("target-agents: [claude-code]");
    expect(result.emittedTargets).toEqual(["claude-code"]);
    const saved = mergeNativeSkillMd(result.nativeSkillMd!, { name: result.name, description: result.description, body: result.body, version: "2.0.0", allowedTools: result.allowedTools });
    expect(saved).toContain("hooks:\n  Stop:\n    - matcher: \"\"");
    expect(saved).toContain("allowed-tools:\n  - Read\n  - Bash(git status:*)");
    expect(saved).toContain("custom: keep-me");
    expect(saved).toContain('version: "2.0.0"');
    expect(saved).toContain("target-agents: [claude-code]");
    expect(saved).not.toContain("target-agents: [codex]");
  });
  it("updates legacy root versions while adding engine provenance", () => {
    const saved = mergeNativeSkillMd("---\nname: old\ndescription: old\nversion: 2.0.0\ncontext: fork\n---\nBody", {
      name: "old", description: "Updated", body: "Body", version: "2.0.1", engine: "none",
    });
    expect(saved).toContain('version: "2.0.1"');
    expect(saved).toContain("metadata:\n  engine: none");
    expect(saved).toContain("context: fork");
  });
  it("preserves four-space metadata indentation without duplicate engine keys", () => {
    const saved = mergeNativeSkillMd("---\nname: old\ndescription: old\nmetadata:\n    engine: none\n    custom: retained\n    version: 1.0.0\n---\nBody", {
      name: "old", description: "Updated", body: "Body", version: "1.0.1", engine: "vskill",
    });
    expect(saved).toContain("    engine: vskill");
    expect(saved).toContain("    custom: retained");
    expect(saved.match(/engine:/g)).toHaveLength(1);
  });
  it("resolves the installed plugin-version layout without inspecting unrelated folders", async () => {
    mocks.path = join(root, "plugin");
    mkdirSync(join(mocks.path, "1.0.0", "skills", "skill-creator"), { recursive: true });
    writeFileSync(join(mocks.path, "1.0.0", "skills", "skill-creator", "SKILL.md"), "Versioned installed instructions");
    await generateWithSkillCreator({ prompt: "Build" }, { root });
    expect(mocks.generate.mock.calls[0][0]).toContain("Versioned installed instructions");
  });
  it("does not silently fall back when the engine is missing or returns invalid content", async () => {
    mocks.path = "";
    await expect(generateWithSkillCreator({ prompt: "Build" }, { root })).rejects.toThrow("not-installed");
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.path = root;
    mocks.generate.mockResolvedValue({ text: "No skill here" });
    await expect(generateWithSkillCreator({ prompt: "Build" }, { root })).rejects.toThrow("valid SKILL.md");
  });
});
