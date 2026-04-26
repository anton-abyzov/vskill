// @vitest-environment jsdom
// 0781 AC-US2-01..04: UpdateDropdown is wide enough for the inline Update
// button to render without truncation, and no longer carries the platform
// crawler degraded banner (the bell icon + tooltip are the indicator now).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../ToastProvider", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), clear: vi.fn() }),
}));

vi.mock("../../StudioContext", () => ({
  useStudio: () => ({ onSkillUpdated: vi.fn() }),
}));

async function mountDropdown(props: Record<string, unknown> = {}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { default: UpdateDropdown } = await import("../UpdateDropdown");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(UpdateDropdown, {
        updates: [
          {
            name: "anton-abyzov/greet-anton-abyzov",
            installed: "1.0.2",
            latest: "1.0.3",
            updateAvailable: true,
          },
        ],
        isRefreshing: false,
        onRefresh: () => {},
        onSelectSkill: () => {},
        onViewAll: () => {},
        onClose: () => {},
        ...props,
      }),
    );
  });
  return {
    container,
    unmount: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe("UpdateDropdown — 0781 layout + no banner", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => vi.clearAllMocks());

  it("AC-US2-01: root element is at least 440px wide", async () => {
    const m = await mountDropdown();
    try {
      const root = m.container.querySelector(
        "[data-testid='update-dropdown']",
      ) as HTMLElement | null;
      expect(root).toBeTruthy();
      // The component sets `style.width: 440` inline.
      const width = parseFloat(root!.style.width);
      expect(width).toBeGreaterThanOrEqual(440);
    } finally {
      m.unmount();
    }
  });

  it("AC-US2-02: inline Update button renders the full word 'Update' (not truncated)", async () => {
    const m = await mountDropdown();
    try {
      const btn = m.container.querySelector(
        "[data-testid='update-dropdown-row-update']",
      ) as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      expect((btn!.textContent ?? "").trim()).toBe("Update");
    } finally {
      m.unmount();
    }
  });

  it("AC-US2-03: platform-degraded banner is never rendered, even when callers pass legacy props", async () => {
    // Even though the prop type no longer accepts these, callers downstream
    // might still try to pass them during rollout. The component must drop
    // them silently.
    const m = await mountDropdown({
      platformDegraded: true,
      platformReason: "platform reports degraded",
    } as Record<string, unknown>);
    try {
      const banner = m.container.querySelector(
        "[data-testid='update-dropdown-platform-degraded-banner']",
      );
      expect(banner).toBeNull();
    } finally {
      m.unmount();
    }
  });
});
