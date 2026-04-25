// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0710 T-002: ModelSearchDropdown.formatPricing must NOT multiply by 1_000_000.
// After 0710 the wire contract for `pricing.{prompt,completion}` is USD per 1M
// tokens server-side (canonicalized at /api/openrouter/models). The dropdown
// formats the value directly; double-multiplying would produce $3,000,000.00/1M.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OpenRouterModel } from "../../types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock the api module so the dropdown's mount-effect resolves with a controlled
// catalogue without hitting the network.
vi.mock("../../api", () => ({
  api: {
    searchModels: vi.fn(),
  },
}));

async function renderDropdown(models: OpenRouterModel[]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ModelSearchDropdown } = await import("../ModelSearchDropdown");
  const { api } = await import("../../api");
  (api.searchModels as ReturnType<typeof vi.fn>).mockResolvedValue({ models });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(ModelSearchDropdown, {
        value: "",
        onChange: vi.fn(),
      }),
    );
  });

  // Open the dropdown — focus opens the popover; the empty act() drains
  // pending microtasks (mount-effect's searchModels promise + the
  // setState-triggered re-render) before assertions inspect textContent.
  const input = container.querySelector("input") as HTMLInputElement;
  await act(async () => {
    input.focus();
    input.dispatchEvent(new Event("focus", { bubbles: true }));
  });
  await act(async () => {});

  return container;
}

describe("0710: ModelSearchDropdown formats per-1M pricing without multiplying", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("TC-004: renders '$3.00/1M' for Sonnet-class per-1M input (NOT '$3,000,000.00/1M')", async () => {
    const container = await renderDropdown([
      {
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4",
        pricing: { prompt: 3, completion: 15 }, // per-1M wire contract
      },
    ]);

    const text = container.textContent ?? "";
    expect(text).toMatch(/\$3\.00\/1M/);
    expect(text).not.toMatch(/\$3,000,000\.00\/1M/);
    expect(text).not.toMatch(/3000000/);
  });

  it("TC-005: renders 'Free' when pricing.prompt is 0", async () => {
    const container = await renderDropdown([
      {
        id: "free/free-model",
        name: "Free Model",
        pricing: { prompt: 0, completion: 0 },
      },
    ]);

    expect(container.textContent ?? "").toMatch(/Free/);
  });

  it("TC-006: renders fractional cents correctly (e.g. $0.25/1M for Haiku-class)", async () => {
    const container = await renderDropdown([
      {
        id: "anthropic/claude-haiku-4",
        name: "Claude Haiku 4",
        pricing: { prompt: 0.25, completion: 1.25 }, // per-1M
      },
    ]);

    expect(container.textContent ?? "").toMatch(/\$0\.25\/1M/);
  });
});
