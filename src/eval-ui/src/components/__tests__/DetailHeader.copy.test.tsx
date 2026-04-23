// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// T-065 / T-066: DetailHeader copy affordance + toast
// ---------------------------------------------------------------------------
// Covers:
//   T-065 — Clicking the Copy button copies skill.dir to the clipboard AND
//           dispatches a `studio:toast` CustomEvent with the canonical
//           "Path copied." copy from strings.ts. App.tsx forwards that
//           event into the real ToastProvider (see App.tsx T-065).
//   T-066 — The path chip itself is a button with its own onClick that
//           performs the same copy + toast action. Cursor: pointer, and
//           a descriptive aria-label.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
}));

import { DetailHeader } from "../DetailHeader";
import type { SkillInfo } from "../../types";
import { strings } from "../../strings";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function findAll(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findAll(c, match));
  const el = node as ReactEl;
  const out: ReactEl[] = [];
  if (el.type != null && match(el)) out.push(el);
  if (el.props?.children != null) out.push(...findAll(el.props.children, match));
  return out;
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "obsidian",
    skill: "obsidian-brain",
    dir: "/Users/test/skills/obsidian-brain",
    hasEvals: true,
    hasBenchmark: true,
    evalCount: 5,
    assertionCount: 20,
    benchmarkStatus: "pass",
    lastBenchmark: null,
    origin: "source",
    description: null,
    version: "1.3.0",
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

beforeEach(() => {
  Object.defineProperty(global.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

// ---------------------------------------------------------------------------
// T-065 — Copy button fires a toast via the studio:toast bridge
// ---------------------------------------------------------------------------
describe("T-065 DetailHeader — copy button toast", () => {
  it("clicking Copy dispatches a studio:toast CustomEvent with the canonical pathCopied message", async () => {
    const skill = makeSkill({ dir: "/a/b/c/obsidian-brain" });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const tree = DetailHeader({ skill });
    const btn = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "detail-header-copy-path";
    })[0];
    expect(btn).toBeTruthy();
    await (btn.props.onClick as () => Promise<void> | void)();
    expect(
      (navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> }).writeText,
    ).toHaveBeenCalledWith("/a/b/c/obsidian-brain");
    const toastEvent = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent => e instanceof CustomEvent && e.type === "studio:toast");
    expect(toastEvent).toBeTruthy();
    expect((toastEvent!.detail as { message: string }).message).toBe(strings.toasts.pathCopied);
    dispatchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// T-066 — Path chip itself is clickable (same action as the Copy button)
// ---------------------------------------------------------------------------
describe("T-066 DetailHeader — clickable path chip", () => {
  it("the path chip is a button with its own onClick handler and descriptive aria-label", () => {
    const skill = makeSkill({ dir: "/a/b/c/obsidian-brain" });
    const tree = DetailHeader({ skill });
    const chip = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "detail-header-path-chip";
    })[0];
    expect(chip).toBeTruthy();
    // Accept <button> or element with onClick handler to keep the assertion
    // resilient to implementation choice.
    const attrs = chip.props as Record<string, unknown>;
    expect(typeof attrs.onClick).toBe("function");
    expect(String(attrs["aria-label"] ?? "")).toMatch(/copy/i);
  });

  it("clicking the path chip copies the path AND dispatches a toast", async () => {
    const skill = makeSkill({ dir: "/tmp/obsidian-brain" });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const tree = DetailHeader({ skill });
    const chip = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "detail-header-path-chip";
    })[0];
    await (chip.props.onClick as () => Promise<void> | void)();
    expect(
      (navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> }).writeText,
    ).toHaveBeenCalledWith("/tmp/obsidian-brain");
    const toastEvent = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent => e instanceof CustomEvent && e.type === "studio:toast");
    expect(toastEvent).toBeTruthy();
    expect((toastEvent!.detail as { message: string }).message).toBe(strings.toasts.pathCopied);
    dispatchSpy.mockRestore();
  });

  it("the path chip style has cursor: pointer (clickable affordance)", () => {
    const skill = makeSkill();
    const tree = DetailHeader({ skill });
    const chip = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "detail-header-path-chip";
    })[0];
    const style = chip.props.style as Record<string, string>;
    expect(String(style.cursor ?? "")).toBe("pointer");
  });
});
