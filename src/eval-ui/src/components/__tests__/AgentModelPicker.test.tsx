// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0682 F-005 — AgentModelPicker unit tests.
//
// Covers the picker contract that lives outside e2e:
//   - Trigger shows "<agent> · <model>" once the catalog hydrates.
//   - Cmd/Ctrl+K toggles the popover open.
//   - Esc closes.
//   - Escape closes; Right Arrow moves into the model pane; Left Arrow
//     returns to the agent pane.
//   - Enter in the model pane selects the model at focusedIndex (F-002 fix
//     —  not models[0] unconditionally).
//
// `useAgentCatalog` is mocked so the picker can be exercised without a
// real fetch graph; the catalog merge logic lives in its own test file.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentCatalog, AgentEntry } from "../../hooks/useAgentCatalog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// useAgentCatalog mock — supplies a deterministic catalog and captures the
// setActive() invocations.
// ---------------------------------------------------------------------------

interface CatalogMock {
  status: "loading" | "ready" | "error";
  catalog: AgentCatalog | null;
  setActive: ReturnType<typeof vi.fn>;
  focusAgent: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  activeAgentId: string | null;
  activeModelId: string | null;
  error: null;
}

const catalogState: { current: CatalogMock | null } = { current: null };

vi.mock("../../hooks/useAgentCatalog", () => ({
  useAgentCatalog: () => catalogState.current,
}));

// SettingsModal is heavyweight; stub it to a no-op for this test surface.
vi.mock("../SettingsModal", () => ({
  SettingsModal: () => null,
}));

function makeCatalog(): AgentCatalog {
  const claude: AgentEntry = {
    id: "claude-cli",
    displayName: "Claude Code",
    available: true,
    wrapperFolder: ".claude",
    wrapperFolderPresent: true,
    binaryAvailable: true,
    endpointReachable: null,
    ctaType: null,
    resolvedModel: null,
    models: [
      { id: "sonnet", displayName: "Claude Sonnet", billingMode: "subscription" }, // voice-allow — internal enum
      { id: "opus", displayName: "Claude Opus", billingMode: "subscription" }, // voice-allow
      { id: "haiku", displayName: "Claude Haiku", billingMode: "subscription" }, // voice-allow
    ],
  };
  const anthropic: AgentEntry = {
    id: "anthropic",
    displayName: "Anthropic API",
    available: false,
    wrapperFolder: null,
    wrapperFolderPresent: false,
    binaryAvailable: true,
    endpointReachable: null,
    ctaType: "api-key",
    models: [],
  };
  return {
    agents: [claude, anthropic],
    activeAgent: "claude-cli",
    activeModel: "sonnet",
  };
}

async function renderPicker(): Promise<HTMLElement> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { AgentModelPicker } = await import("../AgentModelPicker");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(AgentModelPicker, { onToast: vi.fn() }));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

beforeEach(() => {
  catalogState.current = {
    status: "ready",
    catalog: makeCatalog(),
    setActive: vi.fn(async () => {}),
    focusAgent: vi.fn(),
    refresh: vi.fn(),
    activeAgentId: "claude-cli",
    activeModelId: "sonnet",
    error: null,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("AgentModelPicker — trigger label", () => {
  it("shows '<agent> · <model>' once catalog is ready", async () => {
    await renderPicker();
    const trigger = document.querySelector("[data-testid='agent-model-picker-trigger']");
    expect(trigger?.textContent).toContain("Claude Code");
    expect(trigger?.textContent).toContain("Claude Sonnet");
  });

  it("shows 'Loading…' while catalog is loading", async () => {
    catalogState.current = {
      ...catalogState.current!,
      status: "loading",
      catalog: null,
    };
    await renderPicker();
    const trigger = document.querySelector("[data-testid='agent-model-picker-trigger']");
    expect(trigger?.textContent).toMatch(/Loading/);
  });
});

describe("AgentModelPicker — popover open/close", () => {
  it("clicking the trigger opens the popover; clicking again closes it", async () => {
    const React = await import("react");
    const { act } = await import("react");
    void React;
    await renderPicker();
    const trigger = document.querySelector(
      "[data-testid='agent-model-picker-trigger']",
    ) as HTMLButtonElement;
    act(() => trigger.click());
    expect(document.querySelector("[data-testid='agent-model-picker-popover']")).not.toBeNull();
    act(() => trigger.click());
    expect(document.querySelector("[data-testid='agent-model-picker-popover']")).toBeNull();
  });

  it("toggles via the openAgentModelPicker CustomEvent and ignores raw Cmd+K", async () => {
    // The picker used to listen for plain Cmd+K via its own keydown handler,
    // which collided with the FindSkillsPalette's Cmd+K. The chord moved to
    // Cmd+Shift+M ("M for Model") AND the keyboard listener was removed from
    // this component — App.tsx now owns the keymap and dispatches an
    // `openAgentModelPicker` CustomEvent. We test that contract here.
    const { act } = await import("react");
    await renderPicker();
    expect(document.querySelector("[data-testid='agent-model-picker-popover']")).toBeNull();

    // Plain Cmd+K must be a no-op for this component now.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    });
    expect(document.querySelector("[data-testid='agent-model-picker-popover']")).toBeNull();

    // Raw Cmd+Shift+M is also a no-op here — the App-level hook owns the chord.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", metaKey: true, shiftKey: true }));
    });
    expect(document.querySelector("[data-testid='agent-model-picker-popover']")).toBeNull();

    // The CustomEvent is the contract — dispatching it opens the popover.
    act(() => {
      window.dispatchEvent(new CustomEvent("openAgentModelPicker"));
    });
    expect(document.querySelector("[data-testid='agent-model-picker-popover']")).not.toBeNull();

    // Dispatching it again closes.
    act(() => {
      window.dispatchEvent(new CustomEvent("openAgentModelPicker"));
    });
    expect(document.querySelector("[data-testid='agent-model-picker-popover']")).toBeNull();
  });

  it("Escape inside the popover closes it", async () => {
    const { act } = await import("react");
    await renderPicker();
    const trigger = document.querySelector(
      "[data-testid='agent-model-picker-trigger']",
    ) as HTMLButtonElement;
    act(() => trigger.click());
    expect(document.querySelector("[data-testid='agent-model-picker-popover']")).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector("[data-testid='agent-model-picker-popover']")).toBeNull();
  });
});

describe("AgentModelPicker — keyboard nav (F-002 regression)", () => {
  it("ArrowDown twice in the model pane focuses the third row, and Enter selects it", async () => {
    const { act } = await import("react");
    await renderPicker();
    const trigger = document.querySelector(
      "[data-testid='agent-model-picker-trigger']",
    ) as HTMLButtonElement;
    act(() => trigger.click());

    // Right Arrow → enter model pane
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    // Down twice
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });

    // The third model row should carry data-focused.
    const focusedRows = document.querySelectorAll(
      "[data-testid^='model-row-'][data-focused='true']",
    );
    expect(focusedRows.length).toBe(1);
    const focusedId = focusedRows[0]!.getAttribute("data-testid");
    // Three Claude Code models: sonnet (index 0), opus (1), haiku (2).
    expect(focusedId).toBe("model-row-haiku");

    // Enter should call setActive with the focused row's model id.
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(catalogState.current!.setActive).toHaveBeenCalledWith("claude-cli", "haiku");
  });

  it("Left Arrow returns focus to the agent pane", async () => {
    const { act } = await import("react");
    await renderPicker();
    const trigger = document.querySelector(
      "[data-testid='agent-model-picker-trigger']",
    ) as HTMLButtonElement;
    act(() => trigger.click());

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });
    // Now focus should be in models pane.
    let focused = document.querySelectorAll("[data-testid^='model-row-'][data-focused='true']");
    expect(focused.length).toBe(1);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    // Back in agent pane → no model row shows focus.
    focused = document.querySelectorAll("[data-testid^='model-row-'][data-focused='true']");
    expect(focused.length).toBe(0);
  });
});
