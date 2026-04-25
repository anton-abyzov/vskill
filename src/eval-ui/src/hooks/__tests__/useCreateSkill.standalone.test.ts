// ---------------------------------------------------------------------------
// Standalone-mode lock: when the user arrives at /create with mode=standalone
// (forceLayout = 3), the AI generator must NEVER reroute the skill into a
// plugin — even if the AI returns a `suggestedPlugin` and the project on disk
// has detected plugin layouts. The user explicitly chose a root `skills/`
// placement on the modal step; that choice is sticky.
//
// Reproduces the bug where mode=standalone&skillName=anton-greet still ends up
// rendering Plugin: easychamp after AI generation.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { decideGenerationPinning } from "../useCreateSkill";

describe("decideGenerationPinning — forceLayout=3 (standalone mode)", () => {
  it("standalone mode locks out AI suggestedPlugin even when user has not pinned a plugin", () => {
    const d = decideGenerationPinning({
      userName: "",
      userPlugin: "",
      userNewPlugin: "",
      aiName: "anton-greet",
      aiSuggestedPlugin: { plugin: "easychamp", layout: 2 },
      forceLayout: 3,
    });

    // With forceLayout = 3, the AI's suggestion must be ignored entirely.
    expect(d.applySuggestedPlugin).toBe(false);
    expect(d.suggestedPluginValue).toBeNull();
  });

  it("standalone mode still allows the AI name when user has not provided one", () => {
    const d = decideGenerationPinning({
      userName: "",
      userPlugin: "",
      userNewPlugin: "",
      aiName: "anton-greet",
      aiSuggestedPlugin: { plugin: "easychamp", layout: 2 },
      forceLayout: 3,
    });

    expect(d.applyName).toBe("anton-greet");
  });

  it("standalone mode preserves user-pinned name (still wins over AI)", () => {
    const d = decideGenerationPinning({
      userName: "anton-greet",
      userPlugin: "",
      userNewPlugin: "",
      aiName: "task-skill-announcer",
      aiSuggestedPlugin: { plugin: "easychamp" },
      forceLayout: 3,
    });

    expect(d.applyName).toBeNull(); // keep user's
    expect(d.applySuggestedPlugin).toBe(false); // standalone wins
  });

  it("forceLayout=undefined → AI suggestedPlugin is applied (existing behavior)", () => {
    const d = decideGenerationPinning({
      userName: "",
      userPlugin: "",
      userNewPlugin: "",
      aiName: "foo",
      aiSuggestedPlugin: { plugin: "frontend", layout: 1 },
      forceLayout: undefined,
    });

    expect(d.applySuggestedPlugin).toBe(true);
    expect(d.suggestedPluginValue).toEqual({ plugin: "frontend", layout: 1 });
  });

  it("forceLayout=1 (existing-plugin lock) does not block plugin (only standalone does)", () => {
    const d = decideGenerationPinning({
      userName: "",
      userPlugin: "my-plugin",
      userNewPlugin: "",
      aiName: "foo",
      aiSuggestedPlugin: { plugin: "frontend", layout: 1 },
      forceLayout: 1,
    });

    // User pinned the plugin in this case so AI must not override —
    // forceLayout=1 itself is not the gate, the user-pinning is.
    expect(d.applySuggestedPlugin).toBe(false);
  });
});
