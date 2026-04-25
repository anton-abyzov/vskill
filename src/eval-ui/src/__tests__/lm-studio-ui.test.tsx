// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0677 — LM Studio UI smoke tests.
//
// 0682 update (F-004): the legacy ModelSelector component was deleted in
// favour of AgentModelPicker. The original ModelSelector LM Studio tests
// (a/b/c below) are now covered by:
//   - useAgentCatalog config-merge tests (AgentModelPicker.test.tsx)
//   - api-routes config tests for the lm-studio provider entry
// This file retains only the RunPanel and ComparisonPage parity coverage,
// which is independent of which picker component renders.
//
// Retained coverage:
//   (d) When the active provider is lm-studio, the RunPanel surfaces a free
//       cost label parallel to the Ollama / Gemini-CLI treatment.
//   (e) ComparisonPage shows a "Local" tag when the active provider is a
//       local server (lm-studio or ollama).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { ConfigResponse, ProviderInfo } from "../api";

// ---------------------------------------------------------------------------
// useConfig() mock — returns a ConfigResponse with the LM Studio provider
// active so RunPanel / ComparisonPage can read config.provider.
// ---------------------------------------------------------------------------

const configRef: { current: ConfigResponse | null } = { current: null };

vi.mock("../ConfigContext", () => ({
  useConfig: () => ({
    config: configRef.current,
    loading: false,
    updateConfig: vi.fn(),
    refreshConfig: vi.fn(),
  }),
}));

// Avoid the full OpenRouter search dropdown fetch during render.
vi.mock("../components/ModelSearchDropdown", () => ({
  ModelSearchDropdown: () => null,
}));

// Stub react-router-dom hooks used by ComparisonPage so we can render it
// without a <Router> wrapper.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useParams: () => ({ plugin: "p", skill: "s" }),
    useSearchParams: () => [new URLSearchParams(), () => {}],
    Link: ({ children }: { children: unknown }) => children,
  };
});

vi.mock("../sse", () => ({
  useSSE: () => ({
    events: [],
    running: false,
    done: false,
    error: null,
    start: () => {},
  }),
}));

vi.mock("../hooks/useProgressiveSummary", () => ({
  useProgressiveSummary: () => ({ summary: null, progress: 0 }),
}));

// Stub WorkspaceContext for RunPanel so we don't need the real provider tree.
vi.mock("../pages/workspace/WorkspaceContext", () => {
  const stub = {
    state: {
      evals: { evals: [{ id: 1, name: "c1", assertions: [{}, {}] }] },
      caseRunStates: new Map(),
      bulkRunActive: false,
      latestBenchmark: null,
      inlineResults: new Map(),
    },
    runCase: () => {},
    runAll: () => {},
    cancelCase: () => {},
    cancelAll: () => {},
    isReadOnly: false,
  };
  return {
    useWorkspace: () => stub,
    WorkspaceProvider: ({ children }: { children: unknown }) => children,
  };
});

const { RunPanel } = await import("../pages/workspace/RunPanel");
const { ComparisonPage } = await import("../pages/ComparisonPage");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(lm: ProviderInfo | null, activeProvider?: string, activeModel?: string): ConfigResponse {
  const base: ProviderInfo[] = [
    { id: "claude-cli", label: "Claude CLI", available: true, models: [{ id: "sonnet", label: "Claude Sonnet" }] },
    { id: "ollama", label: "Ollama (local, free)", available: false, models: [] },
  ];
  const providers: ProviderInfo[] = lm ? [...base, lm] : base;
  return {
    provider: activeProvider ?? null,
    model: activeModel ?? "sonnet",
    providers,
    projectName: "vskill",
    root: "/tmp/vskill",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LM Studio config shape — surfaces in providers array", () => {
  it("passes lm-studio provider through the config object intact", () => {
    const lm: ProviderInfo = {
      id: "lm-studio",
      label: "LM Studio (local, free)",
      available: true,
      models: [
        { id: "qwen2.5-coder-7b", label: "qwen2.5-coder-7b" },
      ],
    };
    configRef.current = makeConfig(lm);
    const cfg = configRef.current!;
    const found = cfg.providers.find((p) => p.id === "lm-studio");
    expect(found).toBeDefined();
    expect(found!.models.map((m) => m.id)).toEqual(["qwen2.5-coder-7b"]);
  });

  it("omits lm-studio when not detected", () => {
    configRef.current = makeConfig(null);
    const found = configRef.current!.providers.find((p) => p.id === "lm-studio");
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// RunPanel — cost label parity with Ollama
// ---------------------------------------------------------------------------

describe("RunPanel — lm-studio provider cost label", () => {
  it("shows 'Cost: Free' when config.provider === 'lm-studio'", () => {
    configRef.current = makeConfig(
      { id: "lm-studio", label: "LM Studio", available: true, models: [{ id: "qwen", label: "qwen" }] },
      "lm-studio",
      "qwen",
    );
    const markup = renderToStaticMarkup(<RunPanel />);
    expect(markup).toContain("Cost: Free");
  });

  it("does NOT show 'Cost: Free' when config.provider === 'anthropic'", () => {
    configRef.current = makeConfig(null, "anthropic", "claude-sonnet-4-6");
    const markup = renderToStaticMarkup(<RunPanel />);
    // Anthropic is a paid provider so the "Cost: Free" label must not appear.
    expect(markup).not.toContain("Cost: Free");
  });
});

// ---------------------------------------------------------------------------
// ComparisonPage — surfaces a "Local" tag next to the model name when the
// active provider is a local server (Ollama or LM Studio). Parity check.
// ---------------------------------------------------------------------------

describe("ComparisonPage — 'Local' tag for local providers", () => {
  it("shows a 'Local' tag when config.provider === 'lm-studio'", () => {
    configRef.current = makeConfig(
      { id: "lm-studio", label: "LM Studio", available: true, models: [{ id: "qwen", label: "qwen" }] },
      "lm-studio",
      "qwen",
    );
    const markup = renderToStaticMarkup(<ComparisonPage />);
    expect(markup).toContain("Local");
    expect(markup).toContain("qwen");
  });

  it("does NOT show 'Local' tag when config.provider === 'anthropic'", () => {
    configRef.current = makeConfig(null, "anthropic", "claude-sonnet-4-6");
    const markup = renderToStaticMarkup(<ComparisonPage />);
    // No "Local" chip should be rendered for cloud providers.
    expect(markup).not.toMatch(/>\s*Local\s*</);
  });

  it("also shows the 'Local' tag when config.provider === 'ollama' (parity)", () => {
    configRef.current = makeConfig(null, "ollama", "llama3.1:8b");
    const markup = renderToStaticMarkup(<ComparisonPage />);
    expect(markup).toContain("Local");
  });
});
