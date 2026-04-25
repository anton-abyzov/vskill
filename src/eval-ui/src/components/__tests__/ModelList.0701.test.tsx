// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0701 T-006 + T-007: ModelList renders resolvedModel sub-line on Claude Code
// rows and real Anthropic price via formatMetadata.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type { AgentEntry, ModelEntry } from "../../hooks/useAgentCatalog";

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
    ],
  } as AgentEntry;
}

function anthropicAgent(): AgentEntry {
  return {
    id: "anthropic",
    displayName: "Anthropic API",
    available: true,
    wrapperFolder: null,
    wrapperFolderPresent: false,
    binaryAvailable: true,
    endpointReachable: null,
    ctaType: null,
    models: [
      {
        id: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6 (API)",
        billingMode: "per-token",
        pricing: { prompt: 3, completion: 15 },
      },
    ],
  } as AgentEntry;
}

async function renderModelList(agent: AgentEntry, activeModelId: string | null = null) {
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

describe("0701 T-006: ModelList renders resolvedModel sub-line", () => {
  it("shows 'routing to <id>' when Claude Code agent has resolvedModel", async () => {
    const container = await renderModelList(
      claudeCliAgent("claude-opus-4-7[1m]"),
      "opus",
    );
    expect(container.textContent).toMatch(/routing to claude-opus-4-7\[1m\]/);
  });

  it("omits 'routing to' line when resolvedModel is null", async () => {
    const container = await renderModelList(claudeCliAgent(null), "opus");
    expect(container.textContent).not.toMatch(/routing to/);
  });

  it("does not render 'routing to' on non-claude-cli agents", async () => {
    const container = await renderModelList(anthropicAgent(), "claude-sonnet-4-6");
    expect(container.textContent).not.toMatch(/routing to/);
  });
});

describe("0701 T-007: Anthropic price rendering", () => {
  it("renders $3.00 / $15.00 per 1M tokens for Sonnet 4.6", async () => {
    const container = await renderModelList(anthropicAgent(), "claude-sonnet-4-6");
    expect(container.textContent).toMatch(/\$3\.00 \/ \$15\.00 per 1M tokens/);
  });

  it("renders price with context window when provided", async () => {
    const agent: AgentEntry = {
      ...anthropicAgent(),
      models: [
        {
          id: "claude-sonnet-4-6",
          displayName: "Claude Sonnet 4.6 (API)",
          billingMode: "per-token",
          pricing: { prompt: 3, completion: 15 },
          contextWindow: 200_000,
        } as ModelEntry,
      ],
    };
    const container = await renderModelList(agent, "claude-sonnet-4-6");
    expect(container.textContent).toMatch(/200k ctx · \$3\.00 \/ \$15\.00 per 1M tokens/);
  });
});

// 0710 — OpenRouter rows reuse the same per-1M code path as Anthropic.
// Once the server canonicalizes pricing units, ModelList renders OpenRouter
// rows correctly with no source change to ModelList itself.
describe("0710: ModelList renders OpenRouter rows with per-1M values", () => {
  function openRouterAgent(model: ModelEntry): AgentEntry {
    return {
      id: "openrouter",
      displayName: "OpenRouter",
      available: true,
      wrapperFolder: null,
      wrapperFolderPresent: false,
      binaryAvailable: true,
      endpointReachable: null,
      ctaType: null,
      models: [model],
    } as AgentEntry;
  }

  it("renders $1.25 / $5.00 per 1M tokens for an OpenRouter model on the per-token path", async () => {
    const agent = openRouterAgent({
      id: "openrouter/test-model",
      displayName: "OR Test",
      billingMode: "per-token",
      pricing: { prompt: 1.25, completion: 5 }, // server-canonicalized per-1M
      contextWindow: 200_000,
    } as ModelEntry);
    const container = await renderModelList(agent, "openrouter/test-model");
    expect(container.textContent).toMatch(/200k ctx · \$1\.25 \/ \$5\.00 per 1M tokens/);
  });

  it("does not render '$0.00' when given non-zero per-1M values (proves units match)", async () => {
    const agent = openRouterAgent({
      id: "openrouter/sonnet-mirror",
      displayName: "OR Sonnet Mirror",
      billingMode: "per-token",
      pricing: { prompt: 3, completion: 15 },
    } as ModelEntry);
    const container = await renderModelList(agent, "openrouter/sonnet-mirror");
    const text = container.textContent ?? "";
    // Must show the real Sonnet-class price, not the $0.00 regression.
    expect(text).toMatch(/\$3\.00 \/ \$15\.00/);
    expect(text).not.toMatch(/\$0\.00 \/ \$0\.00/);
  });
});
