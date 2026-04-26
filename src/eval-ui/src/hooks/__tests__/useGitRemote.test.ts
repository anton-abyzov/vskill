// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0759 — useGitRemote tests.
//
// Covers AC-US1-04 (hook stores remoteUrl/branch/hasRemote from a successful
// GET /git-remote probe) and AC-US1-05 (fail-silent: hasRemote=false on
// network/git error, error field exposed for diagnostics).
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import type { Root } from "react-dom/client";

// Suppress React act() environment warning in jsdom
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockGitRemote = vi.fn();
vi.mock("../../api", async () => ({
  api: {
    gitRemote: (...args: unknown[]) => mockGitRemote(...args),
  },
}));

import { useGitRemote, type GitRemoteState } from "../useGitRemote";

// ---------------------------------------------------------------------------
// Minimal render harness — mirrors the pattern used by other hook tests in
// this project (no @testing-library/react dependency required).
// ---------------------------------------------------------------------------

interface Harness {
  getState: () => GitRemoteState;
  unmount: () => void;
}

async function mount(): Promise<Harness> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");

  let capturedState: GitRemoteState | null = null;

  function Probe() {
    const state = useGitRemote();
    capturedState = state;
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Probe));
  });

  return {
    getState: () => capturedState!,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  mockGitRemote.mockReset();
});

describe("useGitRemote", () => {
  it("AC-US1-04: starts in loading state and resolves with hasRemote=true on success", async () => {
    mockGitRemote.mockResolvedValueOnce({
      hasRemote: true,
      remoteUrl: "git@github.com:owner/repo.git",
      branch: "main",
    });

    const harness = await mount();

    // Initial: loading=true before the async probe settles
    expect(harness.getState().loading).toBe(true);
    expect(harness.getState().hasRemote).toBe(false);

    // Let the promise + setState flush
    await act(async () => {
      await Promise.resolve();
    });

    const s = harness.getState();
    expect(s.loading).toBe(false);
    expect(s.hasRemote).toBe(true);
    expect(s.remoteUrl).toBe("git@github.com:owner/repo.git");
    expect(s.branch).toBe("main");
    expect(s.error).toBeNull();

    harness.unmount();
  });

  it("AC-US1-04: hasRemote=false when server reports no remote", async () => {
    mockGitRemote.mockResolvedValueOnce({
      hasRemote: false,
      remoteUrl: null,
      branch: "main",
    });

    const harness = await mount();

    await act(async () => {
      await Promise.resolve();
    });

    const s = harness.getState();
    expect(s.hasRemote).toBe(false);
    expect(s.remoteUrl).toBeNull();
    expect(s.error).toBeNull();

    harness.unmount();
  });

  it("AC-US1-05: fail-silent on network error — hasRemote=false, error field populated", async () => {
    mockGitRemote.mockRejectedValueOnce(new Error("network error"));

    const harness = await mount();

    await act(async () => {
      await Promise.resolve();
    });

    const s = harness.getState();
    expect(s.loading).toBe(false);
    expect(s.hasRemote).toBe(false);
    expect(s.remoteUrl).toBeNull();
    // error field is surfaced for future diagnostics; no error UI in MVP
    expect(s.error).toBeInstanceOf(Error);
    expect(s.error?.message).toBe("network error");

    harness.unmount();
  });

  it("AC-US1-05: non-Error rejection is wrapped in Error", async () => {
    mockGitRemote.mockRejectedValueOnce("string error");

    const harness = await mount();

    await act(async () => {
      await Promise.resolve();
    });

    expect(harness.getState().hasRemote).toBe(false);
    expect(harness.getState().error).toBeInstanceOf(Error);

    harness.unmount();
  });
});
