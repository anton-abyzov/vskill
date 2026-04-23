// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 0686 T-007 / T-009 (US-003, US-004): ScopeSection — tri-scope sidebar
// primitive with OWN / INSTALLED / GLOBAL variants.
//
// Covers AC-US3-01..05, AC-US4-01..03:
//   - Kicker + count + collapse toggle + status dot.
//   - Collapse state persists per-scope per-agent in localStorage with
//     key pattern `vskill-sidebar-<agent>-<scope>-collapsed`.
//   - Typography: 14px Source Serif 4 uppercase letter-spacing 0.12em.
//   - Dividers: handled by Sidebar wrapper (FullWidthDivider) — we assert
//     the section header styling here.
//   - Status dot color: green (fresh), amber (updates), grey (empty).
// ---------------------------------------------------------------------------

describe("0686 T-007: ScopeSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders scope-specific kicker for OWN (serif 14px, uppercase, 0.12em)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ScopeSection } = await import("../ScopeSection");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          ScopeSection,
          { scope: "own", agentId: "claude-cli", count: 4, updateCount: 0 },
          React.createElement("div", { "data-testid": "content" }, "body"),
        ),
      );
    });
    const kicker = container.querySelector("[data-testid='scope-section-kicker']") as HTMLElement;
    expect(kicker).toBeTruthy();
    expect(kicker.textContent).toContain("Own");
    expect(kicker.style.fontFamily).toMatch(/Source Serif 4/);
    expect(kicker.style.fontSize).toBe("14px");
    expect(kicker.style.textTransform).toBe("uppercase");
    expect(kicker.style.letterSpacing).toBe("0.12em");
    expect(kicker.style.fontWeight).toBe("600");
    act(() => root.unmount());
    container.remove();
  });

  it("renders INSTALLED variant with its own colorized kicker", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ScopeSection } = await import("../ScopeSection");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          ScopeSection,
          { scope: "installed", agentId: "claude-cli", count: 7, updateCount: 0 },
          React.createElement("div", null, "body"),
        ),
      );
    });
    const kicker = container.querySelector("[data-testid='scope-section-kicker']") as HTMLElement;
    expect(kicker.textContent).toContain("Installed");
    expect(kicker.style.color).toContain("--color-accent");
    act(() => root.unmount());
    container.remove();
  });

  it("renders GLOBAL variant with slate-violet kicker color", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ScopeSection } = await import("../ScopeSection");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          ScopeSection,
          { scope: "global", agentId: "claude-cli", count: 12, updateCount: 0 },
          React.createElement("div", null, "body"),
        ),
      );
    });
    const kicker = container.querySelector("[data-testid='scope-section-kicker']") as HTMLElement;
    expect(kicker.textContent).toContain("Global");
    expect(kicker.style.color).toContain("--color-global");
    act(() => root.unmount());
    container.remove();
  });

  it("shows (filtered of total) when filteredCount is provided and smaller than total", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ScopeSection } = await import("../ScopeSection");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          ScopeSection,
          {
            scope: "installed",
            agentId: "claude-cli",
            count: 7,
            filteredCount: 3,
          },
          React.createElement("div", null, "body"),
        ),
      );
    });
    expect(container.textContent).toContain("3 of 7");
    act(() => root.unmount());
    container.remove();
  });

  it("status dot is green when fresh (no updates, count > 0)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ScopeSection } = await import("../ScopeSection");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          ScopeSection,
          { scope: "own", agentId: "claude-cli", count: 4, updateCount: 0 },
          React.createElement("div", null, "x"),
        ),
      );
    });
    const dot = container.querySelector("[data-testid='scope-status-dot']") as HTMLElement;
    expect(dot.getAttribute("data-status")).toBe("fresh");
    act(() => root.unmount());
    container.remove();
  });

  it("status dot is amber when updates available", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ScopeSection } = await import("../ScopeSection");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          ScopeSection,
          { scope: "installed", agentId: "claude-cli", count: 7, updateCount: 2 },
          React.createElement("div", null, "x"),
        ),
      );
    });
    const dot = container.querySelector("[data-testid='scope-status-dot']") as HTMLElement;
    expect(dot.getAttribute("data-status")).toBe("updates");
    act(() => root.unmount());
    container.remove();
  });

  it("status dot is grey when section is empty (count === 0)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ScopeSection } = await import("../ScopeSection");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          ScopeSection,
          { scope: "global", agentId: "claude-cli", count: 0, updateCount: 0 },
          React.createElement("div", null, "x"),
        ),
      );
    });
    const dot = container.querySelector("[data-testid='scope-status-dot']") as HTMLElement;
    expect(dot.getAttribute("data-status")).toBe("empty");
    act(() => root.unmount());
    container.remove();
  });

  it("persists collapse state per-scope per-agent in localStorage", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ScopeSection } = await import("../ScopeSection");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          ScopeSection,
          { scope: "global", agentId: "claude-cli", count: 3 },
          React.createElement("div", { "data-testid": "content" }, "body"),
        ),
      );
    });
    const header = container.querySelector("[data-testid='scope-section-header']") as HTMLButtonElement;
    act(() => header.click());
    // Per-agent per-scope key (agent + scope).
    expect(localStorage.getItem("vskill-sidebar-claude-cli-global-collapsed")).toBe("true");
    expect(container.querySelector("[data-testid='content']")).toBeFalsy();
    act(() => root.unmount());
    container.remove();
  });
});
