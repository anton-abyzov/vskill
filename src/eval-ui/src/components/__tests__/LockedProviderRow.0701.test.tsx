// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0701 T-009: LockedProviderRow renders a `title=` attribute when a tooltip
// string is provided. Verifies that LM Studio callers can surface the
// "Open LM Studio → Developer tab → Start Server" hover hint without changing
// the other locked-provider rows.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderRow(props: {
  variant: "api-key" | "cli-install" | "start-service";
  label: string;
  tooltip?: string;
}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { LockedProviderRow } = await import("../LockedProviderRow");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(LockedProviderRow, {
        variant: props.variant,
        label: props.label,
        onActivate: vi.fn(),
        ...(props.tooltip ? { tooltip: props.tooltip } : {}),
      }),
    );
  });
  return container;
}

describe("0701 T-009: LockedProviderRow tooltip wiring", () => {
  it("sets title= when tooltip prop is provided", async () => {
    const container = await renderRow({
      variant: "start-service",
      label: "Start LM Studio server →",
      tooltip: "Open LM Studio → Developer tab → Start Server (default port 1234).",
    });
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.getAttribute("title")).toBe(
      "Open LM Studio → Developer tab → Start Server (default port 1234).",
    );
  });

  it("omits title when tooltip prop is not provided", async () => {
    const container = await renderRow({
      variant: "start-service",
      label: "Start service →",
    });
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.hasAttribute("title")).toBe(false);
  });
});
