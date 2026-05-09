// @vitest-environment jsdom
// 0834 T-025 — PlanCard tests.
// AC-US4-03: tier name + Active chip + bullet list + Upgrade CTA.

import { describe, it, expect, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { PlanCard } from "../../components/account/PlanCard";
import type { Tier } from "../../types/account";

async function render(props: {
  tier: Tier;
  onUpgradeClick?: () => void;
  showUpgradeCta?: boolean;
}): Promise<{ container: HTMLDivElement; unmount: () => void }> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(PlanCard, props));
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("PlanCard", () => {
  it("renders Free tier with Open Source badge", async () => {
    const { container, unmount } = await render({ tier: "free" });
    expect(container.querySelector("[data-testid='plan-card-free']")).not.toBeNull();
    const badge = container.querySelector("[data-testid='plan-card-badge']");
    expect(badge?.textContent).toMatch(/Open Source/);
    unmount();
  });

  it("renders Pro tier with Active badge + bullets", async () => {
    const { container, unmount } = await render({ tier: "pro" });
    expect(container.querySelector("[data-testid='plan-card-pro']")).not.toBeNull();
    const badge = container.querySelector("[data-testid='plan-card-badge']");
    expect(badge?.textContent).toMatch(/Active/);
    const bullets = container.querySelectorAll("li");
    expect(bullets.length).toBeGreaterThanOrEqual(3);
    unmount();
  });

  it("hides upgrade CTA on Enterprise", async () => {
    const { container, unmount } = await render({ tier: "enterprise" });
    const cta = container.querySelector("[data-testid='plan-card-upgrade']");
    expect(cta).toBeNull();
    unmount();
  });

  it("upgrade CTA fires onUpgradeClick", async () => {
    const onUpgradeClick = vi.fn();
    const { container, unmount } = await render({ tier: "free", onUpgradeClick });
    const cta = container.querySelector<HTMLButtonElement>(
      "[data-testid='plan-card-upgrade']",
    )!;
    cta.click();
    expect(onUpgradeClick).toHaveBeenCalled();
    unmount();
  });

  it("upgrade CTA disabled when no handler provided", async () => {
    const { container, unmount } = await render({ tier: "free" });
    const cta = container.querySelector<HTMLButtonElement>(
      "[data-testid='plan-card-upgrade']",
    )!;
    expect(cta.disabled).toBe(true);
    unmount();
  });
});
