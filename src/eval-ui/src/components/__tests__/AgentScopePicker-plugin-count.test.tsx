// @vitest-environment jsdom
// 0772 US-002 — picker forwards pluginSkillCount and renders triple format.

import { describe, it, expect, beforeEach, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentScopePicker — plugin count (0772 US-002)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("AC-US2-02: agentsResponseToPickerEntries forwards pluginSkillCount → pluginCount", async () => {
    const { agentsResponseToPickerEntries } = await import("../AgentScopePicker");
    const response = {
      agents: [
        {
          id: "claude-code",
          displayName: "Claude Code",
          featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
          isUniversal: true,
          parentCompany: "Anthropic",
          detected: true,
          isDefault: true,
          localSkillCount: 0,
          globalSkillCount: 13,
          pluginSkillCount: 81,
          resolvedLocalDir: "/p/.claude/skills",
          resolvedGlobalDir: "/h/.claude/skills",
          lastSync: null,
          health: "ok" as const,
        },
      ],
      suggested: "claude-code",
      sharedFolders: [],
    };
    const picker = agentsResponseToPickerEntries(response);
    expect(picker[0].pluginCount).toBe(81);
  });

  it("AC-US2-02: missing pluginSkillCount in payload defaults to 0", async () => {
    const { agentsResponseToPickerEntries } = await import("../AgentScopePicker");
    const response = {
      agents: [
        {
          id: "cursor",
          displayName: "Cursor",
          featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: false },
          isUniversal: false,
          parentCompany: "Anysphere",
          detected: true,
          isDefault: false,
          localSkillCount: 0,
          globalSkillCount: 2,
          // pluginSkillCount intentionally missing (older server)
          resolvedLocalDir: "/p/.cursor/skills",
          resolvedGlobalDir: "/h/.cursor/skills",
          lastSync: null,
          health: "ok" as const,
        },
      ] as never,
      suggested: "cursor",
      sharedFolders: [],
    };
    const picker = agentsResponseToPickerEntries(response);
    expect(picker[0].pluginCount).toBe(0);
  });

  it("AC-US2-03: trigger renders triple format `(N · G · P)` with tooltip", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentScopePicker } = await import("../AgentScopePicker");

    const fixtureAgents = [
      {
        id: "claude-code",
        displayName: "Claude Code",
        presence: "detected" as const,
        installedCount: 0,
        globalCount: 13,
        pluginCount: 81,
        lastSync: null,
        health: "ok" as const,
      },
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(AgentScopePicker, {
          agents: fixtureAgents,
          activeAgentId: "claude-code",
          onActiveAgentChange: vi.fn(),
          onOpenSetup: vi.fn(),
        }),
      );
    });

    const trigger = container.querySelector(
      "[data-testid='agent-scope-picker-trigger']",
    ) as HTMLButtonElement;
    expect(trigger.textContent).toContain("(0 · 13 · 81)");
    const summary = trigger.querySelector("span[title]") as HTMLSpanElement;
    expect(summary?.getAttribute("title")).toBe("project · personal · plugins");
    act(() => root.unmount());
    container.remove();
  });

  it("AC-US2-05: non-claude-code with pluginCount=0 still renders cleanly as `(N · G · 0)`", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AgentScopePicker } = await import("../AgentScopePicker");

    const fixtureAgents = [
      {
        id: "cursor",
        displayName: "Cursor",
        presence: "detected" as const,
        installedCount: 0,
        globalCount: 2,
        pluginCount: 0,
        lastSync: null,
        health: "ok" as const,
      },
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(AgentScopePicker, {
          agents: fixtureAgents,
          activeAgentId: "cursor",
          onActiveAgentChange: vi.fn(),
          onOpenSetup: vi.fn(),
        }),
      );
    });
    const trigger = container.querySelector(
      "[data-testid='agent-scope-picker-trigger']",
    ) as HTMLButtonElement;
    expect(trigger.textContent).toContain("(0 · 2 · 0)");
    expect(trigger.textContent).not.toContain("NaN");
    act(() => root.unmount());
    container.remove();
  });
});
