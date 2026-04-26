// ---------------------------------------------------------------------------
// 0774 T-006: pure-function tests for the sub-tab URL helpers exported from
// RightPanel.tsx. These have no React dependencies — just URL parsing.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { defaultSubFor, readInitialSub } from "../RightPanel";

describe("defaultSubFor (0774 T-006)", () => {
  it("returns 'run' for the run tab", () => {
    expect(defaultSubFor("run")).toBe("run");
  });

  it("returns 'run' for the activation (Trigger) tab", () => {
    expect(defaultSubFor("activation")).toBe("run");
  });

  it("returns empty string for tabs without sub-modes", () => {
    expect(defaultSubFor("overview")).toBe("");
    expect(defaultSubFor("editor")).toBe("");
    expect(defaultSubFor("tests")).toBe("");
    expect(defaultSubFor("versions")).toBe("");
    expect(defaultSubFor("history")).toBe("");
    expect(defaultSubFor("leaderboard")).toBe("");
    expect(defaultSubFor("deps")).toBe("");
  });
});

describe("readInitialSub (0774 T-006)", () => {
  it("reads the sub param when active tab supports it and the value is valid", () => {
    expect(readInitialSub("run", "?panel=run&sub=history")).toBe("history");
    expect(readInitialSub("run", "?panel=run&sub=models")).toBe("models");
    expect(readInitialSub("activation", "?panel=trigger&sub=history")).toBe("history");
  });

  it("falls back to the default sub-mode when sub param is missing", () => {
    expect(readInitialSub("run", "?panel=run")).toBe("run");
    expect(readInitialSub("activation", "?panel=trigger")).toBe("run");
  });

  it("falls back to the default when sub param is unknown", () => {
    expect(readInitialSub("run", "?panel=run&sub=foo")).toBe("run");
    expect(readInitialSub("activation", "?panel=trigger&sub=models")).toBe("run");
  });

  it("returns empty string for tabs without sub-modes (sub param ignored)", () => {
    expect(readInitialSub("overview", "?sub=anything")).toBe("");
    expect(readInitialSub("versions", "?panel=versions&sub=foo")).toBe("");
    expect(readInitialSub("editor", "?sub=run")).toBe("");
  });

  it("handles empty query strings gracefully", () => {
    expect(readInitialSub("run", "")).toBe("run");
    expect(readInitialSub("activation", "")).toBe("run");
    expect(readInitialSub("overview", "")).toBe("");
  });
});
