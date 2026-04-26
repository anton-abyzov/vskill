// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0759 Phase 5 — PublishDrawer tests.
// Suppress React act() environment warning in Vitest + jsdom:
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
//
// PublishDrawer is the dirty-tree commit flow:
//   - mounts when the user clicks Publish on a dirty workspace
//   - on mount, auto-fires api.gitCommitMessage to populate the textarea
//   - user can edit the message
//   - "Commit & Push" calls api.gitPublish({ commitMessage }) and on success
//     opens verified-skill.com/submit + dispatches a studio:toast info event
//   - "Cancel" closes the drawer without doing anything
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const mockGitCommitMessage = vi.fn();
const mockGitPublish = vi.fn();
vi.mock("../../api", async () => ({
  api: {
    gitCommitMessage: (...a: unknown[]) => mockGitCommitMessage(...a),
    gitPublish: (...a: unknown[]) => mockGitPublish(...a),
  },
}));

import { PublishDrawer } from "../PublishDrawer";

let container: HTMLDivElement;
let root: Root;
let openSpy: ReturnType<typeof vi.fn>;
let dispatchEventSpy: ReturnType<typeof vi.spyOn>;
let onClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  openSpy = vi.fn(() => null);
  Object.defineProperty(window, "open", { value: openSpy, configurable: true, writable: true });
  dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
  mockGitCommitMessage.mockReset();
  mockGitPublish.mockReset();
  onClose = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  dispatchEventSpy.mockRestore();
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// React 19 + controlled textareas: setting `.value` directly doesn't notify
// React. We have to call the native HTMLTextAreaElement value setter so the
// onChange handler fires. This pattern is the no-@testing-library equivalent
// of fireEvent.change().
function reactTypeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function findTextarea(): HTMLTextAreaElement {
  const t = container.querySelector("textarea");
  if (!t) throw new Error("textarea not found");
  return t as HTMLTextAreaElement;
}

function findButton(name: string): HTMLButtonElement {
  const btns = Array.from(container.querySelectorAll("button"));
  const b = btns.find((b) => b.getAttribute("aria-label") === name || b.textContent?.trim() === name);
  if (!b) throw new Error(`button '${name}' not found. Available: ${btns.map((b) => b.textContent?.trim()).join(", ")}`);
  return b as HTMLButtonElement;
}

describe("PublishDrawer", () => {
  it("calls api.gitCommitMessage with provider+model on mount and populates textarea", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: add x" });

    await act(async () => {
      root.render(
        <PublishDrawer
          provider="claude-cli"
          model="sonnet"
          remoteUrl="git@github.com:owner/repo.git"
          fileCount={3}
          onClose={onClose}
        />,
      );
      await flush();
    });

    expect(mockGitCommitMessage).toHaveBeenCalledTimes(1);
    expect(mockGitCommitMessage).toHaveBeenCalledWith({ provider: "claude-cli", model: "sonnet" });
    expect(findTextarea().value).toBe("feat: add x");
  });

  it("renders the file count in the header", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "x" });
    await act(async () => {
      root.render(
        <PublishDrawer provider="claude-cli" remoteUrl="git@github.com:o/r.git" fileCount={5} onClose={onClose} />,
      );
      await flush();
    });
    expect(container.textContent).toContain("5");
  });

  it("Commit & Push: calls gitPublish with current textarea value, opens verified-skill.com, dispatches success toast", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: ai message" });
    mockGitPublish.mockResolvedValueOnce({
      success: true,
      commitSha: "abc1234def5678",
      branch: "main",
      remoteUrl: "git@github.com:owner/repo.git",
      stdout: "[main abc1234] feat: ai message\n",
      stderr: "",
    });

    await act(async () => {
      root.render(
        <PublishDrawer provider="claude-cli" remoteUrl="git@github.com:owner/repo.git" fileCount={1} onClose={onClose} />,
      );
      await flush();
    });

    // User edits the AI suggestion before pushing.
    const textarea = findTextarea();
    await act(async () => {
      reactTypeInto(textarea, "feat: my edit");
      await flush();
    });

    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    expect(mockGitPublish).toHaveBeenCalledWith({ commitMessage: "feat: my edit" });
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [url, target, features] = openSpy.mock.calls[0] as [string, string, string];
    expect(url).toBe(
      "https://verified-skill.com/submit?repo=https%3A%2F%2Fgithub.com%2Fowner%2Frepo",
    );
    expect(target).toBe("_blank");
    expect(features).toContain("noopener");

    const toastCall = dispatchEventSpy.mock.calls.find(
      (c) => (c[0] as Event).type === "studio:toast",
    );
    expect(toastCall).toBeTruthy();
    const ev = toastCall![0] as CustomEvent<{ message: string; severity: "info" | "error" }>;
    expect(ev.detail.severity).toBe("info");
    expect(ev.detail.message).toContain("abc1234");
    expect(ev.detail.message).toContain("main");
  });

  it("Commit & Push is disabled while gitPublish is in flight", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "x" });
    let resolvePublish: (v: unknown) => void = () => {};
    mockGitPublish.mockImplementationOnce(
      () => new Promise((r) => { resolvePublish = r; }),
    );

    await act(async () => {
      root.render(
        <PublishDrawer provider="claude-cli" remoteUrl="git@github.com:o/r.git" fileCount={1} onClose={onClose} />,
      );
      await flush();
    });

    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    expect(findButton("Commit & Push").disabled).toBe(true);

    await act(async () => {
      resolvePublish({
        success: true,
        commitSha: "abc1234",
        branch: "main",
        remoteUrl: "git@github.com:o/r.git",
        stdout: "",
        stderr: "",
      });
      await flush();
    });

    // After settle, drawer should call onClose to dismiss itself.
    expect(onClose).toHaveBeenCalled();
  });

  it("on publish failure: dispatches error toast, does NOT call window.open, does NOT call onClose", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "x" });
    mockGitPublish.mockRejectedValueOnce(new Error("rejected: hook failed"));

    await act(async () => {
      root.render(
        <PublishDrawer provider="claude-cli" remoteUrl="git@github.com:o/r.git" fileCount={1} onClose={onClose} />,
      );
      await flush();
    });

    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    expect(openSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const toastCall = dispatchEventSpy.mock.calls.find(
      (c) => (c[0] as Event).type === "studio:toast",
    );
    const ev = toastCall![0] as CustomEvent<{ severity: string; message: string }>;
    expect(ev.detail.severity).toBe("error");
    expect(ev.detail.message).toContain("hook failed");
  });

  it("Cancel: calls onClose without invoking gitPublish", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "x" });
    await act(async () => {
      root.render(
        <PublishDrawer provider="claude-cli" remoteUrl="git@github.com:o/r.git" fileCount={1} onClose={onClose} />,
      );
      await flush();
    });

    await act(async () => {
      findButton("Cancel").click();
      await flush();
    });

    expect(onClose).toHaveBeenCalled();
    expect(mockGitPublish).not.toHaveBeenCalled();
  });

  it("Regenerate: re-fires gitCommitMessage and replaces textarea content", async () => {
    mockGitCommitMessage
      .mockResolvedValueOnce({ message: "feat: first" })
      .mockResolvedValueOnce({ message: "fix: second" });

    await act(async () => {
      root.render(
        <PublishDrawer provider="claude-cli" remoteUrl="git@github.com:o/r.git" fileCount={1} onClose={onClose} />,
      );
      await flush();
    });

    expect(findTextarea().value).toBe("feat: first");

    await act(async () => {
      findButton("Regenerate").click();
      await flush();
    });

    expect(mockGitCommitMessage).toHaveBeenCalledTimes(2);
    expect(findTextarea().value).toBe("fix: second");
  });

  it("Commit & Push refuses an empty commit message (does not call gitPublish, no error toast)", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: x" });
    await act(async () => {
      root.render(
        <PublishDrawer provider="claude-cli" remoteUrl="git@github.com:o/r.git" fileCount={1} onClose={onClose} />,
      );
      await flush();
    });

    const textarea = findTextarea();
    await act(async () => {
      reactTypeInto(textarea, "   ");
      await flush();
    });

    expect(findButton("Commit & Push").disabled).toBe(true);
  });
});
