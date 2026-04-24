// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0703 — ModelRow must:
//   (a) use minHeight (not fixed height) so 3-line rows don't overflow and
//       visually overlap the next row (US-003, AC-US3-01).
//   (b) render "routing to <resolvedModel>" only on the row whose model.id is
//       referenced by the resolved ID (US-004, AC-US4-01..03).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type { AgentEntry } from "../../hooks/useAgentCatalog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function claudeCliAgent(resolvedModel: string | null): AgentEntry {
  return {
    id: "claude-cli",
    displayName: "Claude Code",
    available: true,
    wrapperFolder: null,
    wrapperFolderPresent: false,
    binaryAvailable: true,
    endpointReachable: null,
    ctaType: null,
    resolvedModel,
    models: [
      { id: "sonnet", displayName: "Claude Sonnet", billingMode: "subscription" },
      { id: "opus", displayName: "Claude Opus", billingMode: "subscription" },
      { id: "haiku", displayName: "Claude Haiku", billingMode: "subscription" },
    ],
  } as AgentEntry;
}

async function renderModelList(agent: AgentEntry, activeModelId: string | null = null): Promise<HTMLElement> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ModelList } = await import("../ModelList");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(ModelList, {
        agent,
        activeModelId,
        onSelect: vi.fn(),
        onOpenSettings: vi.fn(),
      }),
    );
  });
  return container;
}

describe("0703 — ModelRow layout (AC-US3-01)", () => {
  it("uses minHeight, not fixed height, so rows with resolvedModel can grow", async () => {
    const container = await renderModelList(
      claudeCliAgent("claude-opus-4-7[1m]"),
      "opus",
    );
    const rows = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    expect(rows.length).toBe(3);
    for (const row of rows) {
      // Fixed height would render the 3rd line outside its parent box.
      expect(row.style.height).toBe("");
      expect(row.style.minHeight).toMatch(/44px/);
    }
  });
});

describe("0703 — resolvedModel appears only on matching alias row (AC-US4-01..03)", () => {
  it("only the 'opus' row shows 'routing to claude-opus-4-7[1m]' when that is the resolved ID", async () => {
    const container = await renderModelList(
      claudeCliAgent("claude-opus-4-7[1m]"),
      "opus",
    );
    const resolvedCount = container.querySelectorAll('[data-testid$="-resolved"]').length;
    expect(resolvedCount).toBe(1);

    const opusRow = container.querySelector('[data-testid="model-row-opus"]');
    const sonnetRow = container.querySelector('[data-testid="model-row-sonnet"]');
    const haikuRow = container.querySelector('[data-testid="model-row-haiku"]');
    expect(opusRow?.textContent).toMatch(/routing to claude-opus-4-7\[1m\]/);
    expect(sonnetRow?.textContent ?? "").not.toMatch(/routing to/);
    expect(haikuRow?.textContent ?? "").not.toMatch(/routing to/);
  });

  it("shows 'routing to' on the 'sonnet' row when resolvedModel contains sonnet", async () => {
    const container = await renderModelList(claudeCliAgent("claude-sonnet-4-6"), "sonnet");
    const sonnetRow = container.querySelector('[data-testid="model-row-sonnet"]');
    expect(sonnetRow?.textContent).toMatch(/routing to claude-sonnet-4-6/);

    const opusRow = container.querySelector('[data-testid="model-row-opus"]');
    expect(opusRow?.textContent ?? "").not.toMatch(/routing to/);
  });

  it("renders no routing sub-line at all when resolvedModel is null", async () => {
    const container = await renderModelList(claudeCliAgent(null), "opus");
    expect(container.querySelectorAll('[data-testid$="-resolved"]').length).toBe(0);
  });
});
