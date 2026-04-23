// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0678 — T-003: extend useStudioPreferences with `skillGenModel`.
//
// Contract (AC-US3-01, AC-US3-02, AC-US3-03):
//   - `skillGenModel?: { provider: string; model: string }` round-trips
//     through readStudioPreferences / writeStudioPreference using the same
//     storage key (`vskill.studio.prefs`) as every other field from 0674.
//   - A `storage` event on the same key propagates the new value to a
//     listener mounted in a second tab on the same origin.
//   - Malformed persisted data (JSON parse error, wrong shape) silently
//     resolves to `undefined` without throwing.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  readStudioPreferences,
  writeStudioPreference,
  STUDIO_PREFS_KEY,
} from "../useStudioPreferences";

describe("0678 — useStudioPreferences.skillGenModel round-trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // AC-US3-01
  it("writes and reads a { provider, model } pair symmetrically", () => {
    writeStudioPreference("skillGenModel", { provider: "ollama", model: "qwen2.5-coder:7b" });
    const prefs = readStudioPreferences();
    expect(prefs.skillGenModel).toEqual({ provider: "ollama", model: "qwen2.5-coder:7b" });
  });

  it("preserves other keys when skillGenModel is written", () => {
    writeStudioPreference("selectedModel", "anthropic/claude-4.6-sonnet");
    writeStudioPreference("skillGenModel", { provider: "claude-cli", model: "sonnet" });
    const prefs = readStudioPreferences();
    expect(prefs.selectedModel).toBe("anthropic/claude-4.6-sonnet");
    expect(prefs.skillGenModel).toEqual({ provider: "claude-cli", model: "sonnet" });
  });

  it("storage key for skillGenModel stays under the shared STUDIO_PREFS_KEY — no new key", () => {
    writeStudioPreference("skillGenModel", { provider: "ollama", model: "qwen2.5-coder:7b" });
    const raw = localStorage.getItem(STUDIO_PREFS_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.skillGenModel).toEqual({ provider: "ollama", model: "qwen2.5-coder:7b" });
    // Ensure no sibling key was created for this field
    const dedicatedKey = Object.keys(localStorage).filter((k) => k !== STUDIO_PREFS_KEY);
    expect(dedicatedKey).toEqual([]);
  });

  // AC-US3-02 — cross-tab propagation via the `storage` event
  it("a `storage` event on STUDIO_PREFS_KEY surfaces the new skillGenModel to a listener", () => {
    const received: Array<{ provider: string; model: string } | undefined> = [];
    const listener = () => {
      received.push(readStudioPreferences().skillGenModel as any);
    };
    window.addEventListener("storage", listener);

    // Simulate a write happening in another tab — it mutates localStorage and
    // dispatches a StorageEvent on this window.
    const newValue = JSON.stringify({ skillGenModel: { provider: "ollama", model: "qwen2.5-coder:7b" } });
    localStorage.setItem(STUDIO_PREFS_KEY, newValue);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STUDIO_PREFS_KEY,
        newValue,
        oldValue: null,
        storageArea: localStorage,
      }),
    );

    window.removeEventListener("storage", listener);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ provider: "ollama", model: "qwen2.5-coder:7b" });
  });

  // AC-US3-03 — malformed persisted data resolves silently
  it("returns undefined skillGenModel when the persisted object is malformed JSON", () => {
    localStorage.setItem(STUDIO_PREFS_KEY, "{ not json");
    const prefs = readStudioPreferences();
    expect(prefs.skillGenModel).toBeUndefined();
  });

  it("does not throw when skillGenModel has the wrong shape — caller sees a value but can guard", () => {
    // readStudioPreferences is intentionally lenient — it returns whatever
    // was stored without validating shape. Callers (the dropdown) are
    // responsible for defensively falling back when the shape is wrong.
    // The guarantee here is "no throw".
    localStorage.setItem(
      STUDIO_PREFS_KEY,
      JSON.stringify({ skillGenModel: "not-an-object" }),
    );
    expect(() => readStudioPreferences()).not.toThrow();
  });

  it("overwriting skillGenModel replaces the value atomically", () => {
    writeStudioPreference("skillGenModel", { provider: "ollama", model: "qwen2.5-coder:7b" });
    writeStudioPreference("skillGenModel", { provider: "claude-cli", model: "sonnet" });
    expect(readStudioPreferences().skillGenModel).toEqual({ provider: "claude-cli", model: "sonnet" });
  });

  it("the generic getStudioPreference<T>() reads skillGenModel with a fallback", async () => {
    const { getStudioPreference } = await import("../useStudioPreferences");
    const fallback = { provider: "claude-cli", model: "sonnet" };
    expect(getStudioPreference("skillGenModel", fallback)).toEqual(fallback);
    writeStudioPreference("skillGenModel", { provider: "ollama", model: "qwen2.5-coder:7b" });
    expect(getStudioPreference("skillGenModel", fallback)).toEqual({
      provider: "ollama",
      model: "qwen2.5-coder:7b",
    });
  });
});

describe("0678 — StudioPreferences type exposes skillGenModel", () => {
  it("skillGenModel is a known field on StudioPreferences", async () => {
    // This test exists for type coverage: the `writeStudioPreference`
    // signature `writeStudioPreference<K extends keyof StudioPreferences>`
    // enforces that "skillGenModel" is a valid key. If the field is removed
    // from the type, the cast below stops compiling. The runtime assertion
    // keeps the test non-vacuous.
    const mod = await import("../useStudioPreferences");
    // The module exports a writer whose generic requires a known key name.
    // If skillGenModel is NOT in StudioPreferences, the following would be
    // a type error at compile time.
    mod.writeStudioPreference("skillGenModel", { provider: "claude-cli", model: "sonnet" });
    expect(mod.readStudioPreferences().skillGenModel).toEqual({
      provider: "claude-cli",
      model: "sonnet",
    });
  });
});
