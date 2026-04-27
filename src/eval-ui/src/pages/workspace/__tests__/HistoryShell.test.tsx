// ---------------------------------------------------------------------------
// 0792 T-011: HistoryShell — wrapper that picks one of three views.
//
// Verifies dispatch to the correct existing panel; panel internals untouched.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";

vi.mock("../HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("../LeaderboardPanel", () => ({ LeaderboardPanel: () => null }));
vi.mock("../VersionHistoryPanel", () => ({ VersionHistoryPanel: () => null }));

import {
  HistoryShell,
  HISTORY_VIEWS,
  isValidHistoryView,
} from "../HistoryShell";
import { HistoryPanel } from "../HistoryPanel";
import { LeaderboardPanel } from "../LeaderboardPanel";
import { VersionHistoryPanel } from "../VersionHistoryPanel";

type ReactEl = { type: unknown; props: Record<string, unknown> };

describe("HistoryShell (0792 T-011)", () => {
  it("renders HistoryPanel for the timeline view", () => {
    const tree = HistoryShell({ view: "timeline" }) as ReactEl;
    expect(tree.type).toBe(HistoryPanel);
  });

  it("renders LeaderboardPanel for the models view", () => {
    const tree = HistoryShell({ view: "models" }) as ReactEl;
    expect(tree.type).toBe(LeaderboardPanel);
  });

  it("renders VersionHistoryPanel for the versions view", () => {
    const tree = HistoryShell({ view: "versions" }) as ReactEl;
    expect(tree.type).toBe(VersionHistoryPanel);
  });

  it("exposes HISTORY_VIEWS with three views in stable order", () => {
    expect(HISTORY_VIEWS.map((v) => v.id)).toEqual(["timeline", "models", "versions"]);
  });

  it("validates history views via isValidHistoryView", () => {
    expect(isValidHistoryView("timeline")).toBe(true);
    expect(isValidHistoryView("models")).toBe(true);
    expect(isValidHistoryView("versions")).toBe(true);
    expect(isValidHistoryView("benchmark")).toBe(false);
    expect(isValidHistoryView("")).toBe(false);
    expect(isValidHistoryView(null)).toBe(false);
  });
});
