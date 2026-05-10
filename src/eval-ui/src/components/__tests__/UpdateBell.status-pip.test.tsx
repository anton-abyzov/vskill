// @vitest-environment jsdom
// 0838 T-003 + T-004: UpdateBell status pip + tooltip status text.
//
// AC-US1-04: hidden status-text span linked via aria-describedby.
// AC-US4-01: pip color tokens by status.
// AC-US4-02: pip absent when zero installed + zero source-origin skills.
// AC-US4-03: tooltip text appended; platform-degraded takes precedence.
// AC-US4-05: existing selectors preserved; new selectors added.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../assets/icons/update-bell.svg", () => ({ default: "stub-bell.svg" }));

let platformHealth = { degraded: false, reason: null, statsAgeMs: 0, oldestActiveAgeMs: 0 };
vi.mock("../../hooks/usePlatformHealth", () => ({
  usePlatformHealth: () => ({ data: platformHealth, loading: false }),
}));

vi.mock("../ToastProvider", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), clear: vi.fn() }),
}));

vi.mock("../UpdateDropdown", () => ({
  default: () => null,
}));

interface StudioStub {
  updateCount: number;
  updates: Array<{ name: string; installed: string; latest: string | null; updateAvailable: boolean }>;
  isRefreshingUpdates: boolean;
  refreshUpdates: () => Promise<void>;
  selectSkill: (s: { plugin: string; skill: string; origin: "source" | "installed" }) => void;
  onSkillUpdated: (plugin: string, skill: string) => void;
  updatesById?: ReadonlyMap<string, unknown>;
  updateStreamStatus?: "connecting" | "connected" | "fallback";
  // 0838: total tracked-skill count (installed + source-origin) drives the
  // pip's "no signal to show" suppression in AC-US4-02.
  trackedSkillCount?: number;
}

let stub: StudioStub = {
  updateCount: 0,
  updates: [],
  isRefreshingUpdates: false,
  refreshUpdates: vi.fn(() => Promise.resolve()),
  selectSkill: vi.fn(),
  onSkillUpdated: vi.fn(),
  updatesById: new Map(),
  updateStreamStatus: "connected",
  trackedSkillCount: 1,
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

beforeEach(() => {
  platformHealth = { degraded: false, reason: null, statsAgeMs: 0, oldestActiveAgeMs: 0 };
  stub = {
    updateCount: 0,
    updates: [],
    isRefreshingUpdates: false,
    refreshUpdates: vi.fn(() => Promise.resolve()),
    selectSkill: vi.fn(),
    onSkillUpdated: vi.fn(),
    updatesById: new Map(),
    updateStreamStatus: "connected",
    trackedSkillCount: 1,
  };
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("UpdateBell — status pip + tooltip status text (0838 T-003/T-004)", () => {
  it("AC-US4-05: existing selectors are preserved", async () => {
    stub.updateCount = 1;
    const h = await mountBell();
    try {
      expect(h.container.querySelector("[data-testid='update-bell']")).toBeTruthy();
      expect(h.container.querySelector("[data-testid='update-bell-icon']")).toBeTruthy();
      expect(h.container.querySelector("[data-testid='update-bell-badge']")).toBeTruthy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-04: hidden status-text span exists with `Live updates: connected`", async () => {
    stub.updateStreamStatus = "connected";
    stub.trackedSkillCount = 1;
    const h = await mountBell();
    try {
      const text = h.container.querySelector(
        "[data-testid='update-bell-status-text']",
      ) as HTMLElement | null;
      expect(text).toBeTruthy();
      expect(text!.textContent).toBe("Live updates: connected");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-04: bell button aria-describedby points at the status-text id", async () => {
    stub.updateStreamStatus = "connected";
    stub.trackedSkillCount = 1;
    const h = await mountBell();
    try {
      const btn = h.container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
      const describedBy = btn.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      const target = h.container.querySelector(`#${describedBy}`);
      expect(target).toBeTruthy();
      expect(target?.getAttribute("data-testid")).toBe("update-bell-status-text");
    } finally {
      h.unmount();
    }
  });

  it("AC-US4-01: pip uses success token when status=connected", async () => {
    stub.updateStreamStatus = "connected";
    stub.trackedSkillCount = 1;
    const h = await mountBell();
    try {
      const pip = h.container.querySelector("[data-testid='update-bell-status-pip']") as HTMLElement;
      expect(pip).toBeTruthy();
      const style = pip.getAttribute("style") || "";
      expect(style).toContain("var(--status-success-text)");
    } finally {
      h.unmount();
    }
  });

  it("AC-US4-01: pip uses amber token when status=fallback", async () => {
    stub.updateStreamStatus = "fallback";
    stub.trackedSkillCount = 1;
    const h = await mountBell();
    try {
      const pip = h.container.querySelector("[data-testid='update-bell-status-pip']") as HTMLElement;
      expect(pip).toBeTruthy();
      const style = pip.getAttribute("style") || "";
      expect(style).toContain("var(--color-own)");
      const text = h.container.querySelector("[data-testid='update-bell-status-text']") as HTMLElement;
      expect(text.textContent).toBe("Live updates: reconnecting");
    } finally {
      h.unmount();
    }
  });

  it("AC-US4-01: pip uses secondary token when status=connecting", async () => {
    stub.updateStreamStatus = "connecting";
    stub.trackedSkillCount = 1;
    const h = await mountBell();
    try {
      const pip = h.container.querySelector("[data-testid='update-bell-status-pip']") as HTMLElement;
      expect(pip).toBeTruthy();
      const style = pip.getAttribute("style") || "";
      expect(style).toContain("var(--text-secondary)");
    } finally {
      h.unmount();
    }
  });

  it("AC-US4-02: pip is absent when no skills are tracked", async () => {
    stub.updateStreamStatus = "fallback";
    stub.trackedSkillCount = 0;
    const h = await mountBell();
    try {
      const pip = h.container.querySelector("[data-testid='update-bell-status-pip']");
      expect(pip).toBeFalsy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US4-03: platform-degraded text takes precedence over live-updates text", async () => {
    platformHealth = { degraded: true, reason: "crawler-degraded", statsAgeMs: 0, oldestActiveAgeMs: 0 };
    stub.updateStreamStatus = "fallback";
    stub.trackedSkillCount = 1;
    const h = await mountBell();
    try {
      const btn = h.container.querySelector("[data-testid='update-bell']") as HTMLButtonElement;
      const title = btn.getAttribute("title") || "";
      expect(title).toMatch(/crawler is degraded/i);
      // The status-text span exists for a11y but the visible/title surface
      // is dominated by the platform-degraded message.
      const text = h.container.querySelector("[data-testid='update-bell-status-text']") as HTMLElement;
      expect(text).toBeTruthy();
    } finally {
      h.unmount();
    }
  });
});
