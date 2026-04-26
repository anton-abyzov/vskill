// @vitest-environment jsdom
// 0772 US-003 — no-project-skills variant on EmptyState.

import { describe, it, expect, beforeEach, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stub useStudio so EmptyState can mount without a real provider.
vi.mock("../../StudioContext", () => ({
  useStudio: () => ({
    setMode: vi.fn(),
    setSearch: vi.fn(),
  }),
}));

describe("EmptyState — no-project-skills variant (0772 US-003)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("AC-US3-01: heading is 'No skills installed for this project yet.'", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { EmptyState } = await import("../EmptyState");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(EmptyState, { variant: "no-project-skills" }));
    });

    const region = container.querySelector("[data-testid='empty-state-no-project-skills']");
    expect(region).toBeTruthy();
    expect(region!.textContent).toContain("No skills installed for this project yet.");
    act(() => root.unmount());
    container.remove();
  });

  it("AC-US3-02: renders Browse marketplaces and Create new skill buttons", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { EmptyState } = await import("../EmptyState");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(EmptyState, { variant: "no-project-skills" }));
    });

    const browse = container.querySelector(
      "[data-testid='empty-state-browse-marketplaces']",
    ) as HTMLButtonElement;
    const create = container.querySelector(
      "[data-testid='empty-state-create-skill']",
    ) as HTMLButtonElement;
    expect(browse).toBeTruthy();
    expect(create).toBeTruthy();
    expect(browse.getAttribute("aria-label")).toBe("Browse marketplaces");
    expect(create.getAttribute("aria-label")).toBe("Create new skill");
    act(() => root.unmount());
    container.remove();
  });

  it("AC-US3-02: clicking Browse marketplaces dispatches studio:open-marketplace", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { EmptyState } = await import("../EmptyState");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(EmptyState, { variant: "no-project-skills" }));
    });

    const events: Event[] = [];
    const listener = (e: Event): void => {
      events.push(e);
    };
    window.addEventListener("studio:open-marketplace", listener);

    const browse = container.querySelector(
      "[data-testid='empty-state-browse-marketplaces']",
    ) as HTMLButtonElement;
    act(() => {
      browse.click();
    });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("studio:open-marketplace");
    window.removeEventListener("studio:open-marketplace", listener);
    act(() => root.unmount());
    container.remove();
  });
});
