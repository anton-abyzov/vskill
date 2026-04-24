// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0688 T-019: FLIP motion lib unit tests.
//
// Contract:
//   - captureRect(skill) returns the bounding rect of the row matching
//     [data-skill-id="<plugin>/<skill>"], or null when absent.
//   - runFlip(skill, first):
//       * no-op when first is null
//       * no-op when prefers-reduced-motion: reduce
//       * calls element.animate twice (flight + pulse) on the matched row
//   - Supports being called with arbitrary {plugin, skill} shape (no full
//     SkillInfo required) so callers can stub in tests.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureRect, runFlip } from "../flip";

function mountRow(plugin: string, skill: string): HTMLElement {
  const el = document.createElement("button");
  el.setAttribute("data-skill-id", `${plugin}/${skill}`);
  document.body.appendChild(el);
  return el;
}

let originalMatchMedia: typeof window.matchMedia | undefined;

beforeEach(() => {
  document.body.innerHTML = "";
  originalMatchMedia = window.matchMedia;
  // Default: motion enabled.
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia!;
  document.body.innerHTML = "";
});

describe("captureRect", () => {
  it("returns null when no row is mounted", () => {
    expect(captureRect({ plugin: "p", skill: "missing" })).toBeNull();
  });

  it("returns the bounding rect of the matched row", () => {
    const el = mountRow("p", "s");
    el.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 100, height: 36,
      top: 100, left: 50, right: 150, bottom: 136,
      toJSON: () => ({}),
    });
    const rect = captureRect({ plugin: "p", skill: "s" });
    expect(rect?.top).toBe(100);
    expect(rect?.left).toBe(50);
  });
});

describe("runFlip", () => {
  it("returns immediately when first is null", () => {
    const el = mountRow("p", "s");
    const animate = vi.fn();
    el.animate = animate as unknown as HTMLElement["animate"];
    runFlip({ plugin: "p", skill: "s" }, null);
    expect(animate).not.toHaveBeenCalled();
  });

  it("returns immediately when prefers-reduced-motion: reduce", () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    const el = mountRow("p", "s");
    const animate = vi.fn();
    el.animate = animate as unknown as HTMLElement["animate"];
    el.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 100, height: 36,
      top: 200, left: 50, right: 150, bottom: 236,
      toJSON: () => ({}),
    });
    const first = new DOMRect(50, 100, 100, 36);
    runFlip({ plugin: "p", skill: "s" }, first);
    expect(animate).not.toHaveBeenCalled();
  });

  it("returns silently when row no longer in DOM", () => {
    const first = new DOMRect(50, 100, 100, 36);
    expect(() => runFlip({ plugin: "p", skill: "missing" }, first)).not.toThrow();
  });

  it("returns when delta is zero (no movement)", () => {
    const el = mountRow("p", "s");
    const animate = vi.fn();
    el.animate = animate as unknown as HTMLElement["animate"];
    el.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 100, height: 36,
      top: 100, left: 50, right: 150, bottom: 136,
      toJSON: () => ({}),
    });
    const first = new DOMRect(50, 100, 100, 36);
    runFlip({ plugin: "p", skill: "s" }, first);
    expect(animate).not.toHaveBeenCalled();
  });

  it("calls element.animate for the flight animation when delta > 0", () => {
    const el = mountRow("p", "s");
    const fakeAnim = { onfinish: null as null | (() => void) };
    const animate = vi.fn(() => fakeAnim);
    el.animate = animate as unknown as HTMLElement["animate"];
    el.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 100, height: 36,
      top: 300, left: 50, right: 150, bottom: 336,
      toJSON: () => ({}),
    });
    const first = new DOMRect(50, 100, 100, 36);
    runFlip({ plugin: "p", skill: "s" }, first);
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    expect(keyframes[0].transform).toBe("translate(0px, -200px)");
    expect(keyframes[1].transform).toBe("translate(0, 0)");
    expect(options.duration).toBe(350);
  });

  it("triggers a pulse animation after flight finishes", () => {
    const el = mountRow("p", "s");
    const flight = { onfinish: null as null | (() => void) };
    const pulse = { onfinish: null as null | (() => void) };
    let call = 0;
    const animate = vi.fn(() => (call++ === 0 ? flight : pulse));
    el.animate = animate as unknown as HTMLElement["animate"];
    el.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 100, height: 36,
      top: 300, left: 50, right: 150, bottom: 336,
      toJSON: () => ({}),
    });
    const first = new DOMRect(50, 100, 100, 36);
    runFlip({ plugin: "p", skill: "s" }, first);
    expect(animate).toHaveBeenCalledTimes(1);
    // Simulate flight completion → pulse should fire.
    flight.onfinish?.();
    expect(animate).toHaveBeenCalledTimes(2);
  });
});
