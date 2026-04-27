// ---------------------------------------------------------------------------
// 0792 T-013/T-014: pure-function tests for the sub-tab + redirect helpers
// exported from RightPanel.tsx.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  defaultSubFor,
  readInitialSub,
  readInitialTabFromSearch,
  resolveLegacyTab,
  panelIdToDetail,
} from "../RightPanel";

describe("defaultSubFor (0792)", () => {
  it("returns 'benchmark' for the run tab", () => {
    expect(defaultSubFor("run")).toBe("benchmark");
  });

  it("returns 'timeline' for the history tab", () => {
    expect(defaultSubFor("history")).toBe("timeline");
  });

  it("returns empty string for tabs without sub-modes", () => {
    expect(defaultSubFor("overview")).toBe("");
    expect(defaultSubFor("edit")).toBe("");
  });
});

describe("readInitialSub (0792)", () => {
  it("reads ?mode= for the run tab", () => {
    expect(readInitialSub("run", "?tab=run&mode=activation")).toBe("activation");
    expect(readInitialSub("run", "?tab=run&mode=ab")).toBe("ab");
    expect(readInitialSub("run", "?tab=run&mode=benchmark")).toBe("benchmark");
  });

  it("reads ?view= for the history tab", () => {
    expect(readInitialSub("history", "?tab=history&view=models")).toBe("models");
    expect(readInitialSub("history", "?tab=history&view=versions")).toBe("versions");
    expect(readInitialSub("history", "?tab=history&view=timeline")).toBe("timeline");
  });

  it("falls back to default when ?mode= / ?view= is missing", () => {
    expect(readInitialSub("run", "?tab=run")).toBe("benchmark");
    expect(readInitialSub("history", "?tab=history")).toBe("timeline");
  });

  it("falls back to default when value is unknown", () => {
    expect(readInitialSub("run", "?mode=foo")).toBe("benchmark");
    expect(readInitialSub("history", "?view=bogus")).toBe("timeline");
  });

  it("accepts the legacy ?sub= alias for run tab", () => {
    expect(readInitialSub("run", "?sub=activation")).toBe("activation");
  });

  it("returns empty string for tabs without sub-modes", () => {
    expect(readInitialSub("overview", "?mode=anything")).toBe("");
    expect(readInitialSub("edit", "?mode=anything")).toBe("");
  });

  it("handles empty query strings gracefully", () => {
    expect(readInitialSub("run", "")).toBe("benchmark");
    expect(readInitialSub("history", "")).toBe("timeline");
    expect(readInitialSub("overview", "")).toBe("");
  });
});

describe("resolveLegacyTab (0792 T-014)", () => {
  it("redirects ?tab=tests to run benchmark", () => {
    expect(resolveLegacyTab("tests")).toEqual({ tab: "run", mode: "benchmark" });
  });

  it("redirects ?tab=trigger and ?tab=activation to run activation", () => {
    expect(resolveLegacyTab("trigger")).toEqual({ tab: "run", mode: "activation" });
    expect(resolveLegacyTab("activation")).toEqual({ tab: "run", mode: "activation" });
  });

  it("redirects ?tab=versions to history versions view", () => {
    expect(resolveLegacyTab("versions")).toEqual({ tab: "history", view: "versions" });
  });

  it("redirects ?tab=leaderboard to history models view", () => {
    expect(resolveLegacyTab("leaderboard")).toEqual({ tab: "history", view: "models" });
  });

  it("redirects ?tab=editor to the new edit tab", () => {
    expect(resolveLegacyTab("editor")).toEqual({ tab: "edit" });
  });

  it("returns identity for known new ids", () => {
    expect(resolveLegacyTab("overview")).toEqual({ tab: "overview" });
    expect(resolveLegacyTab("edit")).toEqual({ tab: "edit" });
    expect(resolveLegacyTab("run")).toEqual({ tab: "run" });
    expect(resolveLegacyTab("history")).toEqual({ tab: "history" });
  });

  it("returns null for unknown tokens", () => {
    expect(resolveLegacyTab("not-a-tab")).toBeNull();
    expect(resolveLegacyTab(null)).toBeNull();
    expect(resolveLegacyTab("")).toBeNull();
  });
});

describe("readInitialTabFromSearch (0792 T-014)", () => {
  it("prefers ?tab= over legacy ?panel=", () => {
    expect(readInitialTabFromSearch("?tab=edit&panel=tests")).toEqual({ tab: "edit" });
  });

  it("falls back to legacy ?panel= when ?tab= is absent", () => {
    expect(readInitialTabFromSearch("?panel=trigger")).toEqual({ tab: "run", mode: "activation" });
    expect(readInitialTabFromSearch("?panel=versions")).toEqual({ tab: "history", view: "versions" });
  });

  it("returns overview when neither param is present", () => {
    expect(readInitialTabFromSearch("")).toEqual({ tab: "overview" });
  });

  it("returns overview when an unknown value is provided", () => {
    expect(readInitialTabFromSearch("?tab=garbage")).toEqual({ tab: "overview" });
  });
});

describe("panelIdToDetail (0792 T-013)", () => {
  it("maps tests/editor/deps to the edit tab", () => {
    expect(panelIdToDetail("editor")).toEqual({ tab: "edit" });
    expect(panelIdToDetail("tests")).toEqual({ tab: "edit" });
    expect(panelIdToDetail("deps")).toEqual({ tab: "edit" });
  });

  it("maps run to run benchmark mode", () => {
    expect(panelIdToDetail("run")).toEqual({ tab: "run", mode: "benchmark" });
  });

  it("maps activation to run activation mode", () => {
    expect(panelIdToDetail("activation")).toEqual({ tab: "run", mode: "activation" });
  });

  it("maps history/leaderboard/versions to history with the right view", () => {
    expect(panelIdToDetail("history")).toEqual({ tab: "history", view: "timeline" });
    expect(panelIdToDetail("leaderboard")).toEqual({ tab: "history", view: "models" });
    expect(panelIdToDetail("versions")).toEqual({ tab: "history", view: "versions" });
  });
});
