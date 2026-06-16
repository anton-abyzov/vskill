// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0875 WS2 — PublishDrawer "Generate with AI" must USE and DISPLAY the
// studio's selected default model (the one shown in the header picker).
//
// The header picker (AgentModelPicker) derives its active model from
// useAgentCatalog: catalog.activeAgent + catalog.activeModel, with the
// human-readable name coming from the active agent's matching model entry's
// displayName. PublishDrawer must resolve the SAME way so Generate-with-AI:
//   1. passes the active default model/provider to api.gitCommitMessage
//      (preferring it over the possibly-stale config props), and
//   2. visualizes which model writes the message ("Using <displayName>",
//      data-testid="publish-ai-model") — AI mode only.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGitCommitMessage = vi.fn();
const mockGitPublish = vi.fn();
const mockSubmitToQueue = vi.fn();
vi.mock("../../api", async () => ({
  api: {
    gitCommitMessage: (...a: unknown[]) => mockGitCommitMessage(...a),
    gitPublish: (...a: unknown[]) => mockGitPublish(...a),
    submitToQueue: (...a: unknown[]) => mockSubmitToQueue(...a),
  },
}));

vi.mock("../../preferences/lib/useDesktopBridge", () => ({
  openExternalUrlViaDesktop: vi.fn(async () => {}),
}));

vi.mock("../../hooks/useTier", () => ({
  useTier: () => ({ isFree: false, isPro: true }),
  PRICING_URL: "https://verified-skill.com/pricing",
}));
vi.mock("../PaywallModal", () => ({
  PaywallModal: ({ open }: { open: boolean }) => {
    if (!open) return null;
    const React = require("react");
    return React.createElement("div", { "data-testid": "paywall-modal" });
  },
}));

// The catalog hook is the SAME source AgentModelPicker reads. Mock it to a
// known active agent + model so the drawer should resolve the displayName and
// the wire id from it.
const mockUseAgentCatalog = vi.fn();
vi.mock("../../hooks/useAgentCatalog", () => ({
  useAgentCatalog: (...a: unknown[]) => mockUseAgentCatalog(...a),
}));

import { PublishDrawer } from "../PublishDrawer";

let container: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn>;

// A catalog whose active model is anthropic / claude-sonnet-4-6, surfaced to
// the user as "Claude Sonnet 4.6". This mirrors what the header shows.
function catalogReady() {
  return {
    status: "ready",
    catalog: {
      activeAgent: "anthropic",
      activeModel: "claude-sonnet-4-6",
      agents: [
        {
          id: "anthropic",
          displayName: "Anthropic API",
          available: true,
          models: [
            { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", billingMode: "per-token" },
            { id: "claude-opus-4-6", displayName: "Claude Opus 4.6", billingMode: "per-token" },
          ],
        },
      ],
    },
    error: null,
    openRouterError: null,
    focusAgent: vi.fn(),
    refresh: vi.fn(),
    activeAgentId: "anthropic",
    activeModelId: "claude-sonnet-4-6",
    setActive: vi.fn(async () => {}),
  };
}

function catalogLoading() {
  return {
    status: "loading",
    catalog: null,
    error: null,
    openRouterError: null,
    focusAgent: vi.fn(),
    refresh: vi.fn(),
    activeAgentId: null,
    activeModelId: null,
    setActive: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mockGitCommitMessage.mockReset();
  mockGitPublish.mockReset();
  mockSubmitToQueue.mockReset();
  mockUseAgentCatalog.mockReset();
  onClose = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("PublishDrawer — active default model (0875 WS2)", () => {
  it("AI mode shows 'Using <displayName>' for the active model (publish-ai-model)", async () => {
    mockUseAgentCatalog.mockReturnValue(catalogReady());
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: x" });
    await act(async () => {
      root.render(
        <PublishDrawer
          provider="claude-cli"
          model="sonnet"
          remoteUrl="git@github.com:owner/repo.git"
          fileCount={1}
          onClose={onClose}
          defaultMode="ai"
        />,
      );
      await flush();
    });
    const el = container.querySelector('[data-testid="publish-ai-model"]');
    expect(el).toBeTruthy();
    expect(el?.textContent).toContain("Claude Sonnet 4.6");
  });

  it("does NOT show the active-model line in manual mode", async () => {
    mockUseAgentCatalog.mockReturnValue(catalogReady());
    await act(async () => {
      root.render(
        <PublishDrawer
          provider="claude-cli"
          model="sonnet"
          remoteUrl="git@github.com:owner/repo.git"
          fileCount={1}
          onClose={onClose}
          defaultMode="manual"
        />,
      );
      await flush();
    });
    expect(container.querySelector('[data-testid="publish-ai-model"]')).toBeNull();
  });

  it("Generate calls api.gitCommitMessage with the ACTIVE model, not the stale props", async () => {
    mockUseAgentCatalog.mockReturnValue(catalogReady());
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: from active" });
    await act(async () => {
      root.render(
        <PublishDrawer
          provider="claude-cli"
          model="sonnet"
          remoteUrl="git@github.com:owner/repo.git"
          fileCount={1}
          onClose={onClose}
          defaultMode="ai"
        />,
      );
      await flush();
    });
    expect(mockGitCommitMessage).toHaveBeenCalledTimes(1);
    expect(mockGitCommitMessage).toHaveBeenCalledWith({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });

  it("falls back to the config props when the catalog isn't loaded yet", async () => {
    mockUseAgentCatalog.mockReturnValue(catalogLoading());
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: fallback" });
    await act(async () => {
      root.render(
        <PublishDrawer
          provider="claude-cli"
          model="sonnet"
          remoteUrl="git@github.com:owner/repo.git"
          fileCount={1}
          onClose={onClose}
          defaultMode="ai"
        />,
      );
      await flush();
    });
    expect(mockGitCommitMessage).toHaveBeenCalledWith({
      provider: "claude-cli",
      model: "sonnet",
    });
    // 0875 AC-US2-03 — AI mode ALWAYS shows which model writes the message. During
    // the pre-catalog-load window the indicator falls back to the effective model
    // id (the config prop) rather than rendering blank.
    const indicator = container.querySelector('[data-testid="publish-ai-model"]');
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("sonnet");
  });
});
