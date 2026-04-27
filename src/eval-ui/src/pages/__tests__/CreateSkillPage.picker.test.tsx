// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0678 — T-004: CreateSkillPage source-model picker jsdom tests.
//
// Four scenarios (T-004 Test Plan):
//   (a) no prior selection + 2 providers detected →
//       picker preselects { claude-cli, sonnet } and caption reads "Default"
//       (AC-US1-01, AC-US1-02)
//   (b) prior selection for a currently-detected provider →
//       picker preselects the persisted value (AC-US1-03 round-trip)
//   (c) prior selection for a provider NOT currently detected →
//       picker falls back to { claude-cli, sonnet } AND surfaces a one-time
//       non-modal toast with the AC-US1-05 copy
//   (d) zero providers detected → picker is disabled with the AC-US1-04
//       tooltip copy exactly
//
// These tests assert the component's rendered DOM; they do not cover the
// skill-generation POST wiring (that is covered on the server side by
// skill-create-routes-model-accept.test.ts).
// ---------------------------------------------------------------------------

// Tells React we're running inside a test harness so act() batching works.
// Must be set before React is imported / rendered.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { ConfigResponse, ProviderInfo } from "../../api";
import {
  STUDIO_PREFS_KEY,
  writeStudioPreference,
} from "../../hooks/useStudioPreferences";

// ---------------------------------------------------------------------------
// Shared mock refs
// ---------------------------------------------------------------------------

const configRef: { current: ConfigResponse | null } = { current: null };

// ---------------------------------------------------------------------------
// Hoisted module mocks — must be declared before the CreateSkillPage import
// ---------------------------------------------------------------------------

vi.mock("../../StudioContext", () => ({
  useStudio: () => ({
    refreshSkills: vi.fn(),
    revealSkill: vi.fn(),
  }),
}));

vi.mock("../../ConfigContext", () => ({
  useConfig: () => ({
    config: configRef.current,
    loading: false,
    updateConfig: vi.fn(),
    refreshConfig: vi.fn(),
  }),
}));

// Stub the whole useCreateSkill hook so the page renders without hitting the
// real skill-creation pipeline. Only the fields the JSX reads are populated.
vi.mock("../../hooks/useCreateSkill", () => ({
  toKebab: (s: string, _strict?: boolean) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
  useCreateSkill: () => ({
    mode: "ai",
    setMode: vi.fn(),
    layoutLoading: false,
    layout: {
      detectedLayouts: [],
      suggestedLayout: 1,
      existingSkills: [],
      root: "/tmp",
    },
    creatableLayouts: [{ layout: 1, label: "plugin", existingPlugins: [] }],
    selectedLayout: 1,
    setSelectedLayout: vi.fn(),
    plugin: "",
    setPlugin: vi.fn(),
    newPlugin: "",
    setNewPlugin: vi.fn(),
    availablePlugins: [],
    pathPreview: "plugins/x/skills/y",
    showPluginRecommendation: false,
    setShowPluginRecommendation: vi.fn(),
    pluginLayoutInfo: null,
    applyPluginRecommendation: vi.fn(),
    name: "",
    setName: vi.fn(),
    description: "",
    setDescription: vi.fn(),
    model: "",
    setModel: vi.fn(),
    allowedTools: "",
    setAllowedTools: vi.fn(),
    body: "",
    setBody: vi.fn(),
    bodyViewMode: "write",
    setBodyViewMode: vi.fn(),
    targetAgents: [],
    setTargetAgents: vi.fn(),
    aiPrompt: "",
    setAiPrompt: vi.fn(),
    promptRef: { current: null },
    generating: false,
    aiProgress: [],
    aiError: null,
    aiClassifiedError: null,
    clearAiError: vi.fn(),
    handleGenerate: vi.fn(),
    handleCancelGenerate: vi.fn(),
    handleCreate: vi.fn(),
    creating: false,
    error: null,
    draftSaved: false,
  }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Link: ({ children, to: _to, ...rest }: { children: React.ReactNode; to: string }) =>
      React.createElement("a", rest, children),
  };
});

// Stub fetch (CreateSkillPage loads /api/agents/installed on mount).
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ agents: [] }),
  })) as unknown as typeof fetch;
  localStorage.clear();
  configRef.current = null;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(providers: ProviderInfo[]): ConfigResponse {
  return {
    provider: null,
    model: "sonnet",
    providers,
    projectName: "vskill",
    root: "/tmp/vskill",
  };
}

const claudeProvider: ProviderInfo = {
  id: "claude-cli",
  label: "Use current Claude Code session",
  available: true,
  models: [{ id: "sonnet", label: "Sonnet" }, { id: "opus", label: "Opus" }],
};
const ollamaProvider: ProviderInfo = {
  id: "ollama" as ProviderInfo["id"],
  label: "Ollama (local, free)",
  available: true,
  models: [{ id: "qwen2.5-coder:7b", label: "qwen2.5-coder" }],
};

async function mountCreatePage(): Promise<{ container: HTMLElement; root: Root; unmount: () => void }> {
  const { CreateSkillPage } = await import("../CreateSkillPage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(CreateSkillPage));
  });
  // flush effects (fetch /api/agents/installed, hydrate from prefs)
  await act(async () => { await Promise.resolve(); });
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function querySelectByLabel(container: HTMLElement, labelText: string): HTMLSelectElement {
  const labels = Array.from(container.querySelectorAll("label"));
  const label = labels.find((l) => l.textContent?.toLowerCase().includes(labelText.toLowerCase()));
  if (!label) throw new Error(`label matching "${labelText}" not found`);
  // The select is the next sibling <select> inside the same parent <div>.
  const select = label.parentElement?.querySelector("select");
  if (!select) throw new Error(`select near label "${labelText}" not found`);
  return select as HTMLSelectElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("0678 — CreateSkillPage source-model picker", () => {
  // (a) AC-US1-01, AC-US1-02
  it("preselects claude-cli/sonnet and shows 'Default' caption when no prior selection exists", async () => {
    configRef.current = makeConfig([claudeProvider, ollamaProvider]);
    const h = await mountCreatePage();
    try {
      const providerSelect = querySelectByLabel(h.container, "Provider");
      const modelSelect = querySelectByLabel(h.container, "Model");
      expect(providerSelect.value).toBe("claude-cli");
      expect(modelSelect.value).toBe("sonnet");
      // "Default" caption appears near the picker when the current value
      // is the default pair AND no persisted selection exists.
      const text = h.container.textContent ?? "";
      expect(text).toMatch(/Default/);
    } finally {
      h.unmount();
    }
  });

  // (b) AC-US1-03 — persisted value hydrates the picker on mount
  it("preselects the persisted { provider, model } when it is still available", async () => {
    configRef.current = makeConfig([claudeProvider, ollamaProvider]);
    writeStudioPreference("skillGenModel", { provider: "ollama", model: "qwen2.5-coder:7b" });
    const h = await mountCreatePage();
    try {
      const providerSelect = querySelectByLabel(h.container, "Provider");
      const modelSelect = querySelectByLabel(h.container, "Model");
      expect(providerSelect.value).toBe("ollama");
      expect(modelSelect.value).toBe("qwen2.5-coder:7b");
    } finally {
      h.unmount();
    }
  });

  // AC-US1-03 cont'd — changing the selection writes to preferences
  it("writes the new selection to localStorage on change", async () => {
    configRef.current = makeConfig([claudeProvider, ollamaProvider]);
    const h = await mountCreatePage();
    try {
      const providerSelect = querySelectByLabel(h.container, "Provider");
      await act(async () => {
        providerSelect.value = "ollama";
        providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => { await Promise.resolve(); });
      const raw = localStorage.getItem(STUDIO_PREFS_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.skillGenModel).toBeDefined();
      expect(parsed.skillGenModel.provider).toBe("ollama");
      expect(parsed.skillGenModel.model).toBe("qwen2.5-coder:7b");
    } finally {
      h.unmount();
    }
  });

  // (c) AC-US1-05 — persisted provider is gone → fallback + toast
  it("falls back to default and surfaces a toast when the persisted provider is no longer detected", async () => {
    // Persisted: ollama, but current config does NOT have ollama
    writeStudioPreference("skillGenModel", { provider: "ollama", model: "qwen2.5-coder:7b" });
    configRef.current = makeConfig([claudeProvider]); // ollama missing
    const h = await mountCreatePage();
    try {
      const providerSelect = querySelectByLabel(h.container, "Provider");
      const modelSelect = querySelectByLabel(h.container, "Model");
      expect(providerSelect.value).toBe("claude-cli");
      expect(modelSelect.value).toBe("sonnet");
      const text = h.container.textContent ?? "";
      // AC-US1-05 copy: "Previous selection `<provider>/<model>` unavailable — reverted to default."
      expect(text).toMatch(/Previous selection/i);
      expect(text).toMatch(/ollama/);
      expect(text).toMatch(/qwen2\.5-coder:7b/);
      expect(text).toMatch(/reverted to default/i);
    } finally {
      h.unmount();
    }
  });

  // (d) AC-US1-04 — zero detected providers → disabled + tooltip
  it("renders the picker disabled with the exact tooltip copy when no providers are detected", async () => {
    // All providers unavailable
    const allUnavailable = [
      { ...claudeProvider, available: false },
      { ...ollamaProvider, available: false },
    ];
    configRef.current = makeConfig(allUnavailable);
    const h = await mountCreatePage();
    try {
      const providerSelect = querySelectByLabel(h.container, "Provider");
      expect(providerSelect.disabled).toBe(true);
      // AC-US1-04 copy (tooltip via title= attribute on the wrapper):
      const expectedTooltip =
        "Install a provider (Ollama / LM Studio / OpenRouter) or run `claude login` to enable model selection.";
      // The tooltip can live on either the select itself or on an ancestor.
      const titleAttr = providerSelect.getAttribute("title")
        ?? providerSelect.closest("[title]")?.getAttribute("title");
      expect(titleAttr).toBe(expectedTooltip);
    } finally {
      h.unmount();
    }
  });
});
