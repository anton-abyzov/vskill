// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 0686 T-010 + T-011 (US-005 / US-006): SetupDrawer + per-provider content.
//
// Covers:
//   AC-US5-01  role="dialog" + aria-modal="true" at 480px width.
//   AC-US5-03  Registry lookup — unknown key falls back to "No setup guide"
//              in production (dev-time would throw; we exercise prod mode).
//   AC-US5-04  Each provider renders description + env vars + key URL.
//   AC-US5-05  Verified URLs match exactly (regression guard).
//   AC-US5-06  Claude Code view includes "No API key needed" and contains
//              zero numeric quota values (/\d+\s*(hours?|cap|requests?)/i).
//   AC-US5-07  Esc closes; focus returns to the trigger.
//   AC-US5-07  `target="_blank"` + `rel="noopener noreferrer"` on external links.
// ---------------------------------------------------------------------------

describe("0686 T-010: SetupDrawer shell", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders as role=dialog with aria-modal=true at 480px width when open", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SetupDrawer } = await import("../SetupDrawer");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(SetupDrawer, {
          open: true,
          providerKey: "openrouter",
          onClose: vi.fn(),
        }),
      );
    });

    const dialog = document.querySelector("[data-testid='setup-drawer']") as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.style.width).toBe("480px");

    act(() => root.unmount());
    container.remove();
  });

  it("renders nothing when open=false", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SetupDrawer } = await import("../SetupDrawer");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(SetupDrawer, {
          open: false,
          providerKey: "openrouter",
          onClose: vi.fn(),
        }),
      );
    });
    expect(document.querySelector("[data-testid='setup-drawer']")).toBeFalsy();
    act(() => root.unmount());
    container.remove();
  });

  it("Esc key invokes onClose so the parent can return focus to the trigger", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SetupDrawer } = await import("../SetupDrawer");

    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(SetupDrawer, {
          open: true,
          providerKey: "openrouter",
          onClose,
        }),
      );
    });

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });

  it("renders fallback body when provider key is unknown", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SetupDrawer } = await import("../SetupDrawer");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(SetupDrawer, {
          open: true,
          providerKey: "ghost-provider",
          onClose: vi.fn(),
        }),
      );
    });
    const body = document.querySelector("[data-testid='setup-drawer-body']")?.textContent ?? "";
    expect(body).toMatch(/No setup guide available/i);
    act(() => root.unmount());
    container.remove();
  });
});

describe("0686 T-011: SetupDrawer per-provider content", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function render(providerKey: string) {
    return import("../SetupDrawer").then(async ({ SetupDrawer }) => {
      const React = await import("react");
      const { createRoot } = await import("react-dom/client");
      const { act } = await import("react");
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(
          React.createElement(SetupDrawer, {
            open: true,
            providerKey,
            onClose: vi.fn(),
          }),
        );
      });
      return {
        body:
          document.querySelector("[data-testid='setup-drawer-body']")?.textContent ??
          "",
        html: document.body.innerHTML,
        unmount: () => {
          act(() => root.unmount());
          container.remove();
        },
      };
    });
  }

  it("Anthropic view links to platform.claude.com/settings/keys (exact)", async () => {
    const { html, unmount } = await render("anthropic-api");
    expect(html).toContain("https://platform.claude.com/settings/keys");
    expect(html).toContain("ANTHROPIC_API_KEY");
    unmount();
  });

  it("OpenAI view links to platform.openai.com/api-keys (exact)", async () => {
    const { html, unmount } = await render("openai");
    expect(html).toContain("https://platform.openai.com/api-keys");
    expect(html).toContain("OPENAI_API_KEY");
    unmount();
  });

  it("OpenRouter view links to openrouter.ai/keys (exact) and shows OPENROUTER_API_KEY", async () => {
    const { html, unmount } = await render("openrouter");
    expect(html).toContain("https://openrouter.ai/keys");
    expect(html).toContain("OPENROUTER_API_KEY");
    unmount();
  });

  it("Gemini view links to aistudio.google.com/apikey (exact)", async () => {
    const { html, unmount } = await render("gemini");
    expect(html).toContain("https://aistudio.google.com/apikey");
    expect(html).toContain("GEMINI_API_KEY");
    unmount();
  });

  it("Ollama view renders install + start + pull example", async () => {
    const { body, unmount } = await render("ollama");
    expect(body).toContain("ollama.com/install.sh");
    expect(body).toContain("ollama serve");
    expect(body).toContain("ollama pull");
    expect(body).toContain("OLLAMA_HOST");
    unmount();
  });

  it("LM Studio view renders install + start + pull example + LM_STUDIO_BASE_URL", async () => {
    const { body, unmount } = await render("lm-studio");
    expect(body).toContain("lmstudio.ai");
    expect(body).toContain("Start Server");
    expect(body).toContain("LM_STUDIO_BASE_URL");
    unmount();
  });

  it("Claude Code view says 'No API key needed' and quotes the exact Max/Pro compact label", async () => {
    const { body, html, unmount } = await render("claude-code");
    expect(body).toContain("No API key needed");
    expect(body).toContain("Covered by Max/Pro · overflow billed at API rates");
    // AC-US6-04 — NO numeric quota values.
    expect(body).not.toMatch(/\d+\s*(hours?|cap|requests?|daily)/i);
    // No API key envs since claude-code runs the CLI.
    expect(html).not.toContain("ANTHROPIC_API_KEY");
    unmount();
  });

  it("external links carry target=_blank + rel=noopener noreferrer", async () => {
    const { unmount } = await render("openrouter");
    const anchors = Array.from(
      document.querySelectorAll("[data-testid='setup-drawer-body'] a"),
    ) as HTMLAnchorElement[];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a.target).toBe("_blank");
      expect(a.rel).toMatch(/noopener/);
      expect(a.rel).toMatch(/noreferrer/);
    }
    unmount();
  });
});
