// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useContextMenuState — pure helpers for the shared context-menu anchor and
// the side-effecting action router.
//
// 0820 update: open / reveal / edit no longer dispatch the stale
// "Edit lands with 0675…" placeholder. They POST to
// /api/skills/reveal-in-editor and dispatch real success / failure toasts
// based on the response.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  closedContextMenuState,
  openContextMenuAt,
  handleContextMenuAction,
} from "../useContextMenuState";
import type { SkillInfo } from "../../types";
import { strings } from "../../strings";

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

function captureToast(): CustomEvent | undefined {
  return (
    (vi.mocked(window.dispatchEvent).mock.calls
      .map((c) => c[0])
      .find(
        (e): e is CustomEvent =>
          e instanceof CustomEvent && e.type === "studio:toast",
      ))
  );
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

describe("useContextMenuState — handleContextMenuAction (clipboard / no-op)", () => {
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

  it("unknown action is a silent no-op", () => {
    const s = makeSkill();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    handleContextMenuAction("does-not-exist", s);
    const toast = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e) => e instanceof CustomEvent && (e as CustomEvent).type === "studio:toast");
    expect(toast).toBeFalsy();
    dispatchSpy.mockRestore();
  });
});

describe("useContextMenuState — open / reveal / edit (0820 reveal-in-editor)", () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    dispatchSpy = vi.spyOn(window, "dispatchEvent");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dispatchSpy.mockRestore();
  });

  it("reveal POSTs { plugin, skill, file: 'SKILL.md' } and shows opening toast", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, command: "code", args: [] }),
    });
    const s = makeSkill({ plugin: "p", skill: "s" });

    await handleContextMenuAction("reveal", s);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/skills/reveal-in-editor");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ plugin: "p", skill: "s", file: "SKILL.md" });

    const toast = captureToast();
    expect(toast?.detail).toMatchObject({
      message: strings.toasts.openingInEditor,
      severity: "info",
    });
  });

  it("edit shares the reveal payload (file = SKILL.md)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, command: "code", args: [] }),
    });
    const s = makeSkill({ plugin: "p", skill: "s" });

    await handleContextMenuAction("edit", s);

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      plugin: "p",
      skill: "s",
      file: "SKILL.md",
    });
  });

  it("open omits `file` so the server opens the dir", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, command: "code", args: [] }),
    });
    const s = makeSkill({ plugin: "p", skill: "s" });

    await handleContextMenuAction("open", s);

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ plugin: "p", skill: "s" });
  });

  it("500 with body.error='no_editor' → noEditor toast", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "no_editor" }),
    });
    await handleContextMenuAction("reveal", makeSkill());

    const toast = captureToast();
    expect(toast?.detail).toMatchObject({
      message: strings.toasts.noEditor,
      severity: "error",
    });
  });

  it("404 → skillNotFound toast", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "skill_not_found" }),
    });
    await handleContextMenuAction("reveal", makeSkill());

    const toast = captureToast();
    expect(toast?.detail).toMatchObject({
      message: strings.toasts.skillNotFound,
      severity: "error",
    });
  });

  it("network failure → openFailed toast", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await handleContextMenuAction("reveal", makeSkill());

    const toast = captureToast();
    expect(toast?.detail).toMatchObject({
      message: strings.toasts.openFailed,
      severity: "error",
    });
  });

  it("regression: editPlaceholder string is gone and 'lands with 0675' copy is not present anywhere in strings", () => {
    const s = strings as unknown as Record<string, Record<string, string>>;
    expect(s.actions.editPlaceholder).toBeUndefined();
    expect(JSON.stringify(strings)).not.toContain("0675");
    expect(JSON.stringify(strings)).not.toContain("Edit lands with");
  });
});

// ---------------------------------------------------------------------------
// 0828 — clone action opens the CloneToAuthoringDialog by dispatching a
// `studio:request-clone` event. Verifies the dispatcher fires the event with
// the correct skill detail and does NOT call fetch directly (the dialog owns
// the API call and its own success / failure UI states).
// ---------------------------------------------------------------------------
describe("useContextMenuState — clone (0828)", () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    dispatchSpy = vi.spyOn(window, "dispatchEvent");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    dispatchSpy.mockRestore();
  });

  it("dispatches studio:request-clone with skill detail", async () => {
    const s = makeSkill({ plugin: ".claude", skill: "hyperframes-best-practices", origin: "installed" });
    await handleContextMenuAction("clone", s);

    const events = dispatchSpy.mock.calls
      .map((c) => c[0])
      .filter((e): e is CustomEvent => e instanceof CustomEvent && e.type === "studio:request-clone");
    expect(events).toHaveLength(1);
    expect((events[0]!.detail as { skill: SkillInfo }).skill).toBe(s);
  });

  it("does NOT call fetch directly — the dialog owns the API call", async () => {
    await handleContextMenuAction("clone", makeSkill({ origin: "installed" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does NOT fire any toast — the dialog handles its own success/failure states", async () => {
    await handleContextMenuAction("clone", makeSkill({ origin: "installed" }));
    const toastEvents = dispatchSpy.mock.calls
      .map((c) => c[0])
      .filter((e): e is CustomEvent => e instanceof CustomEvent && e.type === "studio:toast");
    expect(toastEvents).toHaveLength(0);
  });
});
