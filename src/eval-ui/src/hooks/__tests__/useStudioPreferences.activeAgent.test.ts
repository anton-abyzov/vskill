// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// 0686 US-002 / T-006 (UI side): useStudioPreferences gains an `activeAgent`
// key so the AgentScopePicker can persist the user's chosen agent across
// reloads alongside the existing `selectedModel` / `sidebarCollapsed` keys.
//
// Storage contract:
//   - Key lives inside the same JSON blob as other prefs (STUDIO_PREFS_KEY).
//   - Read/write helpers are additive — existing keys never clobbered.
//   - Fail-soft: reads return `null` on unparseable storage, writes no-op
//     when storage is unavailable.
// ---------------------------------------------------------------------------

describe("0686: useStudioPreferences — activeAgent key", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("writes and reads `activeAgent` under the same prefs blob", async () => {
    const {
      writeStudioPreference,
      getStudioPreference,
      STUDIO_PREFS_KEY,
    } = await import("../useStudioPreferences");

    writeStudioPreference("activeAgent", "claude-cli");
    expect(getStudioPreference("activeAgent", null)).toBe("claude-cli");

    const blob = JSON.parse(localStorage.getItem(STUDIO_PREFS_KEY) ?? "{}");
    expect(blob.activeAgent).toBe("claude-cli");
  });

  it("does not clobber unrelated keys (sidebarCollapsed, selectedModel)", async () => {
    const { writeStudioPreference, readStudioPreferences } = await import(
      "../useStudioPreferences"
    );

    writeStudioPreference("sidebarCollapsed", true);
    writeStudioPreference("selectedModel", "anthropic/sonnet-4.6");
    writeStudioPreference("activeAgent", "cursor");

    const prefs = readStudioPreferences();
    expect(prefs.sidebarCollapsed).toBe(true);
    expect(prefs.selectedModel).toBe("anthropic/sonnet-4.6");
    expect(prefs.activeAgent).toBe("cursor");
  });

  it("returns null / fallback when no value has been written yet", async () => {
    const { getStudioPreference } = await import("../useStudioPreferences");
    expect(getStudioPreference("activeAgent", null)).toBeNull();
    expect(getStudioPreference("activeAgent", "claude-cli")).toBe("claude-cli");
  });

  it("reacts to a later write by surfacing the latest value", async () => {
    const { writeStudioPreference, getStudioPreference } = await import(
      "../useStudioPreferences"
    );
    writeStudioPreference("activeAgent", "cursor");
    expect(getStudioPreference("activeAgent", null)).toBe("cursor");
    writeStudioPreference("activeAgent", "claude-cli");
    expect(getStudioPreference("activeAgent", null)).toBe("claude-cli");
  });
});
