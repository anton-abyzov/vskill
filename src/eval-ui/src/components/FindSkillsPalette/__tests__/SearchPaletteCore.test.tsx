// @vitest-environment jsdom
// 0741 T-006/T-008/T-009/T-010/T-011/T-012/T-013: SearchPaletteCore unit tests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = {
  initialOpen?: boolean;
  onSelect?: (r: unknown, q: string) => void;
  onNavigate?: (href: string) => void;
  searchUrl?: string;
  trendingUrl?: string;
  telemetrySelectUrl?: string;
  maxPages?: number;
};

interface MountHandle {
  container: HTMLElement;
  unmount: () => void;
  rerender: (next: Props) => void;
}

let originalFetch: typeof fetch | undefined;

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mount(props: Props): Promise<MountHandle> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { default: SearchPaletteCore } = await import("../SearchPaletteCore");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(SearchPaletteCore, props));
  });
  return {
    container,
    rerender(next) {
      act(() => root.render(React.createElement(SearchPaletteCore, next)));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushMicrotasks() {
  const { act } = await import("react");
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function mockFetchImpl(impl: (url: string, init?: RequestInit) => Promise<unknown>) {
  globalThis.fetch = vi.fn().mockImplementation(impl) as unknown as typeof fetch;
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function statusResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  // jsdom default: IntersectionObserver missing — install a controllable stub.
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
});

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("SearchPaletteCore — T-008 ARIA + render contract", () => {
  it("renders nothing when not opened", async () => {
    mockFetchImpl(async () => jsonResponse({ trendingSkills: [] }));
    const h = await mount({ initialOpen: false });
    expect(h.container.querySelector("[data-testid='find-skills-palette']")).toBeNull();
    h.unmount();
  });

  it("renders dialog/combobox/listbox roles when open", async () => {
    mockFetchImpl(async () => jsonResponse({ trendingSkills: [] }));
    const h = await mount({ initialOpen: true });
    expect(h.container.querySelector("[role='dialog']")).toBeTruthy();
    expect(h.container.querySelector("[role='combobox']")).toBeTruthy();
    expect(h.container.querySelector("[role='listbox']")).toBeTruthy();
    h.unmount();
  });
});

describe("SearchPaletteCore — T-009 trending fetch on empty query", () => {
  it("fetches trending from the configured trendingUrl on mount", async () => {
    const fetchSpy = mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) return jsonResponse({ trendingSkills: [] });
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true });
    await flushMicrotasks();
    const calls = fetchSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((u) => String(u).includes("/api/v1/stats"))).toBe(true);
    h.unmount();
  });

  it("renders trending entries as skill rows when present", async () => {
    mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) {
        return jsonResponse({
          trendingSkills: [
            { name: "owner/repo/cool", displayName: "Cool Skill", author: "owner", repoUrl: "https://github.com/owner/repo", certTier: "VERIFIED", ownerSlug: "owner", repoSlug: "repo", skillSlug: "cool" },
          ],
        });
      }
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true });
    await flushMicrotasks();
    expect(h.container.textContent).toContain("cool");
    h.unmount();
  });
});

describe("SearchPaletteCore — T-010 debounced search + AbortController", () => {
  it("does NOT issue a search before 150ms debounce elapses", async () => {
    vi.useFakeTimers();
    const fetchSpy = mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) return jsonResponse({ trendingSkills: [] });
      if (url.includes("/api/v1/studio/search")) return jsonResponse({ results: [], pagination: { hasMore: false } });
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true });
    await vi.advanceTimersByTimeAsync(60); // skip the open-focus setTimeout(50ms)
    const input = h.container.querySelector("input") as HTMLInputElement;
    const { act } = await import("react");
    await act(async () => { setInputValue(input, "obs"); });
    // Before the debounce elapses, no search call should fire.
    await vi.advanceTimersByTimeAsync(100);
    const searchCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/api/v1/studio/search"));
    expect(searchCalls.length).toBe(0);
    vi.useRealTimers();
    h.unmount();
  });

  it("issues exactly one search after 150ms debounce settles", async () => {
    vi.useFakeTimers();
    const fetchSpy = mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) return jsonResponse({ trendingSkills: [] });
      if (url.includes("/api/v1/studio/search")) return jsonResponse({ results: [], pagination: { hasMore: false } });
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true });
    await vi.advanceTimersByTimeAsync(60);
    const input = h.container.querySelector("input") as HTMLInputElement;
    const { act } = await import("react");
    await act(async () => { setInputValue(input, "obs"); });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160);
    });
    const searchCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/api/v1/studio/search"));
    expect(searchCalls.length).toBe(1);
    expect(String(searchCalls[0][0])).toContain("q=obs");
    expect(String(searchCalls[0][0])).toContain("limit=20");
    vi.useRealTimers();
    h.unmount();
  });

  it("aborts the in-flight search when query changes mid-debounce", async () => {
    vi.useFakeTimers();
    const aborts: string[] = [];
    mockFetchImpl((url, init) => {
      const signal = (init as { signal?: AbortSignal })?.signal;
      if (signal) signal.addEventListener("abort", () => aborts.push(String(url)));
      return new Promise(() => { /* never resolve — mimics in-flight */ });
    });
    const h = await mount({ initialOpen: true });
    await vi.advanceTimersByTimeAsync(60);
    const input = h.container.querySelector("input") as HTMLInputElement;
    const { act } = await import("react");
    await act(async () => { setInputValue(input, "obs"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(155); });
    // A search should now be in-flight. Mutate the query — this should abort it.
    await act(async () => { setInputValue(input, "obsi"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    expect(aborts.some((u) => u.includes("q=obs") && !u.includes("q=obsi"))).toBe(true);
    vi.useRealTimers();
    h.unmount();
  });
});

describe("SearchPaletteCore — T-011 hard cap pagination", () => {
  it("renders the 'See all on verified-skill.com' link once maxPages reached", async () => {
    // Simulate 10 pages already loaded by piggybacking maxPages=1 → first page fills the cap.
    mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) return jsonResponse({ trendingSkills: [] });
      if (url.includes("/api/v1/studio/search")) {
        return jsonResponse({
          results: [{ name: "a/b/c", author: "a", certTier: "VERIFIED", repoUrl: "https://github.com/a/b" }],
          pagination: { hasMore: true },
        });
      }
      return jsonResponse({});
    });
    vi.useFakeTimers();
    const h = await mount({ initialOpen: true, maxPages: 1 });
    await vi.advanceTimersByTimeAsync(60);
    const input = h.container.querySelector("input") as HTMLInputElement;
    const { act } = await import("react");
    await act(async () => { setInputValue(input, "ab"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    await flushMicrotasks();
    // Hard cap reached on the first page (maxPages=1) — the sentinel is gone
    // and the platform link appears.
    expect(h.container.querySelector("[data-testid='hard-cap-link']")).toBeTruthy();
    expect(h.container.querySelector("[data-testid='scroll-sentinel']")).toBeNull();
    const link = h.container.querySelector("[data-testid='hard-cap-link'] a") as HTMLAnchorElement;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("href")).toContain("verified-skill.com");
    vi.useRealTimers();
    h.unmount();
  });
});

describe("SearchPaletteCore — T-012 keyboard nav + type-to-search-from-anywhere", () => {
  it("ArrowDown advances aria-selected on result rows", async () => {
    mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) {
        return jsonResponse({
          trendingSkills: [
            { name: "a/b/one", displayName: "one", author: "a", repoUrl: "https://github.com/a/b", certTier: "VERIFIED" },
            { name: "a/b/two", displayName: "two", author: "a", repoUrl: "https://github.com/a/b", certTier: "VERIFIED" },
            { name: "a/b/three", displayName: "three", author: "a", repoUrl: "https://github.com/a/b", certTier: "VERIFIED" },
          ],
        });
      }
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true });
    await flushMicrotasks();
    const { act } = await import("react");
    const input = h.container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const options = h.container.querySelectorAll("[role='option']");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    h.unmount();
  });

  it("Enter on a skill row fires onSelect with the skill + current query", async () => {
    const onSelect = vi.fn();
    mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) {
        return jsonResponse({
          trendingSkills: [
            { name: "a/b/one", displayName: "one", author: "a", repoUrl: "https://github.com/a/b", certTier: "VERIFIED" },
          ],
        });
      }
      if (url.includes("/api/v1/studio/telemetry")) return jsonResponse({});
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true, onSelect });
    await flushMicrotasks();
    const { act } = await import("react");
    const input = h.container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].name).toBe("a/b/one");
    h.unmount();
  });

  it("Escape closes the palette", async () => {
    mockFetchImpl(async () => jsonResponse({ trendingSkills: [] }));
    const h = await mount({ initialOpen: true });
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(h.container.querySelector("[data-testid='find-skills-palette']")).toBeNull();
    h.unmount();
  });

  it("type-to-search outside an input opens the palette pre-filled", async () => {
    mockFetchImpl(async () => jsonResponse({ trendingSkills: [] }));
    const h = await mount({ initialOpen: false });
    const { act } = await import("react");
    await act(async () => {
      // target is body — not interactive, so the global handler accepts it.
      const evt = new KeyboardEvent("keydown", { key: "z", bubbles: true });
      Object.defineProperty(evt, "target", { value: document.body, configurable: true });
      window.dispatchEvent(evt);
    });
    await flushMicrotasks();
    const input = h.container.querySelector("input") as HTMLInputElement | null;
    expect(input?.value).toBe("z");
    h.unmount();
  });

  it("ignores `openSearch` events (those belong to the existing CommandPalette)", async () => {
    mockFetchImpl(async () => jsonResponse({ trendingSkills: [] }));
    const h = await mount({ initialOpen: false });
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("openSearch"));
    });
    expect(h.container.querySelector("[data-testid='find-skills-palette']")).toBeNull();
    h.unmount();
  });

  it("opens on `openFindSkills` CustomEvent dispatch", async () => {
    mockFetchImpl(async () => jsonResponse({ trendingSkills: [] }));
    const h = await mount({ initialOpen: false });
    const { act } = await import("react");
    await act(async () => {
      window.dispatchEvent(new CustomEvent("openFindSkills"));
    });
    expect(h.container.querySelector("[data-testid='find-skills-palette']")).toBeTruthy();
    h.unmount();
  });
});

describe("SearchPaletteCore — T-013 MiniTierBadge + BLOCKED/TAINTED rendering", () => {
  it("renders MiniTierBadge=VERIFIED for clean skills", async () => {
    mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) {
        return jsonResponse({
          trendingSkills: [
            { name: "a/b/clean", displayName: "clean", author: "a", repoUrl: "https://github.com/a/b", certTier: "VERIFIED" },
          ],
        });
      }
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true });
    await flushMicrotasks();
    const badge = h.container.querySelector("[data-testid='mini-tier-badge']");
    expect(badge?.getAttribute("data-tier")).toBe("VERIFIED");
    h.unmount();
  });

  it("renders BLOCKED chip for blocked skills (overrides certTier)", async () => {
    vi.useFakeTimers();
    mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) return jsonResponse({ trendingSkills: [] });
      if (url.includes("/api/v1/studio/search")) {
        return jsonResponse({
          results: [{ name: "x/y/bad", author: "x", certTier: "VERIFIED", repoUrl: "https://github.com/x/y", isBlocked: true }],
          pagination: { hasMore: false },
        });
      }
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true });
    await vi.advanceTimersByTimeAsync(60);
    const input = h.container.querySelector("input") as HTMLInputElement;
    const { act } = await import("react");
    await act(async () => { setInputValue(input, "ba"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    await flushMicrotasks();
    const badge = h.container.querySelector("[data-testid='mini-tier-badge']");
    expect(badge?.getAttribute("data-tier")).toBe("BLOCKED");
    vi.useRealTimers();
    h.unmount();
  });

  it("renders TAINTED chip when isTainted=true", async () => {
    vi.useFakeTimers();
    mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) return jsonResponse({ trendingSkills: [] });
      if (url.includes("/api/v1/studio/search")) {
        return jsonResponse({
          results: [{ name: "x/y/maybe", author: "x", certTier: "VERIFIED", repoUrl: "https://github.com/x/y", isTainted: true }],
          pagination: { hasMore: false },
        });
      }
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true });
    await vi.advanceTimersByTimeAsync(60);
    const input = h.container.querySelector("input") as HTMLInputElement;
    const { act } = await import("react");
    await act(async () => { setInputValue(input, "ma"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    await flushMicrotasks();
    const badge = h.container.querySelector("[data-testid='mini-tier-badge']");
    expect(badge?.getAttribute("data-tier")).toBe("TAINTED");
    vi.useRealTimers();
    h.unmount();
  });
});

describe("SearchPaletteCore — telemetry + sanitized highlight", () => {
  it("fires fire-and-forget telemetry on result selection (T-027 partial)", async () => {
    const fetchSpy = mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) {
        return jsonResponse({
          trendingSkills: [
            { name: "a/b/one", displayName: "one", author: "a", repoUrl: "https://github.com/a/b", certTier: "VERIFIED" },
          ],
        });
      }
      if (url.includes("/api/v1/studio/telemetry/search-select")) return jsonResponse({});
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true });
    await flushMicrotasks();
    const { act } = await import("react");
    const row = h.container.querySelector("[role='option']") as HTMLElement;
    await act(async () => { row.click(); });
    const telemetryCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/api/v1/studio/telemetry/search-select"));
    expect(telemetryCalls.length).toBe(1);
    const init = telemetryCalls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toMatchObject({ skillName: "a/b/one" });
    h.unmount();
  });

  it("telemetry rejection does NOT block onSelect navigation (T-027)", async () => {
    const onSelect = vi.fn();
    mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) {
        return jsonResponse({
          trendingSkills: [
            { name: "a/b/one", displayName: "one", author: "a", repoUrl: "https://github.com/a/b", certTier: "VERIFIED" },
          ],
        });
      }
      if (url.includes("/api/v1/studio/telemetry/search-select")) return statusResponse(500);
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true, onSelect });
    await flushMicrotasks();
    const { act } = await import("react");
    const row = h.container.querySelector("[role='option']") as HTMLElement;
    await act(async () => { row.click(); });
    // onSelect still fires even though the telemetry endpoint 500s.
    expect(onSelect).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("renders an inline retry on 5xx without crashing the palette", async () => {
    vi.useFakeTimers();
    mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) return jsonResponse({ trendingSkills: [] });
      if (url.includes("/api/v1/studio/search")) return statusResponse(502);
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true });
    await vi.advanceTimersByTimeAsync(60);
    const input = h.container.querySelector("input") as HTMLInputElement;
    const { act } = await import("react");
    await act(async () => { setInputValue(input, "ob"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    await flushMicrotasks();
    expect(h.container.querySelector("[data-testid='find-skills-palette']")).toBeTruthy();
    expect(h.container.querySelector("[data-testid='search-retry']")).toBeTruthy();
    vi.useRealTimers();
    h.unmount();
  });

  it("sanitizes server-supplied highlights (no <script> in DOM)", async () => {
    vi.useFakeTimers();
    mockFetchImpl(async (url) => {
      if (url.includes("/api/v1/stats")) return jsonResponse({ trendingSkills: [] });
      if (url.includes("/api/v1/studio/search")) {
        return jsonResponse({
          results: [{ name: "x/y/z", author: "x", certTier: "VERIFIED", repoUrl: "https://github.com/x/y", highlight: "<script>alert(1)</script>safe <b>match</b>" }],
          pagination: { hasMore: false },
        });
      }
      return jsonResponse({});
    });
    const h = await mount({ initialOpen: true });
    await vi.advanceTimersByTimeAsync(60);
    const input = h.container.querySelector("input") as HTMLInputElement;
    const { act } = await import("react");
    await act(async () => { setInputValue(input, "ma"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    await flushMicrotasks();
    const hl = h.container.querySelector("[data-testid='search-highlight']");
    expect(hl?.querySelector("script")).toBeNull();
    expect(hl?.querySelector("b")?.textContent).toBe("match");
    vi.useRealTimers();
    h.unmount();
  });
});
