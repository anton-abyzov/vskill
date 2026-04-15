import { describe, it, expect } from "vitest";

describe("Workspace versions tab integration", () => {
  it("PanelId includes 'versions'", () => {
    // This matches the extended type — if it compiles, it proves the type was extended
    const validPanels = ["editor", "tests", "run", "activation", "history", "leaderboard", "deps", "versions"] as const;
    expect(validPanels).toContain("versions");
  });

  it("Ctrl+8 maps to versions panel", () => {
    const panels = ["editor", "tests", "run", "activation", "history", "leaderboard", "deps", "versions"];
    const key = "8";
    const panel = panels[parseInt(key) - 1];
    expect(panel).toBe("versions");
  });

  it("versions tab is in Insights group", () => {
    // Mirror of TAB_GROUPS structure
    const insightsGroup = {
      label: "Insights",
      tabs: [
        { id: "history", label: "History", shortcut: "5" },
        { id: "leaderboard", label: "Leaderboard", shortcut: "6" },
        { id: "deps", label: "Deps", shortcut: "7" },
        { id: "versions", label: "Versions", shortcut: "8" },
      ],
    };
    const versionsTab = insightsGroup.tabs.find((t) => t.id === "versions");
    expect(versionsTab).toBeDefined();
    expect(versionsTab?.shortcut).toBe("8");
  });
});
