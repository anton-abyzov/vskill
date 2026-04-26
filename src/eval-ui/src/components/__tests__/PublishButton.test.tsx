// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0759 — PublishButton tests.
// Suppress React act() environment warning in Vitest + jsdom:
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
//
// PublishButton is the small presentational component that owns the publish
// flow: click → api.gitPublish → window.open(submitUrl) on success, or
// dispatch error toast on failure. It receives `hasRemote` from useGitRemote
// (in EditorPanel) so the parent decides whether to render it at all.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const mockGitPublish = vi.fn();
vi.mock("../../api", async () => ({
  api: {
    gitPublish: (...args: unknown[]) => mockGitPublish(...args),
  },
}));

import { PublishButton } from "../PublishButton";

let container: HTMLDivElement;
let root: Root;
let openSpy: ReturnType<typeof vi.fn>;
let dispatchEventSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  openSpy = vi.fn(() => null);
  // jsdom's window.open default returns null and logs a "not implemented"
  // warning. Replace it with a clean spy.
  Object.defineProperty(window, "open", { value: openSpy, configurable: true, writable: true });
  dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
  mockGitPublish.mockReset();
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

describe("PublishButton", () => {
  it("renders a button with accessible name 'Publish'", () => {
    act(() => {
      root.render(<PublishButton remoteUrl="git@github.com:owner/repo.git" />);
    });
    expect(getButton()).toBeTruthy();
  });

  it("on success: calls window.open with verified-skill.com submit URL and noopener,noreferrer", async () => {
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
      // flush microtasks
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0] as [string, string, string];
    expect(url).toBe(
      "https://verified-skill.com/submit?repo=https%3A%2F%2Fgithub.com%2Fowner%2Frepo",
    );
    expect(target).toBe("_blank");
    expect(features).toContain("noopener");
    expect(features).toContain("noreferrer");
  });

  it("on success: dispatches studio:toast CustomEvent with short SHA + branch + 'Opening'", async () => {
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
      await Promise.resolve();
      await Promise.resolve();
    });

    const toastCall = dispatchEventSpy.mock.calls.find(
      (c) => (c[0] as Event).type === "studio:toast",
    );
    expect(toastCall).toBeTruthy();
    const ev = toastCall![0] as CustomEvent<{ message: string; severity: "info" | "error" }>;
    expect(ev.detail.severity).toBe("info");
    expect(ev.detail.message).toContain("abc1234");
    expect(ev.detail.message).not.toContain("abc1234def567890"); // truncated to 7 chars
    expect(ev.detail.message).toContain("main");
    expect(ev.detail.message.toLowerCase()).toContain("opening");
  });

  it("on failure: does NOT call window.open and dispatches error toast", async () => {
    mockGitPublish.mockRejectedValueOnce(new Error("rejected: non-fast-forward"));

    act(() => {
      root.render(<PublishButton remoteUrl="git@github.com:owner/repo.git" />);
    });

    await act(async () => {
      getButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(openSpy).not.toHaveBeenCalled();
    const toastCall = dispatchEventSpy.mock.calls.find(
      (c) => (c[0] as Event).type === "studio:toast",
    );
    expect(toastCall).toBeTruthy();
    const ev = toastCall![0] as CustomEvent<{ message: string; severity: "info" | "error" }>;
    expect(ev.detail.severity).toBe("error");
    expect(ev.detail.message).toContain("non-fast-forward");
  });

  it("disables the button while the request is in flight", async () => {
    let resolvePublish: (v: unknown) => void = () => {};
    mockGitPublish.mockImplementationOnce(
      () => new Promise((r) => { resolvePublish = r; }),
    );

    act(() => {
      root.render(<PublishButton remoteUrl="git@github.com:owner/repo.git" />);
    });

    await act(async () => {
      getButton().click();
      await Promise.resolve();
    });

    // Button should now be disabled
    expect(getButton().disabled).toBe(true);

    // Resolve the request and let it settle
    await act(async () => {
      resolvePublish({
        success: true,
        commitSha: "abc1234",
        branch: "main",
        remoteUrl: "git@github.com:owner/repo.git",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getButton().disabled).toBe(false);
  });
});
