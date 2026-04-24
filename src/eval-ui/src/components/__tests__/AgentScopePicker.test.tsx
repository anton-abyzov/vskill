// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 0686 T-002 (US-002): AgentScopePicker — sticky 40px trigger + two-pane
// popover reusing AgentModelPicker primitives.
//
// This suite covers the UI-only surface: trigger geometry, popover render,
// Esc/click-outside closure, and the shared-folder aggregate row (US-009).
// Real `/api/agents` integration and SSE agent-changed dispatch land once
// the server agent signals CONTRACT_READY — those wire tests live in a
// follow-up spec.
// ---------------------------------------------------------------------------

const fixtureAgents = [
  {
    id: "claude-cli",
    displayName: "Claude Code",
    presence: "detected" as const,
    installedCount: 3,
    globalCount: 7,
    lastSync: new Date().toISOString(),
    health: "ok" as const,
  },
  {
    id: "cursor",
    displayName: "Cursor",
    presence: "detected" as const,
    installedCount: 0,
    globalCount: 2,
    lastSync: null,
    health: "ok" as const,
  },
  {
    id: "kimi",
    displayName: "Kimi",
    presence: "detected" as const,
    installedCount: 0,
    globalCount: 5,
    lastSync: null,
    health: "ok" as const,
    sharedFolderGroup: ["kimi", "qwen"],
    sharedFolderPath: "~/.config/agents/skills",
  },
  {
    id: "qwen",
    displayName: "Qwen",
    presence: "detected" as const,
    installedCount: 0,
    globalCount: 5,
    lastSync: null,
    health: "ok" as const,
    sharedFolderGroup: ["kimi", "qwen"],
    sharedFolderPath: "~/.config/agents/skills",
  },
  {
    id: "zed",
    displayName: "Zed",
    presence: "absent" as const,
    installedCount: 0,
    globalCount: 0,
    lastSync: null,
    health: "missing" as const,
  },
];

describe("0686 T-002: AgentScopePicker trigger + popover", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("trigger is 40px tall, full-width, sticky, shows active agent + dot", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentScopePicker } = await import("../AgentScopePicker");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(AgentScopePicker, {
          agents: fixtureAgents,
          activeAgentId: "claude-cli",
          onActiveAgentChange: vi.fn(),
          onOpenSetup: vi.fn(),
        }),
      );
    });
    const trigger = container.querySelector(
      "[data-testid='agent-scope-picker-trigger']",
    ) as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.style.height).toBe("40px");
    expect(trigger.style.width).toBe("100%");
    expect(trigger.style.position).toBe("sticky");
    expect(trigger.textContent).toContain("Claude Code");
    // Summary chip "(installed · global)".
    expect(trigger.textContent).toContain("3");
    expect(trigger.textContent).toContain("7");
    act(() => root.unmount());
    container.remove();
  });

  it("clicking the trigger opens a two-pane popover (AgentList + stats)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentScopePicker } = await import("../AgentScopePicker");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(AgentScopePicker, {
          agents: fixtureAgents,
          activeAgentId: "claude-cli",
          onActiveAgentChange: vi.fn(),
          onOpenSetup: vi.fn(),
        }),
      );
    });
    const trigger = container.querySelector(
      "[data-testid='agent-scope-picker-trigger']",
    ) as HTMLButtonElement;
    act(() => trigger.click());
    const popover = document.querySelector(
      "[data-testid='agent-scope-picker-popover']",
    );
    expect(popover).toBeTruthy();
    expect(
      document.querySelector("[data-testid='agent-scope-picker-agents']"),
    ).toBeTruthy();
    expect(
      document.querySelector("[data-testid='agent-scope-picker-stats']"),
    ).toBeTruthy();
    act(() => root.unmount());
    container.remove();
  });

  it("Esc closes the popover", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentScopePicker } = await import("../AgentScopePicker");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(AgentScopePicker, {
          agents: fixtureAgents,
          activeAgentId: "claude-cli",
          onActiveAgentChange: vi.fn(),
          onOpenSetup: vi.fn(),
        }),
      );
    });
    const trigger = container.querySelector(
      "[data-testid='agent-scope-picker-trigger']",
    ) as HTMLButtonElement;
    act(() => trigger.click());
    expect(
      document.querySelector("[data-testid='agent-scope-picker-popover']"),
    ).toBeTruthy();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(
      document.querySelector("[data-testid='agent-scope-picker-popover']"),
    ).toBeFalsy();
    act(() => root.unmount());
    container.remove();
  });

  it("groups agents sharing a folder under a single aggregate row with consumer chips (US-009)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentScopePicker } = await import("../AgentScopePicker");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(AgentScopePicker, {
          agents: fixtureAgents,
          activeAgentId: "claude-cli",
          onActiveAgentChange: vi.fn(),
          onOpenSetup: vi.fn(),
        }),
      );
    });
    const trigger = container.querySelector(
      "[data-testid='agent-scope-picker-trigger']",
    ) as HTMLButtonElement;
    act(() => trigger.click());
    const aggregate = document.querySelector(
      "[data-testid='agent-scope-shared-folder-row']",
    ) as HTMLElement;
    expect(aggregate).toBeTruthy();
    expect(aggregate.textContent).toContain("kimi");
    expect(aggregate.textContent).toContain("qwen");
    // The two contributing agents should NOT appear as separate rows — one
    // aggregate row represents both.
    const individualRows = Array.from(
      document.querySelectorAll("[data-testid='agent-scope-row']"),
    ).map((el) => el.getAttribute("data-agent-id"));
    expect(individualRows).not.toContain("kimi");
    expect(individualRows).not.toContain("qwen");
    act(() => root.unmount());
    container.remove();
  });

  it("Not-detected agents are rendered under a dim 'Not detected' subheading with Set up CTA", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentScopePicker } = await import("../AgentScopePicker");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenSetup = vi.fn();
    act(() => {
      root.render(
        React.createElement(AgentScopePicker, {
          agents: fixtureAgents,
          activeAgentId: "claude-cli",
          onActiveAgentChange: vi.fn(),
          onOpenSetup,
        }),
      );
    });
    const trigger = container.querySelector(
      "[data-testid='agent-scope-picker-trigger']",
    ) as HTMLButtonElement;
    act(() => trigger.click());
    const subheading = document.querySelector(
      "[data-testid='agent-scope-not-detected-subheading']",
    );
    expect(subheading?.textContent).toMatch(/not detected/i);
    const setUpBtn = document.querySelector(
      "[data-testid='agent-scope-set-up-zed']",
    ) as HTMLButtonElement;
    expect(setUpBtn).toBeTruthy();
    act(() => setUpBtn.click());
    expect(onOpenSetup).toHaveBeenCalledWith("zed");
    act(() => root.unmount());
    container.remove();
  });

  it("clicking 'Switch for this studio session' fires onActiveAgentChange and closes", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentScopePicker } = await import("../AgentScopePicker");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onActiveAgentChange = vi.fn();
    act(() => {
      root.render(
        React.createElement(AgentScopePicker, {
          agents: fixtureAgents,
          activeAgentId: "claude-cli",
          onActiveAgentChange,
          onOpenSetup: vi.fn(),
        }),
      );
    });
    const trigger = container.querySelector(
      "[data-testid='agent-scope-picker-trigger']",
    ) as HTMLButtonElement;
    act(() => trigger.click());
    // Focus cursor on cursor agent via its row then hit Switch.
    const cursorRow = document.querySelector(
      "[data-testid='agent-scope-row'][data-agent-id='cursor']",
    ) as HTMLButtonElement;
    act(() => cursorRow.click());
    const switchBtn = document.querySelector(
      "[data-testid='agent-scope-switch']",
    ) as HTMLButtonElement;
    act(() => switchBtn.click());
    expect(onActiveAgentChange).toHaveBeenCalledWith("cursor");
    expect(
      document.querySelector("[data-testid='agent-scope-picker-popover']"),
    ).toBeFalsy();
    act(() => root.unmount());
    container.remove();
  });

  // 0694 AC-US4-04: Remote-only agents render a "Remote" badge instead of a
  // "Set up" button — install affordances must be suppressed.
  it("AC-US4-04: remote-only agents render Remote badge in lieu of Set up button", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentScopePicker } = await import("../AgentScopePicker");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenSetup = vi.fn();
    const remoteAgents = [
      ...fixtureAgents,
      {
        id: "devin",
        displayName: "Devin",
        presence: "absent" as const,
        installedCount: 0,
        globalCount: 0,
        lastSync: null,
        health: "missing" as const,
        isRemoteOnly: true,
      },
    ];
    act(() => {
      root.render(
        React.createElement(AgentScopePicker, {
          agents: remoteAgents,
          activeAgentId: "claude-cli",
          onActiveAgentChange: vi.fn(),
          onOpenSetup,
        }),
      );
    });
    const trigger = container.querySelector(
      "[data-testid='agent-scope-picker-trigger']",
    ) as HTMLButtonElement;
    act(() => trigger.click());
    const badge = document.querySelector(
      "[data-testid='agent-scope-remote-badge-devin']",
    );
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toMatch(/remote/i);
    // Install affordance (Set up button) MUST be absent for the remote agent.
    const setUpBtn = document.querySelector(
      "[data-testid='agent-scope-set-up-devin']",
    );
    expect(setUpBtn).toBeFalsy();
    act(() => root.unmount());
    container.remove();
  });
});
