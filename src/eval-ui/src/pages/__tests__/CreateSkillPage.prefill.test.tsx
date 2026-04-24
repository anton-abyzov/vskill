// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0703 — Hotfix: Generate-with-AI modal passes `description` via URL. The
// landing page must copy it into `aiPrompt` so the Generate button is enabled
// on arrival (US-001, AC-US1-01..03).
// ---------------------------------------------------------------------------

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { ConfigResponse, ProviderInfo } from "../../api";

// ---------------------------------------------------------------------------
// Capture setter calls across renders — the stub below reuses these refs.
// ---------------------------------------------------------------------------
const setAiPromptMock = vi.fn();
const setNameMock = vi.fn();
const setDescriptionMock = vi.fn();
const setPluginMock = vi.fn();

vi.mock("../../ConfigContext", () => ({
  useConfig: () => ({
    config: {
      provider: null,
      model: "sonnet",
      providers: [
        {
          id: "claude-cli",
          label: "Use current Claude Code session",
          available: true,
          models: [{ id: "sonnet", label: "Sonnet" }, { id: "opus", label: "Opus" }],
        },
      ] as ProviderInfo[],
      projectName: "vskill",
      root: "/tmp/vskill",
    } satisfies ConfigResponse,
    loading: false,
    updateConfig: vi.fn(),
    refreshConfig: vi.fn(),
  }),
}));

vi.mock("../../hooks/useCreateSkill", () => ({
  toKebab: (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
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
    setPlugin: setPluginMock,
    newPlugin: "",
    setNewPlugin: vi.fn(),
    availablePlugins: [],
    pathPreview: "plugins/x/skills/y",
    showPluginRecommendation: false,
    setShowPluginRecommendation: vi.fn(),
    pluginLayoutInfo: null,
    applyPluginRecommendation: vi.fn(),
    name: "",
    setName: setNameMock,
    description: "",
    setDescription: setDescriptionMock,
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
    setAiPrompt: setAiPromptMock,
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

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ agents: [] }),
  })) as unknown as typeof fetch;
  localStorage.clear();
  setAiPromptMock.mockClear();
  setNameMock.mockClear();
  setDescriptionMock.mockClear();
  setPluginMock.mockClear();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  // Reset hash so tests don't leak into each other.
  window.location.hash = "";
});

async function mountWithHash(hash: string): Promise<{ unmount: () => void }> {
  window.location.hash = hash;
  const { CreateSkillPage } = await import("../CreateSkillPage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(CreateSkillPage));
  });
  // flush mount effects
  await act(async () => { await Promise.resolve(); });
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("0703 — CreateSkillPage URL prefill populates aiPrompt", () => {
  it("AC-US1-01: copies ?description=… into aiPrompt so Generate is enabled", async () => {
    const h = await mountWithHash("#/create?mode=standalone&skillName=anton-greet&description=Does+X");
    try {
      expect(setAiPromptMock).toHaveBeenCalledWith("Does X");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-02: also populates sk.description for the SKILL.md preview", async () => {
    const h = await mountWithHash("#/create?mode=standalone&skillName=anton-greet&description=Does+X");
    try {
      expect(setDescriptionMock).toHaveBeenCalledWith("Does X");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-03: leaves aiPrompt alone when no ?description param is present", async () => {
    const h = await mountWithHash("#/create?mode=standalone&skillName=anton-greet");
    try {
      expect(setAiPromptMock).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });
});
