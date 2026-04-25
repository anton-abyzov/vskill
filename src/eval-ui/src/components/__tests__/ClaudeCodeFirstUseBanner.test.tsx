// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 0686 T-012 (US-006): ClaudeCodeFirstUseBanner — dismissable inline banner
// that appears below the AgentScopePicker the first time the user makes
// Claude Code the active scope agent.
//
// Covers:
//   AC-US6-03  Banner renders with the exact verified first-use copy and a
//              "Learn more" link that dispatches `studio:open-setup-drawer`
//              with `{provider: "claude-code"}`.
//   AC-US6-04  Dismissing the banner writes
//              `sessionStorage["vskill-ccode-banner-dismissed"] = "true"`
//              and the banner is not rendered again within the session.
// ---------------------------------------------------------------------------

const DISMISS_KEY = "vskill-ccode-banner-dismissed";

async function renderBanner(activeAgentId: string | null) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ClaudeCodeFirstUseBanner } = await import("../ClaudeCodeFirstUseBanner");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(ClaudeCodeFirstUseBanner, { activeAgentId }),
    );
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    rerender: (next: string | null) => {
      act(() => {
        root.render(
          React.createElement(ClaudeCodeFirstUseBanner, { activeAgentId: next }),
        );
      });
    },
  };
}

describe("0686 T-012: ClaudeCodeFirstUseBanner", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    sessionStorage.removeItem(DISMISS_KEY);
  });

  it("renders the exact verified first-use copy when activeAgent is claude-cli", async () => {
    const { container, unmount } = await renderBanner("claude-cli");
    const banner = container.querySelector(
      "[data-testid='claude-code-first-use-banner']",
    );
    expect(banner).toBeTruthy();
    expect(banner?.textContent ?? "").toContain(
      "Claude Code uses your existing session",
    );
    expect(banner?.textContent ?? "").toContain("No API key needed");
    // Must NOT include a numeric cap value (AC-US6-04).
    expect(banner?.textContent ?? "").not.toMatch(
      /\d+\s*(hours?|cap|requests?|daily)/i,
    );
    unmount();
  });

  it("also accepts the canonical 'claude-code' id (server-side naming)", async () => {
    const { container, unmount } = await renderBanner("claude-code");
    expect(
      container.querySelector("[data-testid='claude-code-first-use-banner']"),
    ).toBeTruthy();
    unmount();
  });

  it("renders nothing when the active agent is NOT Claude Code", async () => {
    const { container, unmount } = await renderBanner("cursor");
    expect(
      container.querySelector("[data-testid='claude-code-first-use-banner']"),
    ).toBeFalsy();
    unmount();
  });

  it("'Learn more' link fires studio:open-setup-drawer with provider=claude-code", async () => {
    const { container, unmount } = await renderBanner("claude-cli");
    const dispatched: CustomEvent[] = [];
    const listener = (e: Event) => {
      if (e instanceof CustomEvent) dispatched.push(e);
    };
    window.addEventListener("studio:open-setup-drawer", listener);
    const learnMore = container.querySelector(
      "[data-testid='claude-code-first-use-banner-learn-more']",
    ) as HTMLButtonElement;
    expect(learnMore).toBeTruthy();
    learnMore.click();
    window.removeEventListener("studio:open-setup-drawer", listener);
    expect(dispatched.length).toBe(1);
    expect(dispatched[0].detail).toEqual({ provider: "claude-code" });
    unmount();
  });

  it("dismissing persists to sessionStorage and hides subsequent renders", async () => {
    const { act } = await import("react");
    const { container, rerender, unmount } = await renderBanner("claude-cli");
    const dismiss = container.querySelector(
      "[data-testid='claude-code-first-use-banner-dismiss']",
    ) as HTMLButtonElement;
    expect(dismiss).toBeTruthy();
    act(() => dismiss.click());
    expect(sessionStorage.getItem(DISMISS_KEY)).toBe("true");
    // Re-render after dismissal — must not appear.
    rerender("claude-cli");
    expect(
      container.querySelector("[data-testid='claude-code-first-use-banner']"),
    ).toBeFalsy();
    unmount();
  });

  it("honors pre-set dismissal flag without rendering", async () => {
    sessionStorage.setItem(DISMISS_KEY, "true");
    const { container, unmount } = await renderBanner("claude-cli");
    expect(
      container.querySelector("[data-testid='claude-code-first-use-banner']"),
    ).toBeFalsy();
    unmount();
  });
});
