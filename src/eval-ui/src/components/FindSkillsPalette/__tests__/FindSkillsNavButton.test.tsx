// @vitest-environment jsdom
// 0741 T-017: FindSkillsNavButton unit tests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountHandle {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

async function mount(): Promise<MountHandle> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { FindSkillsNavButton } = await import("../FindSkillsNavButton");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(FindSkillsNavButton));
  });
  return {
    container,
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

beforeEach(() => {
  // Default to Mac so the SSR + client probes both render ⌘⇧K.
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FindSkillsNavButton — render & ARIA (T-017)", () => {
  it("renders a button with data-testid='find-skills-nav-button'", async () => {
    const h = await mount();
    const btn = h.container.querySelector("[data-testid='find-skills-nav-button']");
    expect(btn).toBeTruthy();
    expect(btn?.tagName).toBe("BUTTON");
    await h.unmount();
  });

  it("uses the spec ARIA label exactly (Mac)", async () => {
    const h = await mount();
    const btn = h.container.querySelector("[data-testid='find-skills-nav-button']");
    expect(btn?.getAttribute("aria-label")).toBe("Find verified skills — opens search (⌘⇧K)");
    await h.unmount();
  });

  it("renders the visible 'Find skills' label", async () => {
    const h = await mount();
    const btn = h.container.querySelector("[data-testid='find-skills-nav-button']");
    expect(btn?.textContent).toContain("Find skills");
    await h.unmount();
  });

  it("renders a search-icon SVG", async () => {
    const h = await mount();
    const svg = h.container.querySelector("svg[data-icon='search']");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.querySelector("circle")).toBeTruthy();
    await h.unmount();
  });
});

describe("FindSkillsNavButton — behavior (T-017)", () => {
  it("clicking dispatches a window CustomEvent('openFindSkills')", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const h = await mount();
    const { act } = await import("react");
    const btn = h.container.querySelector("[data-testid='find-skills-nav-button']") as HTMLElement;
    await act(async () => { btn.click(); });
    const matched = dispatchSpy.mock.calls
      .map(([e]) => e as Event)
      .find((e) => e.type === "openFindSkills");
    expect(matched).toBeDefined();
    expect(matched).toBeInstanceOf(CustomEvent);
    await h.unmount();
  });

  it("renders ⌘⇧K kbd hint on Mac", async () => {
    const h = await mount();
    const kbd = h.container.querySelector("kbd");
    expect(kbd).toBeTruthy();
    expect(kbd?.textContent).toBe("⌘⇧K");
    await h.unmount();
  });

  it("renders Ctrl+Shift+K kbd hint on Win/Linux", async () => {
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 Windows", configurable: true });
    const h = await mount();
    const kbd = h.container.querySelector("kbd");
    expect(kbd?.textContent).toBe("Ctrl+Shift+K");
    await h.unmount();
  });

  it("respects prefers-reduced-motion (kbd not animated)", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((q: string) => ({
        matches: q.includes("prefers-reduced-motion") && q.includes("reduce"),
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const h = await mount();
    const kbd = h.container.querySelector("kbd");
    expect(kbd?.getAttribute("data-animated")).toBe("false");
    await h.unmount();
  });
});
