// ---------------------------------------------------------------------------
// 0703 follow-up: decideGenerationPinning — user-pinned placement must win
// over AI `data.name` / `suggestedPlugin`. Without this, selecting
// `mode=new-plugin&pluginName=test-plugin&skillName=test-plugin-skill` in the
// modal ends up landing the skill as `task-skill-announcer` inside the first
// existing plugin the AI picks (e.g. `frontend`).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { decideGenerationPinning } from "../useCreateSkill";

describe("decideGenerationPinning", () => {
  it("user-provided name overrides AI name", () => {
    const d = decideGenerationPinning({
      userName: "test-plugin-skill",
      userPlugin: "",
      userNewPlugin: "",
      aiName: "task-skill-announcer",
      aiSuggestedPlugin: null,
    });
    expect(d.applyName).toBeNull();
  });

  it("when user has no name, AI name is applied", () => {
    const d = decideGenerationPinning({
      userName: "",
      userPlugin: "",
      userNewPlugin: "",
      aiName: "task-skill-announcer",
      aiSuggestedPlugin: null,
    });
    expect(d.applyName).toBe("task-skill-announcer");
  });

  it("user-selected plugin blocks suggestedPlugin", () => {
    const d = decideGenerationPinning({
      userName: "",
      userPlugin: "my-plugin",
      userNewPlugin: "",
      aiName: "foo",
      aiSuggestedPlugin: { plugin: "frontend" },
    });
    expect(d.applySuggestedPlugin).toBe(false);
    expect(d.suggestedPluginValue).toBeNull();
  });

  it("user-typed newPlugin (new-plugin mode) blocks suggestedPlugin", () => {
    const d = decideGenerationPinning({
      userName: "",
      userPlugin: "__new__",
      userNewPlugin: "test-plugin",
      aiName: "foo",
      aiSuggestedPlugin: { plugin: "frontend" },
    });
    expect(d.applySuggestedPlugin).toBe(false);
  });

  it("when user has no plugin, AI suggestedPlugin is applied", () => {
    const d = decideGenerationPinning({
      userName: "",
      userPlugin: "",
      userNewPlugin: "",
      aiName: "foo",
      aiSuggestedPlugin: { plugin: "frontend", layout: 1 },
    });
    expect(d.applySuggestedPlugin).toBe(true);
    expect(d.suggestedPluginValue).toEqual({ plugin: "frontend", layout: 1 });
  });

  it("whitespace-only user fields are treated as unset", () => {
    const d = decideGenerationPinning({
      userName: "   ",
      userPlugin: "\t",
      userNewPlugin: "",
      aiName: "foo",
      aiSuggestedPlugin: { plugin: "frontend" },
    });
    expect(d.applyName).toBe("foo");
    expect(d.applySuggestedPlugin).toBe(true);
  });

  it("null suggestedPlugin never applies (even when user has no plugin)", () => {
    const d = decideGenerationPinning({
      userName: "",
      userPlugin: "",
      userNewPlugin: "",
      aiName: "foo",
      aiSuggestedPlugin: null,
    });
    expect(d.applySuggestedPlugin).toBe(false);
  });
});
