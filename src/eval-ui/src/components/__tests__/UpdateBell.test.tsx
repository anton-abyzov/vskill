// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stub the SVG asset — Vitest's default resolver doesn't run Vite asset loaders.
vi.mock("../../assets/icons/update-bell.svg", () => ({ default: "stub-bell.svg" }));

// 0778: stub the platform-health hook so its fetch loop doesn't keep this
// test's microtask queue alive forever (which manifests as worker OOM).
vi.mock("../../hooks/usePlatformHealth", () => ({
  usePlatformHealth: () => ({
    data: { degraded: false, reason: null, statsAgeMs: 0, oldestActiveAgeMs: 0 },
    loading: false,
  }),
}));

// 0747 T-006: UpdateBell now consumes useToast for the no-match owning-agent
// fallback. Tests that don't render <ToastProvider> must stub it.
vi.mock("../ToastProvider", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), clear: vi.fn() }),
}));

// Replace the lazy-loaded dropdown with a synchronous stub. The lazy path
// is validated separately via the source-inspection contract in
// `__tests__/update-bell.lazy.test.ts`.
vi.mock("../UpdateDropdown", () => ({
  default: (props: { onClose: () => void }) => {
    const React = require("react");
    return React.createElement(
      "div",
      { "data-testid": "update-dropdown", role: "dialog" },
      React.createElement(
        "button",
        { onClick: props.onClose, "data-testid": "stub-close" },
        "close",
      ),
    );
  },
}));

interface StudioStub {
  updateCount: number;
  updates: Array<{ name: string; installed: string; latest: string | null; updateAvailable: boolean }>;
  isRefreshingUpdates: boolean;
  refreshUpdates: () => Promise<void>;
  selectSkill: (s: { plugin: string; skill: string; origin: "source" | "installed" }) => void;
  // 0766 F-002: post-update invalidation helper consumed by lazy-mounted
  // UpdateDropdown.
  onSkillUpdated: (plugin: string, skill: string) => void;
}

let stub: StudioStub = {
  updateCount: 0,
  updates: [],
  isRefreshingUpdates: false,
  refreshUpdates: vi.fn(() => Promise.resolve()),
  selectSkill: vi.fn(),
  // 0766 F-002: UpdateDropdown (lazy-mounted by UpdateBell when opened)
  // depends on onSkillUpdated for post-update invalidation.
  onSkillUpdated: vi.fn(),
};

vi.mock("../../StudioContext", () => ({
  useStudio: () => stub,
}));

async function mountBell() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { UpdateBell } = await import("../UpdateBell");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(UpdateBell));
  });
  return {
    container,
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    rerender: async () => {
      await act(async () => {
        root.render(React.createElement(UpdateBell));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("UpdateBell (0683 T-006)", () => {
  beforeEach(() => {
    stub = {
      updateCount: 0,
      updates: [],
      isRefreshingUpdates: false,
      refreshUpdates: vi.fn(() => Promise.resolve()),
      selectSkill: vi.fn(),
    };
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders no badge when updateCount is 0", async () => {
    stub.updateCount = 0;
    const h = await mountBell();
    try {
      expect(h.container.querySelector("[data-testid='update-bell-badge']")).toBeFalsy();
      const btn = h.container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
      expect(btn.getAttribute("aria-label")).toBe("No updates available");
    } finally {
      h.unmount();
    }
  });

  it("renders badge with the exact count when 1..9", async () => {
    stub.updateCount = 3;
    stub.updates = [
      { name: "p/a", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
    ];
    const h = await mountBell();
    try {
      const badge = h.container.querySelector("[data-testid='update-bell-badge']") as HTMLElement;
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe("3");
      const btn = h.container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
      expect(btn.getAttribute("aria-label")).toBe("3 updates available, open summary");
    } finally {
      h.unmount();
    }
  });

  it("badge text is '9+' when updateCount > 9", async () => {
    stub.updateCount = 12;
    const h = await mountBell();
    try {
      const badge = h.container.querySelector("[data-testid='update-bell-badge']") as HTMLElement;
      expect(badge.textContent).toBe("9+");
    } finally {
      h.unmount();
    }
  });

  it("clicking the bell toggles aria-expanded and mounts the dropdown", async () => {
    stub.updateCount = 1;
    stub.updates = [
      { name: "p/a", installed: "1.0.0", latest: "2.0.0", updateAvailable: true },
    ];
    const h = await mountBell();
    try {
      const btn = h.container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      await h.act(async () => {
        btn.click();
        // Let Suspense/fallback and lazy import resolve.
        await flushMicrotasks();
        await flushMicrotasks();
      });
      expect(btn.getAttribute("aria-expanded")).toBe("true");
      // Wait up to several ticks for the lazy chunk to resolve.
      for (let i = 0; i < 10; i++) {
        if (h.container.querySelector("[data-testid='update-dropdown']")) break;
        await h.act(async () => { await flushMicrotasks(); });
      }
      expect(h.container.querySelector("[data-testid='update-dropdown']")).toBeTruthy();
    } finally {
      h.unmount();
    }
  });

  it("badge uses tabular-nums font-variant for numeric alignment", async () => {
    stub.updateCount = 2;
    const h = await mountBell();
    try {
      const badge = h.container.querySelector("[data-testid='update-bell-badge']") as HTMLElement;
      const style = badge.getAttribute("style") || "";
      expect(style).toContain("tabular-nums");
    } finally {
      h.unmount();
    }
  });
});
