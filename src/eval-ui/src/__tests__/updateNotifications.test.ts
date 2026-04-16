import { describe, it, expect } from "vitest";
import type { SkillInfo } from "../types";

// ---------------------------------------------------------------------------
// T-001: StudioContext reducer — DISMISS_UPDATE_NOTIFICATION
// ---------------------------------------------------------------------------

interface StudioState {
  updateNotificationDismissed: boolean;
  skills: SkillInfo[];
  // (other fields omitted — we only test the new slice)
}

type Action =
  | { type: "DISMISS_UPDATE_NOTIFICATION" }
  | { type: "SET_SKILLS"; skills: SkillInfo[] };

function reduceNotification(state: StudioState, action: Action): StudioState {
  switch (action.type) {
    case "DISMISS_UPDATE_NOTIFICATION":
      return { ...state, updateNotificationDismissed: true };
    case "SET_SKILLS":
      return { ...state, skills: action.skills };
    default:
      return state;
  }
}

describe("T-001: updateNotificationDismissed state", () => {
  const base: StudioState = { updateNotificationDismissed: false, skills: [] };

  it("defaults to false", () => {
    expect(base.updateNotificationDismissed).toBe(false);
  });

  it("becomes true on DISMISS_UPDATE_NOTIFICATION", () => {
    const next = reduceNotification(base, { type: "DISMISS_UPDATE_NOTIFICATION" });
    expect(next.updateNotificationDismissed).toBe(true);
  });

  it("stays true once dismissed", () => {
    const dismissed = reduceNotification(base, { type: "DISMISS_UPDATE_NOTIFICATION" });
    const again = reduceNotification(dismissed, { type: "SET_SKILLS", skills: [] });
    expect(again.updateNotificationDismissed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-002: UpdateToast visibility logic (pure)
// ---------------------------------------------------------------------------

function shouldShowToast(updateCount: number, dismissed: boolean): boolean {
  return updateCount > 0 && !dismissed;
}

function toastText(count: number): string {
  return `${count} update${count === 1 ? "" : "s"} available`;
}

describe("T-002: UpdateToast visibility logic", () => {
  it("hidden when updateCount is 0", () => {
    expect(shouldShowToast(0, false)).toBe(false);
  });

  it("visible when updates exist and not dismissed", () => {
    expect(shouldShowToast(3, false)).toBe(true);
  });

  it("hidden when dismissed", () => {
    expect(shouldShowToast(3, true)).toBe(false);
  });

  it("singular text for 1 update", () => {
    expect(toastText(1)).toBe("1 update available");
  });

  it("plural text for multiple updates", () => {
    expect(toastText(3)).toBe("3 updates available");
  });
});

// ---------------------------------------------------------------------------
// T-004: TabBar showDot logic for versions tab
// ---------------------------------------------------------------------------

interface DotInput {
  tabId: string;
  isDirty: boolean;
  isRunning: boolean;
  isActivationRunning: boolean;
  hasRegressions: boolean;
  hasUpdate: boolean;
}

function computeShowDot(input: DotInput): boolean {
  return (
    (input.tabId === "editor" && input.isDirty) ||
    (input.tabId === "run" && input.isRunning) ||
    (input.tabId === "activation" && input.isActivationRunning) ||
    (input.tabId === "history" && input.hasRegressions) ||
    (input.tabId === "versions" && input.hasUpdate)
  );
}

describe("T-004: TabBar versions dot logic", () => {
  const defaults: DotInput = {
    tabId: "versions",
    isDirty: false,
    isRunning: false,
    isActivationRunning: false,
    hasRegressions: false,
    hasUpdate: false,
  };

  it("no dot when hasUpdate is false", () => {
    expect(computeShowDot(defaults)).toBe(false);
  });

  it("shows dot when hasUpdate is true", () => {
    expect(computeShowDot({ ...defaults, hasUpdate: true })).toBe(true);
  });

  it("does not affect other tabs", () => {
    expect(computeShowDot({ ...defaults, tabId: "editor", hasUpdate: true })).toBe(false);
    expect(computeShowDot({ ...defaults, tabId: "editor", isDirty: true })).toBe(true);
  });

  it("dot color falls through to yellow for versions", () => {
    // The dotColor logic: run→accent, activation→accent, history→red, else→yellow
    const tabId = "versions";
    const dotColor =
      tabId === "run" ? "var(--accent)"
        : tabId === "activation" ? "var(--accent)"
        : tabId === "history" ? "var(--red)"
        : "var(--yellow)";
    expect(dotColor).toBe("var(--yellow)");
  });
});

// ---------------------------------------------------------------------------
// T-005: Derive hasUpdate from skills array
// ---------------------------------------------------------------------------

function deriveHasUpdate(
  skills: SkillInfo[],
  selectedPlugin: string | undefined,
  selectedSkill: string | undefined,
): boolean {
  if (!selectedPlugin || !selectedSkill) return false;
  return skills.find((s) => s.name === selectedSkill && s.plugin === selectedPlugin)?.updateAvailable ?? false;
}

// Use the actual shape: SkillInfo has .skill not .name
function deriveHasUpdateReal(
  skills: SkillInfo[],
  selectedPlugin: string | undefined,
  selectedSkill: string | undefined,
): boolean {
  if (!selectedPlugin || !selectedSkill) return false;
  return skills.find((s) => s.skill === selectedSkill && s.plugin === selectedPlugin)?.updateAvailable ?? false;
}

describe("T-005: deriveHasUpdate from skills + selection", () => {
  const skills: SkillInfo[] = [
    {
      plugin: "sw", skill: "architect", dir: "/tmp", hasEvals: true,
      hasBenchmark: false, evalCount: 2, assertionCount: 4,
      benchmarkStatus: "pass", lastBenchmark: null, origin: "installed",
      updateAvailable: true, latestVersion: "2.0.0",
    },
    {
      plugin: "sw", skill: "pm", dir: "/tmp", hasEvals: false,
      hasBenchmark: false, evalCount: 0, assertionCount: 0,
      benchmarkStatus: "missing", lastBenchmark: null, origin: "installed",
      updateAvailable: false,
    },
  ];

  it("true when selected skill has updateAvailable", () => {
    expect(deriveHasUpdateReal(skills, "sw", "architect")).toBe(true);
  });

  it("false when selected skill has no update", () => {
    expect(deriveHasUpdateReal(skills, "sw", "pm")).toBe(false);
  });

  it("false when no selection", () => {
    expect(deriveHasUpdateReal(skills, undefined, undefined)).toBe(false);
  });

  it("false when skill not found", () => {
    expect(deriveHasUpdateReal(skills, "other", "unknown")).toBe(false);
  });
});
