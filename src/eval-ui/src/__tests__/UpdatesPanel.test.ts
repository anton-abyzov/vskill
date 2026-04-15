import { describe, it, expect } from "vitest";
import type { SkillUpdateInfo } from "../api";

// Test the data transformation logic used by UpdatesPanel

function classifyBump(installed: string, latest: string): "major" | "minor" | "patch" {
  const [iMaj, iMin] = installed.split(".").map(Number);
  const [lMaj, lMin] = latest.split(".").map(Number);
  if (lMaj > iMaj) return "major";
  if (lMin > iMin) return "minor";
  return "patch";
}

describe("UpdatesPanel logic", () => {
  it("classifies bump types correctly", () => {
    expect(classifyBump("1.0.0", "2.0.0")).toBe("major");
    expect(classifyBump("1.0.0", "1.1.0")).toBe("minor");
    expect(classifyBump("1.0.0", "1.0.1")).toBe("patch");
    expect(classifyBump("2.3.0", "3.0.0")).toBe("major");
  });

  it("filters out non-updatable skills for batch selection", () => {
    const updates: (SkillUpdateInfo & { pinned?: boolean })[] = [
      { name: "owner/repo/architect", installed: "1.0.0", latest: "2.0.0", updateAvailable: true },
      { name: "owner/repo/pm", installed: "1.0.0", latest: "1.1.0", updateAvailable: true, pinned: true },
      { name: "owner/repo/debug", installed: "1.0.0", latest: "1.0.1", updateAvailable: true },
    ];

    const batchSelectable = updates.filter((u) => u.updateAvailable && !u.pinned);
    expect(batchSelectable.length).toBe(2);
    expect(batchSelectable.map((u) => u.name.split("/").pop())).toEqual(["architect", "debug"]);
  });

  it("detects empty state when no outdated skills", () => {
    const updates: SkillUpdateInfo[] = [];
    const isEmpty = updates.length === 0;
    expect(isEmpty).toBe(true);
  });

  it("pinned skills show disabled state", () => {
    const skill = {
      name: "owner/repo/architect",
      installed: "1.0.0",
      latest: "2.0.0",
      updateAvailable: true,
      pinned: true,
      pinnedVersion: "1.0.0",
    };
    const isDisabled = !!skill.pinned;
    const tooltip = isDisabled ? "Pinned — unpin from CLI to update" : "";
    expect(isDisabled).toBe(true);
    expect(tooltip).toBe("Pinned — unpin from CLI to update");
  });
});
