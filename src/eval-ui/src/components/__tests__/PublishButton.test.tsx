// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0759 / 0856 — PublishButton tests.
// Suppress React act() environment warning in Vitest + jsdom:
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
//
// PublishButton owns the publish flow: click → api.gitDiff probe. On a clean
// tree it calls api.gitPublish then, when a skillName is known (0856), submits
// IN-APP via api.submitToQueue; otherwise it opens verified-skill.com through
// the desktop shell bridge. On failure it dispatches an error toast and does
// not open anything.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const mockGitPublish = vi.fn();
const mockGitDiff = vi.fn();
const mockSubmitToQueue = vi.fn();
vi.mock("../../api", async () => ({
  api: {
    gitPublish: (...args: unknown[]) => mockGitPublish(...args),
    gitDiff: (...args: unknown[]) => mockGitDiff(...args),
    submitToQueue: (...args: unknown[]) => mockSubmitToQueue(...args),
  },
}));

const mockOpenExternal = vi.fn(async () => {});
vi.mock("../../preferences/lib/useDesktopBridge", () => ({
  openExternalUrlViaDesktop: (...a: unknown[]) => mockOpenExternal(...a),
}));

// 0874 — the dirty-tree path mounts PublishDrawer, which now reads useTier and
// mounts PaywallModal. Stub both so this test stays provider-free.
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

import { PublishButton } from "../PublishButton";

let container: HTMLDivElement;
let root: Root;
let dispatchEventSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
  mockGitPublish.mockReset();
  mockGitDiff.mockReset();
  mockSubmitToQueue.mockReset();
  mockOpenExternal.mockClear();
  // Default: clean tree (no dirty changes) so onClick takes the direct path.
  mockGitDiff.mockResolvedValue({ hasChanges: false, fileCount: 0 });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  dispatchEventSpy.mockRestore();
});

function getButton(): HTMLButtonElement {
  const btn = container.querySelector('button[aria-label="Publish"]');
  if (!btn) throw new Error("Publish button not found");
  return btn as HTMLButtonElement;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("PublishButton", () => {
  it("renders a button with accessible name 'Publish'", () => {
    act(() => {
      root.render(<PublishButton remoteUrl="git@github.com:owner/repo.git" />);
    });
    expect(getButton()).toBeTruthy();
  });

  it("clean tree + no skillName: opens verified-skill.com via the desktop shell bridge", async () => {
    mockGitPublish.mockResolvedValueOnce({
      success: true,
      commitSha: "abc1234def567890",
      branch: "main",
      remoteUrl: "git@github.com:owner/repo.git",
    });

    act(() => {
      root.render(<PublishButton remoteUrl="git@github.com:owner/repo.git" />);
    });
    await act(async () => {
      getButton().click();
      await flush();
    });

    expect(mockSubmitToQueue).not.toHaveBeenCalled();
    expect(mockOpenExternal).toHaveBeenCalledTimes(1);
    expect(mockOpenExternal.mock.calls[0][0]).toBe(
      "https://verified-skill.com/submit?repo=https%3A%2F%2Fgithub.com%2Fowner%2Frepo",
    );
  });

  it("clean tree + skillName: submits IN-APP and toasts the created outcome", async () => {
    mockGitPublish.mockResolvedValueOnce({
      success: true,
      commitSha: "abc1234def567890",
      branch: "main",
      remoteUrl: "git@github.com:owner/repo.git",
    });
    mockSubmitToQueue.mockResolvedValueOnce({ kind: "created", id: "s1", skillName: "greet", skillPath: "p", state: "RECEIVED", createdAt: "x" });

    act(() => {
      root.render(<PublishButton remoteUrl="git@github.com:owner/repo.git" skillName="greet" skillPath="skills/greet" />);
    });
    await act(async () => {
      getButton().click();
      await flush();
    });

    expect(mockSubmitToQueue).toHaveBeenCalledWith({
      repoUrl: "https://github.com/owner/repo",
      skillName: "greet",
      skillPath: "skills/greet",
      source: "studio-submit",
      privacy: "public",
      tenantId: undefined,
    });
    expect(mockOpenExternal).not.toHaveBeenCalled();
    const toastCall = dispatchEventSpy.mock.calls.find((c) => (c[0] as Event).type === "studio:toast");
    const ev = toastCall![0] as CustomEvent<{ message: string; severity: string }>;
    expect(ev.detail.severity).toBe("info");
    expect(ev.detail.message).toContain("greet");
  });

  it("non-github remote + skillName: push succeeds → website fallback (info), NOT 'Publish failed'", async () => {
    // GitLab remote → normalizeRemoteUrl throws → in-app submit is impossible.
    // The push already succeeded, so the flow must degrade to the website
    // (info toast), never surface an error toast.
    mockGitPublish.mockResolvedValueOnce({
      success: true,
      commitSha: "deadbeef1234",
      branch: "main",
      remoteUrl: "git@gitlab.com:owner/repo.git",
    });

    act(() => {
      root.render(<PublishButton remoteUrl="git@gitlab.com:owner/repo.git" skillName="greet" />);
    });
    await act(async () => {
      getButton().click();
      await flush();
    });

    // Did NOT attempt an in-app submit (no valid github repoUrl).
    expect(mockSubmitToQueue).not.toHaveBeenCalled();
    // Degraded to opening the bare website submit page.
    expect(mockOpenExternal).toHaveBeenCalledTimes(1);
    expect(mockOpenExternal.mock.calls[0][0]).toBe("https://verified-skill.com/submit");
    // Toast is INFO (push succeeded), never the error "Publish failed".
    const toasts = dispatchEventSpy.mock.calls
      .filter((c) => (c[0] as Event).type === "studio:toast")
      .map((c) => (c[0] as CustomEvent<{ message: string; severity: string }>).detail);
    expect(toasts.some((t) => t.severity === "error")).toBe(false);
    expect(toasts.some((t) => t.severity === "info" && t.message.toLowerCase().includes("submit"))).toBe(true);
    expect(toasts.some((t) => t.message.includes("Publish failed"))).toBe(false);
  });

  it("on failure: does NOT open anything and dispatches an error toast", async () => {
    mockGitPublish.mockRejectedValueOnce(new Error("rejected: non-fast-forward"));

    act(() => {
      root.render(<PublishButton remoteUrl="git@github.com:owner/repo.git" skillName="greet" />);
    });
    await act(async () => {
      getButton().click();
      await flush();
    });

    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(mockSubmitToQueue).not.toHaveBeenCalled();
    const toastCall = dispatchEventSpy.mock.calls.find((c) => (c[0] as Event).type === "studio:toast");
    const ev = toastCall![0] as CustomEvent<{ message: string; severity: string }>;
    expect(ev.detail.severity).toBe("error");
    expect(ev.detail.message).toContain("non-fast-forward");
  });

  it("dirty tree: opens the drawer instead of submitting directly", async () => {
    mockGitDiff.mockResolvedValueOnce({ hasChanges: true, fileCount: 3 });

    act(() => {
      root.render(<PublishButton remoteUrl="git@github.com:owner/repo.git" skillName="greet" />);
    });
    await act(async () => {
      getButton().click();
      await flush();
    });

    // Drawer mounted (its dialog has aria-label "Publish"), direct submit NOT fired.
    expect(container.querySelector('[role="dialog"][aria-label="Publish"]')).toBeTruthy();
    expect(mockGitPublish).not.toHaveBeenCalled();
    expect(mockSubmitToQueue).not.toHaveBeenCalled();
  });

  it("disables the button while the request is in flight", async () => {
    let resolvePublish: (v: unknown) => void = () => {};
    mockGitPublish.mockImplementationOnce(() => new Promise((r) => { resolvePublish = r; }));

    act(() => {
      root.render(<PublishButton remoteUrl="git@github.com:owner/repo.git" />);
    });
    await act(async () => {
      getButton().click();
      await flush();
    });
    expect(getButton().disabled).toBe(true);

    await act(async () => {
      resolvePublish({ success: true, commitSha: "abc1234", branch: "main", remoteUrl: "git@github.com:owner/repo.git" });
      await flush();
    });
    expect(getButton().disabled).toBe(false);
  });
});
