// @vitest-environment jsdom
// 0778 US-003 — UpdateDropdown renders an amber banner above the list when
// platformDegraded is set, with role="status" + aria-live="polite", and no
// banner when degraded is false.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../ToastProvider", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), clear: vi.fn() }),
}));

vi.mock("../../StudioContext", () => ({
  useStudio: () => ({ onSkillUpdated: vi.fn() }),
}));

async function mountDropdown(props: {
  platformDegraded?: boolean;
  platformReason?: string | null;
}) {
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
        updates: [],
        isRefreshing: false,
        onRefresh: () => {},
        onSelectSkill: () => {},
        onViewAll: () => {},
        onClose: () => {},
        platformDegraded: props.platformDegraded,
        platformReason: props.platformReason ?? null,
      }),
    );
  });
  return {
    container,
    unmount: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe("UpdateDropdown — platform degraded banner (0778 US-003)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => vi.clearAllMocks());

  it("AC-US3-01/02/04: degraded=true renders banner with role=status, aria-live=polite, reason text, and the existing list still renders", async () => {
    const m = await mountDropdown({
      platformDegraded: true,
      platformReason: "platform reports degraded; oldest active submission 31d",
    });
    const banner = m.container.querySelector(
      "[data-testid='update-dropdown-platform-degraded-banner']",
    );
    expect(banner).toBeTruthy();
    expect(banner!.getAttribute("role")).toBe("status");
    expect(banner!.getAttribute("aria-live")).toBe("polite");
    expect(banner!.textContent).toMatch(/Platform crawler degraded/);
    expect(banner!.textContent).toContain("oldest active submission 31d");

    // The existing "No updates available" line still renders below the banner.
    const dropdown = m.container.querySelector("[data-testid='update-dropdown']") as HTMLElement;
    expect(dropdown.textContent).toMatch(/No updates available/);
    m.unmount();
  });

  it("AC-US3-03: degraded=false renders no banner; dropdown layout unchanged", async () => {
    const m = await mountDropdown({ platformDegraded: false });
    const banner = m.container.querySelector(
      "[data-testid='update-dropdown-platform-degraded-banner']",
    );
    expect(banner).toBeFalsy();
    m.unmount();
  });

  it("AC-US3-01: degraded=true with null reason falls back to a sensible default message", async () => {
    const m = await mountDropdown({ platformDegraded: true, platformReason: null });
    const banner = m.container.querySelector(
      "[data-testid='update-dropdown-platform-degraded-banner']",
    );
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toMatch(/Platform crawler degraded/);
    // Fallback string from the component (won't include raw "null").
    expect(banner!.textContent).not.toContain("null");
    m.unmount();
  });
});
