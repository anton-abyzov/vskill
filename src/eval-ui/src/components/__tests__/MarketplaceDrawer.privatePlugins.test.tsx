// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0848 T-007 — MarketplaceDrawer surfaces a top "Your private plugins" section
// (amber tint) above the public marketplaces when the user has private-repo
// plugins. Absent the prop, the drawer renders exactly as before.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MarketplaceDrawer — 0848 T-007 private plugins section", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // The drawer fetches the marketplace list on open; return an empty list
    // so we isolate the private-plugins section.
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ marketplaces: [] }),
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders the 'Your private plugins' section when privatePlugins is non-empty", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { MarketplaceDrawer } = await import("../MarketplaceDrawer");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(MarketplaceDrawer, {
          open: true,
          onClose: () => {},
          onInstall: () => {},
          installedNames: new Set<string>(),
          privatePlugins: [
            { name: "acme-internal", repoFullName: "acme/internal-skills" },
          ],
        }),
      );
    });

    const section = container.querySelector("[data-testid='marketplace-private-plugins']");
    expect(section).toBeTruthy();
    expect(container.textContent).toContain("Your private plugins");
    expect(container.textContent).toContain("acme-internal");

    act(() => root.unmount());
    container.remove();
  });

  it("does NOT render the private section when privatePlugins is empty/omitted", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { MarketplaceDrawer } = await import("../MarketplaceDrawer");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(MarketplaceDrawer, {
          open: true,
          onClose: () => {},
          onInstall: () => {},
          installedNames: new Set<string>(),
        }),
      );
    });

    expect(container.querySelector("[data-testid='marketplace-private-plugins']")).toBeFalsy();
    expect(container.textContent).not.toContain("Your private plugins");

    act(() => root.unmount());
    container.remove();
  });
});
