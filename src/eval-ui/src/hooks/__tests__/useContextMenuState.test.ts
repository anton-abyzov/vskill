// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// T-064: useContextMenuState — pure helpers for the shared context-menu
// anchor. Extracting the reducer-level logic into a hook-free module lets
// us unit-test the state transitions without React's render context.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  closedContextMenuState,
  openContextMenuAt,
  handleContextMenuAction,
} from "../useContextMenuState";
import type { SkillInfo } from "../../types";

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "obsidian",
    skill: "obsidian-brain",
    dir: "/Users/test/obsidian-brain",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "source",
    description: null,
    version: null,
    category: null,
    author: null,
    license: null,
    homepage: null,
    tags: null,
    deps: null,
    mcpDeps: null,
    entryPoint: null,
    lastModified: null,
    sizeBytes: null,
    sourceAgent: null,
    ...over,
  };
}

describe("useContextMenuState — state transitions", () => {
  it("closedContextMenuState is the unambiguous closed shape", () => {
    expect(closedContextMenuState).toEqual({ open: false, x: 0, y: 0, skill: null });
  });

  it("openContextMenuAt captures cursor coords + skill", () => {
    const s = makeSkill();
    const next = openContextMenuAt({ clientX: 40, clientY: 120 }, s);
    expect(next.open).toBe(true);
    expect(next.x).toBe(40);
    expect(next.y).toBe(120);
    expect(next.skill).toBe(s);
  });
});

describe("useContextMenuState — handleContextMenuAction", () => {
  beforeEach(() => {
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("copy-path writes skill.dir to the clipboard + dispatches toast", () => {
    const s = makeSkill({ dir: "/tmp/obsidian-brain" });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    handleContextMenuAction("copy-path", s);
    expect(
      (navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> }).writeText,
    ).toHaveBeenCalledWith("/tmp/obsidian-brain");
    const toastEvent = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent => e instanceof CustomEvent && e.type === "studio:toast");
    expect(toastEvent).toBeTruthy();
    const detail = toastEvent!.detail as { message: string; severity: string };
    expect(detail.message).toMatch(/copied/i);
    dispatchSpy.mockRestore();
  });

  it("open fires a placeholder 'Not available' info toast", async () => {
    const s = makeSkill();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    handleContextMenuAction("open", s);
    const toastEvent = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent => e instanceof CustomEvent && e.type === "studio:toast");
    expect(toastEvent).toBeTruthy();
    // strings.actions.editPlaceholder is the canonical copy — assert the
    // toast uses it rather than hard-coding a substring.
    const { strings } = await import("../../strings");
    expect(String((toastEvent!.detail as { message: string }).message)).toBe(strings.actions.editPlaceholder);
    dispatchSpy.mockRestore();
  });

  it("unknown action is a silent no-op", () => {
    const s = makeSkill();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    // Pass a string that is not a known ContextMenuAction to exercise the
    // default/silent-no-op branch. The router accepts `ContextMenuAction | string`.
    handleContextMenuAction("does-not-exist", s);
    const toast = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e) => e instanceof CustomEvent && (e as CustomEvent).type === "studio:toast");
    expect(toast).toBeFalsy();
    dispatchSpy.mockRestore();
  });
});

