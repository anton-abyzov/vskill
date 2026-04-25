// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0682 F-005 — ProvidersSegment unit tests.
//
// Covers:
//  - Render order (claude-cli → anthropic → openrouter → ollama → lm-studio)
//  - Lock glyph state per provider (data-available + aria-label)
//  - Click routing: api-key kind → onOpenSettings; cli-install kind →
//    onOpenInstallHelp.
//  - Narrow-viewport collapse to summary (matchMedia stub)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProvidersSegmentProvider } from "../ProvidersSegment";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderProvidersSegment(
  providers: ProvidersSegmentProvider[],
  handlers: { onOpenSettings?: ReturnType<typeof vi.fn>; onOpenInstallHelp?: ReturnType<typeof vi.fn> } = {},
): Promise<HTMLElement> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ProvidersSegment } = await import("../ProvidersSegment");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(ProvidersSegment, {
        providers,
        onOpenSettings: handlers.onOpenSettings,
        onOpenInstallHelp: handlers.onOpenInstallHelp,
      }),
    );
  });
  return container;
}

function stubMatchMedia(narrow: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (q: string) => ({
      matches: narrow,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

const ALL_PROVIDERS: ProvidersSegmentProvider[] = [
  { id: "claude-cli", label: "Claude Code", available: true, kind: "cli-install" },
  { id: "anthropic", label: "Anthropic API", available: false, kind: "api-key" },
  { id: "openrouter", label: "OpenRouter", available: true, kind: "api-key" },
  { id: "ollama", label: "Ollama", available: false, kind: "start-service" },
  { id: "lm-studio", label: "LM Studio", available: false, kind: "start-service" },
];

describe("ProvidersSegment — wide viewport (default)", () => {
  beforeEach(() => stubMatchMedia(false));
  afterEach(() => vi.restoreAllMocks());

  it("renders one glyph per provider in the documented order", async () => {
    const container = await renderProvidersSegment(ALL_PROVIDERS);
    const glyphs = container.querySelectorAll("[data-testid^='provider-glyph-']");
    expect(glyphs.length).toBe(5);
    const ids = Array.from(glyphs).map((g) => g.getAttribute("data-testid"));
    expect(ids).toEqual([
      "provider-glyph-claude-cli",
      "provider-glyph-anthropic",
      "provider-glyph-openrouter",
      "provider-glyph-ollama",
      "provider-glyph-lm-studio",
    ]);
  });

  it("marks available providers with data-available='true'", async () => {
    const container = await renderProvidersSegment(ALL_PROVIDERS);
    const claude = container.querySelector("[data-testid='provider-glyph-claude-cli']");
    const anthropic = container.querySelector("[data-testid='provider-glyph-anthropic']");
    expect(claude?.getAttribute("data-available")).toBe("true");
    expect(anthropic?.getAttribute("data-available")).toBe("false");
  });

  it("aria-label reflects locked vs unlocked state", async () => {
    const container = await renderProvidersSegment(ALL_PROVIDERS);
    const claude = container.querySelector("[data-testid='provider-glyph-claude-cli']");
    const anthropic = container.querySelector("[data-testid='provider-glyph-anthropic']");
    // Available → "unlocked" tone; locked → kind-specific tone (api-key vs cli)
    expect((claude as HTMLElement).getAttribute("aria-label")).toMatch(/Claude Code/);
    expect((anthropic as HTMLElement).getAttribute("aria-label")).toMatch(/Anthropic API/);
  });

  it("clicking an api-key provider routes to onOpenSettings", async () => {
    const onOpenSettings = vi.fn();
    const onOpenInstallHelp = vi.fn();
    const container = await renderProvidersSegment(ALL_PROVIDERS, { onOpenSettings, onOpenInstallHelp });
    const anthropic = container.querySelector(
      "[data-testid='provider-glyph-anthropic']",
    ) as HTMLButtonElement;
    anthropic.click();
    expect(onOpenSettings).toHaveBeenCalledWith("anthropic");
    expect(onOpenInstallHelp).not.toHaveBeenCalled();
  });

  it("clicking a locked cli-install provider routes to onOpenInstallHelp", async () => {
    const onOpenSettings = vi.fn();
    const onOpenInstallHelp = vi.fn();
    const lockedCli: ProvidersSegmentProvider = {
      id: "cursor", label: "Cursor", available: false, kind: "cli-install",
    };
    const container = await renderProvidersSegment([lockedCli], { onOpenSettings, onOpenInstallHelp });
    const btn = container.querySelector(
      "[data-testid='provider-glyph-cursor']",
    ) as HTMLButtonElement;
    btn.click();
    expect(onOpenInstallHelp).toHaveBeenCalledWith("cursor");
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("appends unknown ids at the tail of the documented order", async () => {
    const container = await renderProvidersSegment([
      { id: "future-provider", label: "Future", available: true, kind: "api-key" },
      ...ALL_PROVIDERS,
    ]);
    const glyphs = container.querySelectorAll("[data-testid^='provider-glyph-']");
    const ids = Array.from(glyphs).map((g) => g.getAttribute("data-testid"));
    expect(ids[ids.length - 1]).toBe("provider-glyph-future-provider");
  });
});

describe("ProvidersSegment — narrow viewport (<=640px)", () => {
  beforeEach(() => stubMatchMedia(true));
  afterEach(() => vi.restoreAllMocks());

  it("collapses to a summary button", async () => {
    const container = await renderProvidersSegment(ALL_PROVIDERS);
    const summary = container.querySelector("[data-testid='providers-summary']");
    expect(summary).not.toBeNull();
    // No glyphs rendered inline at narrow widths.
    const inlineGlyphs = container.querySelectorAll("[data-testid^='provider-glyph-']");
    expect(inlineGlyphs.length).toBe(0);
  });
});
