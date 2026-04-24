// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { THEME_STORAGE_KEY } from "../../theme/theme-utils";

// jsdom matchMedia stub (ThemeProvider subscribes on mount).
function stubMatchMedia(dark = false) {
  (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (query: string) =>
    ({
      matches: query.includes("prefers-color-scheme: dark") ? dark : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

describe("StatusBar — theme toggle + path/model/health", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-mode");
    stubMatchMedia(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cycles light → dark → auto → light when the theme button is clicked", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ThemeProvider } = await import("../../theme/ThemeProvider");
    const { StatusBar } = await import("../StatusBar");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(StatusBar, {
            projectPath: "/tmp/ws",
            modelName: "gpt-4",
            health: "ok",
            // Start fresh — defaults mode="auto", but the test manually sets light first.
          }),
        ),
      );
    });

    // Set known starting point: "light"
    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, "light");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "light" }));
    });

    const button = container.querySelector("button[data-testid='theme-toggle']") as HTMLButtonElement;
    expect(button).toBeTruthy();

    act(() => button.click());
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(button.getAttribute("aria-label")).toMatch(/auto/i);

    act(() => button.click());
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("auto");
    expect(button.getAttribute("aria-label")).toMatch(/light/i);

    act(() => button.click());
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button.getAttribute("aria-label")).toMatch(/dark/i);

    act(() => root.unmount());
    container.remove();
  });

  it("renders model name (project path removed in 0698 T-016 — now in ProjectPicker)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ThemeProvider } = await import("../../theme/ThemeProvider");
    const { StatusBar } = await import("../StatusBar");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(StatusBar, {
            projectPath: "/Users/foo/work",
            modelName: "claude-sonnet-4.5",
            health: "degraded",
          }),
        ),
      );
    });

    // 0698 T-016: project path is no longer rendered (single source of truth
    // is the top-left ProjectPicker pill). The prop is still accepted for
    // backward compatibility but ignored visually.
    expect(container.textContent).not.toContain("/Users/foo/work");
    expect(container.textContent).toContain("claude-sonnet-4.5");

    act(() => root.unmount());
    container.remove();
  });
});
