import { describe, it, expect } from "vitest";
import { buildGenerateRequestBody } from "../useCreateSkill.js";

// ---------------------------------------------------------------------------
// buildGenerateRequestBody — extracts the fetch body builder for testability
// ---------------------------------------------------------------------------

describe("buildGenerateRequestBody", () => {
  it("includes targetAgents when provided", () => {
    const result = buildGenerateRequestBody({
      prompt: "Build a calculator",
      provider: "claude-cli",
      model: "sonnet",
      targetAgents: ["cursor", "codex"],
    });
    expect(result.targetAgents).toEqual(["cursor", "codex"]);
    expect(result.prompt).toBe("Build a calculator");
  });

  it("omits targetAgents when empty array", () => {
    const result = buildGenerateRequestBody({
      prompt: "Build a calculator",
      provider: "claude-cli",
      model: "sonnet",
      targetAgents: [],
    });
    expect(result.targetAgents).toBeUndefined();
  });

  it("omits targetAgents when undefined", () => {
    const result = buildGenerateRequestBody({
      prompt: "Build a calculator",
      provider: "claude-cli",
      model: "sonnet",
    });
    expect(result.targetAgents).toBeUndefined();
  });

  it("preserves all other fields", () => {
    const result = buildGenerateRequestBody({
      prompt: "Build a tool",
      provider: "openrouter",
      model: "gpt-4o",
      targetAgents: ["claude-code"],
    });
    expect(result.prompt).toBe("Build a tool");
    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("gpt-4o");
    expect(result.targetAgents).toEqual(["claude-code"]);
  });
});
