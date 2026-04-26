// @vitest-environment jsdom
// 0778 US-002 + US-003 — UpdateBell amber state when platform is degraded.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stub asset to avoid Vite asset-loader collisions.
vi.mock("../../assets/icons/update-bell.svg", () => ({ default: "stub-bell.svg" }));

// Stub toast.
vi.mock("../ToastProvider", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), clear: vi.fn() }),
}));

// Mock platform health hook so each test can set the state.
const platformHealth = {
  current: { degraded: false, reason: null as string | null, statsAgeMs: 0, oldestActiveAgeMs: 0 },
};
vi.mock("../../hooks/usePlatformHealth", () => ({
  usePlatformHealth: () => ({ data: platformHealth.current, loading: false }),
}));

// Real UpdateDropdown is mounted so the banner branch is exercised end-to-end.
vi.mock("../../StudioContext", () => ({
  useStudio: () => ({
    updateCount: 0,
    updates: [],
    isRefreshingUpdates: false,
    refreshUpdates: vi.fn(() => Promise.resolve()),
    selectSkill: vi.fn(),
    revealSkill: vi.fn(),
    skills: [],
    updatesById: undefined,
    activeAgent: "claude-code",
    onSkillUpdated: vi.fn(),
  }),
}));

async function mountBell() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { UpdateBell } = await import("../UpdateBell");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(UpdateBell)); });
  // Flush Suspense + microtasks so the lazy UpdateDropdown mounts.
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
  return {
    container,
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe("UpdateBell — platform degraded (0778 US-002, US-003)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    platformHealth.current = { degraded: false, reason: null, statsAgeMs: 0, oldestActiveAgeMs: 0 };
  });
  afterEach(() => vi.clearAllMocks());

  it("AC-US2-01/02/03: degraded=true → bell glyph is amber, aria-label notes it, title attribute set", async () => {
    platformHealth.current = {
      degraded: true,
      reason: "heartbeat stale 2h 4m",
      statsAgeMs: 7_300_000,
      oldestActiveAgeMs: 0,
    };
    const { container, unmount } = await mountBell();
    const btn = container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toMatch(/platform crawler degraded/i);
    expect(btn.getAttribute("title")).toBe(
      "Update checks paused — verified-skill.com crawler is degraded. Your submissions are queued.",
    );
    const svg = container.querySelector("[data-testid='update-bell-icon']") as SVGElement;
    expect(svg).toBeTruthy();
    expect((svg as unknown as HTMLElement).style.color).toContain("--color-own");
    unmount();
  });

  it("AC-US2-04: degraded=false → bell renders unchanged (default aria-label, no title)", async () => {
    platformHealth.current = { degraded: false, reason: null, statsAgeMs: 0, oldestActiveAgeMs: 0 };
    const m = await mountBell();
    const btn = m.container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
    expect(btn.getAttribute("aria-label")).toBe("No updates available");
    expect(btn.getAttribute("title")).toBeNull();
    m.unmount();
  });
});
