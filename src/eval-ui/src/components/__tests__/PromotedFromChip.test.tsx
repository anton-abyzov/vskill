// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0688 T-021: PromotedFromChip renders a small "promoted from <scope>" badge
// on rows that carry provenance, plus a Revert button wired into the parent.
// The Revert handler is passed in — the chip itself has no network calls.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(props: {
  skillName: string;
  provenance: { promotedFrom: "installed" | "global"; sourcePath: string; promotedAt: number };
  onRevert?: () => void;
}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { PromotedFromChip } = await import("../PromotedFromChip");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(PromotedFromChip, props));
  });

  return {
    container,
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PromotedFromChip (T-021)", () => {
  it("renders the source scope label", async () => {
    const h = await render({
      skillName: "graph-scan",
      provenance: { promotedFrom: "installed", sourcePath: "/x", promotedAt: 1 },
    });
    try {
      const chip = h.container.querySelector("[data-testid='promoted-from-chip']");
      expect(chip).not.toBeNull();
      expect(chip?.textContent?.toLowerCase()).toContain("installed");
    } finally {
      h.unmount();
    }
  });

  it("Revert button carries a skill-qualified aria-label", async () => {
    const h = await render({
      skillName: "graph-scan",
      provenance: { promotedFrom: "global", sourcePath: "/x", promotedAt: 1 },
      onRevert: () => {},
    });
    try {
      const btn = h.container.querySelector<HTMLButtonElement>(
        "[data-testid='promoted-from-chip-revert']",
      );
      expect(btn).not.toBeNull();
      expect(btn!.getAttribute("aria-label")).toBe("Revert graph-scan to global");
    } finally {
      h.unmount();
    }
  });

  it("Revert button invokes onRevert when clicked", async () => {
    const onRevert = vi.fn();
    const h = await render({
      skillName: "graph-scan",
      provenance: { promotedFrom: "installed", sourcePath: "/x", promotedAt: 1 },
      onRevert,
    });
    try {
      const btn = h.container.querySelector<HTMLButtonElement>(
        "[data-testid='promoted-from-chip-revert']",
      );
      await h.act(async () => { btn!.click(); });
      expect(onRevert).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("does not render a Revert button when onRevert is not provided", async () => {
    const h = await render({
      skillName: "graph-scan",
      provenance: { promotedFrom: "installed", sourcePath: "/x", promotedAt: 1 },
    });
    try {
      expect(
        h.container.querySelector("[data-testid='promoted-from-chip-revert']"),
      ).toBeNull();
    } finally {
      h.unmount();
    }
  });
});
