// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import type { AgentEntry } from "../../hooks/useAgentCatalog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 0686 T-012 (US-006): AgentList Claude Code compact label + tooltip.
//
// AC-US6-01 Compact row label (post-0682 AC-US5-01 reframe): banishes
//           "Max/Pro" / "subscription" from picker copy. New label points at
//           the user's existing Claude Code session.
// AC-US6-02 Tooltip on hover: exact verified copy (attached via `title` attr
//           so browsers + AT surface it consistently).
//
// The picker already shows `displayName = "Claude Code"`. This test guards
// that the ADDITIONAL billing label + tooltip appear only on the claude-cli /
// claude-code row — not on other agents.
// ---------------------------------------------------------------------------

function fixture(overrides: Partial<AgentEntry>): AgentEntry {
  return {
    id: "claude-cli",
    displayName: "Claude Code",
    available: true,
    wrapperFolder: null,
    wrapperFolderPresent: false,
    models: [
      { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5", billingMode: "subscription" },
    ],
    ctaType: undefined,
    ...overrides,
  } as AgentEntry;
}

describe("0686 T-012: AgentList Claude Code row billing label", () => {
  it("renders the EXACT compact Claude Code session label on the claude-cli row", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentList } = await import("../AgentList");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(AgentList, {
          agents: [fixture({})],
          activeAgentId: "claude-cli",
          focusedAgentId: "claude-cli",
          onFocus: vi.fn(),
          onSelect: vi.fn(),
          onOpenSettings: vi.fn(),
        }),
      );
    });
    const row = container.querySelector(
      "[data-testid='agent-row-claude-cli']",
    ) as HTMLElement;
    expect(row).toBeTruthy();
    // The billing label is emitted inside a dedicated caption span, checked
    // by both outerHTML text and a scoped data-testid so the regex can't
    // drift without a test failure.
    expect(row.textContent).toContain(
      "Uses your Claude Code session · overflow billed at API rates",
    );
    const caption = row.querySelector(
      "[data-testid='claude-code-billing-label']",
    ) as HTMLElement;
    expect(caption).toBeTruthy();
    expect(caption.textContent).toBe(
      "Uses your Claude Code session · overflow billed at API rates",
    );
    act(() => root.unmount());
    container.remove();
  });

  it("attaches the verified tooltip copy via title attribute on the row", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentList } = await import("../AgentList");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(AgentList, {
          agents: [fixture({})],
          activeAgentId: "claude-cli",
          focusedAgentId: "claude-cli",
          onFocus: vi.fn(),
          onSelect: vi.fn(),
          onOpenSettings: vi.fn(),
        }),
      );
    });
    const caption = document.querySelector(
      "[data-testid='claude-code-billing-label']",
    ) as HTMLElement;
    const title = caption.getAttribute("title") ?? "";
    expect(title).toContain(
      "vSkill delegates to the `claude` CLI — your existing Claude Code session handles quota",
    );
    expect(title).toContain("/usage");
    // Must NOT mention a numeric quota value (AC-US6-04).
    expect(title).not.toMatch(/\d+\s*(hours?|cap|requests?|daily)/i);
    act(() => root.unmount());
    container.remove();
  });

  it("does NOT render the billing label on non-Claude-Code rows", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentList } = await import("../AgentList");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(AgentList, {
          agents: [
            fixture({ id: "cursor", displayName: "Cursor" }),
            fixture({ id: "anthropic", displayName: "Anthropic API" }),
          ],
          activeAgentId: "cursor",
          focusedAgentId: "cursor",
          onFocus: vi.fn(),
          onSelect: vi.fn(),
          onOpenSettings: vi.fn(),
        }),
      );
    });
    expect(
      document.querySelector("[data-testid='claude-code-billing-label']"),
    ).toBeFalsy();
    act(() => root.unmount());
    container.remove();
  });
});
