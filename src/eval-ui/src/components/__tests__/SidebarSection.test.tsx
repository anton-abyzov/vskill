// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SidebarSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders OWN label with count and default-expanded (collapsed=false)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SidebarSection } = await import("../SidebarSection");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(
          SidebarSection,
          { origin: "source", count: 5 },
          React.createElement("div", { "data-testid": "content" }, "body"),
        ),
      );
    });

    expect(container.textContent).toContain("Own");
    expect(container.textContent).toContain("5");
    // Content mounted since expanded
    expect(container.querySelector("[data-testid='content']")).toBeTruthy();

    act(() => root.unmount());
    container.remove();
  });

  it("persists collapse state for 'own' under vskill-sidebar-own-collapsed", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SidebarSection } = await import("../SidebarSection");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(
          SidebarSection,
          { origin: "source", count: 3 },
          React.createElement("div", { "data-testid": "content" }, "body"),
        ),
      );
    });

    const header = container.querySelector("button[data-testid='sidebar-section-header']") as HTMLButtonElement;
    expect(header).toBeTruthy();

    act(() => header.click());
    expect(localStorage.getItem("vskill-sidebar-own-collapsed")).toBe("true");
    expect(container.querySelector("[data-testid='content']")).toBeFalsy();

    act(() => header.click());
    expect(localStorage.getItem("vskill-sidebar-own-collapsed")).toBe("false");
    expect(container.querySelector("[data-testid='content']")).toBeTruthy();

    act(() => root.unmount());
    container.remove();
  });

  it("INSTALLED section uses the installed localStorage key", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SidebarSection } = await import("../SidebarSection");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(
          SidebarSection,
          { origin: "installed", count: 9 },
          React.createElement("div", null, "body"),
        ),
      );
    });
    expect(container.textContent).toContain("Installed");
    expect(container.textContent).toContain("9");

    const header = container.querySelector("button[data-testid='sidebar-section-header']") as HTMLButtonElement;
    act(() => header.click());
    expect(localStorage.getItem("vskill-sidebar-installed-collapsed")).toBe("true");

    act(() => root.unmount());
    container.remove();
  });

  it("reads initial collapsed state from localStorage", async () => {
    localStorage.setItem("vskill-sidebar-own-collapsed", "true");

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SidebarSection } = await import("../SidebarSection");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(
          SidebarSection,
          { origin: "source", count: 2 },
          React.createElement("div", { "data-testid": "content" }, "body"),
        ),
      );
    });

    expect(container.querySelector("[data-testid='content']")).toBeFalsy();

    act(() => root.unmount());
    container.remove();
  });
});
