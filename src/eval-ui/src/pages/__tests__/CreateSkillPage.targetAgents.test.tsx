// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0703 — Hotfix: when the active scope agent is Claude Code, the Target
// Agents picker must not offer cross-platform options (Cursor, Codex CLI,
// Copilot, Amp, etc.). A Claude-Code-scoped skill lives in .claude/skills
// and doesn't need a `target-agents:` header.
// ---------------------------------------------------------------------------

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { ConfigResponse, ProviderInfo } from "../../api";

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
          models: [{ id: "sonnet", label: "Sonnet" }],
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
    layout: { detectedLayouts: [], suggestedLayout: 1, existingSkills: [], root: "/tmp" },
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

const INSTALLED_AGENTS = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
    isUniversal: false,
    installed: true,
  },
  {
    id: "cursor",
    displayName: "Cursor",
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
    isUniversal: true,
    installed: true,
  },
  {
    id: "codex-cli",
    displayName: "Codex CLI",
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
    isUniversal: true,
    installed: true,
  },
];

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ agents: INSTALLED_AGENTS }),
  })) as unknown as typeof fetch;
  localStorage.clear();
  window.location.hash = "";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  window.location.hash = "";
});

async function mountPage(): Promise<{ container: HTMLElement; unmount: () => void }> {
  const { CreateSkillPage } = await import("../CreateSkillPage");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(CreateSkillPage));
  });
  // flush mount effects + API fetch resolution
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("0703 — Target Agents scoping to active scope agent", () => {
  it("AC-US6-01: hides Cursor / Codex CLI / Copilot rows when activeAgent is claude-code", async () => {
    localStorage.setItem("vskill.studio.prefs", JSON.stringify({ activeAgent: "claude-code" }));
    const h = await mountPage();
    try {
      const text = h.container.textContent ?? "";
      // Debug aid: if this fires the mount isn't even reaching the section.
      expect(text).toMatch(/Describe Your Skill/);
      // Sanity: Target Agents header SHOULD appear only if we intend to render
      // it. For Claude Code scope we expect the header to be absent (section
      // suppressed entirely).
      expect(text).not.toMatch(/Target Agents/);
      expect(text).not.toMatch(/\bCursor\b/);
      expect(text).not.toMatch(/\bCodex CLI\b/);
    } finally {
      h.unmount();
    }
  });

  it("AC-US6-02: shows all universal agents when activeAgent is NOT claude-code", async () => {
    localStorage.setItem("vskill.studio.prefs", JSON.stringify({ activeAgent: "cursor" }));
    const h = await mountPage();
    try {
      const text = h.container.textContent ?? "";
      expect(text).toMatch(/Cursor/);
      expect(text).toMatch(/Codex CLI/);
    } finally {
      h.unmount();
    }
  });

  it("sanity: installed agents actually render without activeAgent preference", async () => {
    // No preference set → default activeAgent is null → section should show all agents.
    const h = await mountPage();
    try {
      const text = h.container.textContent ?? "";
      // If this assertion fails, the test harness isn't actually rendering the
      // Target Agents section (and the other two tests are vacuously passing).
      expect(text).toMatch(/Target Agents/);
      expect(text).toMatch(/Cursor/);
    } finally {
      h.unmount();
    }
  });
});
