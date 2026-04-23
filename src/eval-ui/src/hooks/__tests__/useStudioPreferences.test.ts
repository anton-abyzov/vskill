// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// T-060: useStudioPreferences — localStorage-backed studio preferences.
//
// Contract:
//   - readStudioPreferences() returns the current preferences object or an
//     empty object when nothing is stored / storage unavailable.
//   - writeStudioPreference(key, value) persists a single key without
//     overwriting unrelated keys.
//   - The module gracefully degrades when `localStorage` throws (e.g.
//     private-mode Safari, storage quota exceeded).
//
// The file-backed `.vskill/studio.json` half of the feature is deferred
// until a POST /api/prefs endpoint exists — see BLOCKING_ISSUE note in
// hooks/useStudioPreferences.ts.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readStudioPreferences, writeStudioPreference, STUDIO_PREFS_KEY } from "../useStudioPreferences";

describe("useStudioPreferences — localStorage round-trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty object when no preferences are stored", () => {
    expect(readStudioPreferences()).toEqual({});
  });

  it("returns an empty object when the stored value is not valid JSON", () => {
    localStorage.setItem(STUDIO_PREFS_KEY, "{ not: json");
    expect(readStudioPreferences()).toEqual({});
  });

  it("writeStudioPreference persists a key under the global studio key", () => {
    writeStudioPreference("selectedModel", "anthropic/claude-4.6-sonnet");
    const raw = localStorage.getItem(STUDIO_PREFS_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.selectedModel).toBe("anthropic/claude-4.6-sonnet");
  });

  it("writing a second key preserves the first", () => {
    writeStudioPreference("selectedModel", "anthropic/claude-4.6-sonnet");
    writeStudioPreference("sidebarCollapsed", true);
    const prefs = readStudioPreferences();
    expect(prefs.selectedModel).toBe("anthropic/claude-4.6-sonnet");
    expect(prefs.sidebarCollapsed).toBe(true);
  });

  it("read + write survive a localStorage.setItem failure", () => {
    // Simulate quota-exceeded / private-mode by making setItem throw.
    const originalSetItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    // Must not throw to callers.
    expect(() => writeStudioPreference("selectedModel", "foo")).not.toThrow();
    spy.mockRestore();
    // And subsequent reads should still work.
    Storage.prototype.setItem = originalSetItem;
    writeStudioPreference("selectedModel", "bar");
    expect(readStudioPreferences().selectedModel).toBe("bar");
  });
});
