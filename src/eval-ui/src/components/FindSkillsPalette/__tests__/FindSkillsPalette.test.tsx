// @vitest-environment jsdom
// 0741 T-014/T-015: FindSkillsPalette shell tests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let originalFetch: typeof fetch | undefined;

interface MountHandle {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

async function mount(props: { onSelect?: (...args: unknown[]) => void } = {}): Promise<MountHandle> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { FindSkillsPalette } = await import("../FindSkillsPalette");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(FindSkillsPalette, props));
  });
  return {
    container,
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

async function flushMicrotasks(rounds = 30) {
  const { act } = await import("react");
  await act(async () => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
  });
}

/** Real macrotask wait — needed for React.lazy() chunk resolution under jsdom. */
async function waitMs(ms: number) {
  const { act } = await import("react");
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, ms));
  });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockImplementation(async () => jsonResponse({ trendingSkills: [] })) as unknown as typeof fetch;
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
  // Reset sessionStorage
  try { window.sessionStorage.clear(); } catch { /* noop */ }
});

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("FindSkillsPalette shell — T-014 lazy + closed-by-default", () => {
  it("renders nothing when closed", async () => {
    const h = await mount();
    expect(h.container.querySelector("[data-testid='find-skills-palette-shell']")).toBeNull();
    expect(h.container.querySelector("[data-testid='find-skills-palette']")).toBeNull();
    await h.unmount();
  });

  it("opens on `openFindSkills` CustomEvent", async () => {
    const h = await mount();
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("openFindSkills"));
    });
    await flushMicrotasks();
    await waitMs(80);
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='find-skills-palette-shell']")).toBeTruthy();
    await h.unmount();
  });

  it("does NOT open on `openSearch` (CommandPalette event)", async () => {
    const h = await mount();
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("openSearch"));
    });
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='find-skills-palette-shell']")).toBeNull();
    await h.unmount();
  });

  it("closes when Esc is pressed", async () => {
    const h = await mount();
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("openFindSkills"));
    });
    await flushMicrotasks();
    await waitMs(80);
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='find-skills-palette-shell']")).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='find-skills-palette-shell']")).toBeNull();
    await h.unmount();
  });
});

describe("FindSkillsPalette shell — onSelect persists query + invokes callback", () => {
  it("forwards onSelect from inner core and writes sessionStorage[find-skills:last-query]", async () => {
    const onSelect = vi.fn();
    // Make the trending fetch return a known result so the inner palette
    // renders a clickable row.
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/v1/stats")) {
        return jsonResponse({
          trendingSkills: [
            { name: "a/b/one", displayName: "one", author: "a", repoUrl: "https://github.com/a/b", certTier: "VERIFIED", ownerSlug: "a", repoSlug: "b", skillSlug: "one" },
          ],
        });
      }
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const h = await mount({ onSelect });
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("openFindSkills"));
    });
    // Lazy load the inner SearchPaletteCore + trending fetch resolution +
    // re-render — give it plenty of microtask rounds.
    const row = h.container.querySelector("[role='option']") as HTMLElement | null;
    expect(row).toBeTruthy();
    await act(async () => { row!.click(); });
    await flushMicrotasks();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].name).toBe("a/b/one");
    // Query was empty when selected → sessionStorage entry should be empty string.
    expect(window.sessionStorage.getItem("find-skills:last-query")).toBe("");
    await h.unmount();
  });
});

describe("FindSkillsPalette shell — prefers-reduced-motion", () => {
  it("emits data-reduced-motion='true' when reduce is preferred", async () => {
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
    const { act } = await import("react");
    await act(async () => { window.dispatchEvent(new CustomEvent("openFindSkills")); });
    await flushMicrotasks();
    const shell = h.container.querySelector("[data-testid='find-skills-palette-shell']");
    expect(shell?.getAttribute("data-reduced-motion")).toBe("true");
    await h.unmount();
  });
});
