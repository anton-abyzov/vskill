// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0759 Phase 5 / 0856 — PublishDrawer tests.
// Suppress React act() environment warning in Vitest + jsdom:
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
//
// PublishDrawer is the dirty-tree commit flow:
//   - mounts when the user clicks Publish on a dirty workspace
//   - in AI mode auto-fires api.gitCommitMessage to populate the textarea
//   - user can edit the message
//   - "Commit & Push" calls api.gitPublish({ commitMessage }) then, when a
//     skillName is known (0856), submits IN-APP via api.submitToQueue and
//     renders a structured inline outcome (the drawer stays open, no redirect).
//     Without a skillName it falls back to opening verified-skill.com via the
//     desktop shell bridge.
//   - "Cancel" closes the drawer without doing anything
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

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

const mockOpenExternal = vi.fn(async () => {});
vi.mock("../../preferences/lib/useDesktopBridge", () => ({
  openExternalUrlViaDesktop: (...a: unknown[]) => mockOpenExternal(...a),
}));

// 0874 — PublishDrawer now reads useTier (for the privacy chooser gate) and
// mounts PaywallModal. Stub both so these legacy tests stay provider-free.
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

import { PublishDrawer } from "../PublishDrawer";

let container: HTMLDivElement;
let root: Root;
let dispatchEventSpy: ReturnType<typeof vi.spyOn>;
let onClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
  mockGitCommitMessage.mockReset();
  mockGitPublish.mockReset();
  mockSubmitToQueue.mockReset();
  mockOpenExternal.mockClear();
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

function reactTypeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
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

const PUBLISH_OK = {
  success: true,
  commitSha: "abc1234def5678",
  branch: "main",
  remoteUrl: "git@github.com:owner/repo.git",
  stdout: "",
  stderr: "",
};

describe("PublishDrawer — message generation (regression)", () => {
  it("calls api.gitCommitMessage with provider+model on mount and populates textarea", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: add x" });
    await act(async () => {
      root.render(
        <PublishDrawer provider="claude-cli" model="sonnet" remoteUrl="git@github.com:owner/repo.git" fileCount={3} onClose={onClose} defaultMode="ai" />,
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
      root.render(<PublishDrawer provider="claude-cli" remoteUrl="git@github.com:o/r.git" fileCount={5} onClose={onClose} defaultMode="ai" />);
      await flush();
    });
    expect(container.textContent).toContain("5");
  });

  it("Regenerate: re-fires gitCommitMessage and replaces textarea content", async () => {
    mockGitCommitMessage
      .mockResolvedValueOnce({ message: "feat: first" })
      .mockResolvedValueOnce({ message: "fix: second" });
    await act(async () => {
      root.render(<PublishDrawer provider="claude-cli" remoteUrl="git@github.com:o/r.git" fileCount={1} onClose={onClose} defaultMode="ai" />);
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

  it("Commit & Push refuses an empty commit message", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: x" });
    await act(async () => {
      root.render(<PublishDrawer provider="claude-cli" remoteUrl="git@github.com:o/r.git" fileCount={1} onClose={onClose} defaultMode="ai" />);
      await flush();
    });
    await act(async () => {
      reactTypeInto(findTextarea(), "   ");
      await flush();
    });
    expect(findButton("Commit & Push").disabled).toBe(true);
    expect(mockGitPublish).not.toHaveBeenCalled();
  });

  it("Cancel: calls onClose without invoking gitPublish", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "x" });
    await act(async () => {
      root.render(<PublishDrawer provider="claude-cli" remoteUrl="git@github.com:o/r.git" fileCount={1} onClose={onClose} defaultMode="ai" />);
      await flush();
    });
    await act(async () => {
      findButton("Cancel").click();
      await flush();
    });
    expect(onClose).toHaveBeenCalled();
    expect(mockGitPublish).not.toHaveBeenCalled();
  });
});

describe("PublishDrawer — in-app submit (0856)", () => {
  it("Commit & Push: pushes, then submits IN-APP and renders the created outcome", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: ai message" });
    mockGitPublish.mockResolvedValueOnce(PUBLISH_OK);
    mockSubmitToQueue.mockResolvedValueOnce({
      kind: "created",
      id: "sub-1",
      skillName: "greet",
      skillPath: "skills/greet",
      state: "RECEIVED",
      createdAt: "x",
    });

    await act(async () => {
      root.render(
        <PublishDrawer
          provider="claude-cli"
          remoteUrl="git@github.com:owner/repo.git"
          fileCount={1}
          onClose={onClose}
          defaultMode="ai"
          skillName="greet"
          skillPath="skills/greet"
        />,
      );
      await flush();
    });

    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    // pushed with the (edited or generated) message
    expect(mockGitPublish).toHaveBeenCalledWith({ commitMessage: "feat: ai message" });
    // submitted in-app with the canonical https repoUrl + studio source
    expect(mockSubmitToQueue).toHaveBeenCalledWith({
      repoUrl: "https://github.com/owner/repo",
      skillName: "greet",
      skillPath: "skills/greet",
      source: "studio-submit",
      privacy: "public",
      tenantId: undefined,
    });
    // inline outcome rendered, drawer NOT closed, website NOT opened
    const outcome = container.querySelector('[data-testid="publish-outcome"]');
    expect(outcome).toBeTruthy();
    expect(outcome?.getAttribute("data-outcome")).toBe("created");
    expect(onClose).not.toHaveBeenCalled();
    expect(mockOpenExternal).not.toHaveBeenCalled();
    // a "Done" button replaces Commit & Push
    expect(container.querySelector('[data-testid="publish-done"]')).toBeTruthy();
  });

  it("submit fails because not signed in (401) → website-fallback, NOT 'Publish failed'", async () => {
    // The push SUCCEEDS but the in-app queue submit 401s because the user is not
    // signed in to verified-skill. The drawer must degrade to the website submit
    // flow (?repo= URL) — never surface a scary "Publish failed" — and emit an
    // info (not error) toast. Regression for the not-signed-in publish UX.
    mockGitPublish.mockResolvedValueOnce(PUBLISH_OK);
    mockSubmitToQueue.mockRejectedValueOnce(new Error("401 unauthorized"));

    await act(async () => {
      root.render(
        <PublishDrawer
          remoteUrl="git@github.com:owner/repo.git"
          fileCount={1}
          onClose={onClose}
          defaultMode="manual"
          skillName="greet"
        />,
      );
      await flush();
    });
    await act(async () => {
      reactTypeInto(findTextarea(), "feat: update greet");
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    // pushed, attempted submit, then fell back to website (push success preserved)
    expect(mockGitPublish).toHaveBeenCalledTimes(1);
    expect(mockSubmitToQueue).toHaveBeenCalledTimes(1);
    const outcome = container.querySelector('[data-testid="publish-outcome"]');
    expect(outcome?.getAttribute("data-outcome")).toBe("website-fallback");
    // NOT a "Publish failed" error block, and drawer stays open
    expect(container.querySelector('[data-testid="publish-error-push"]')).toBeNull();
    expect(container.textContent).toContain("Pushed to GitHub");
    expect(onClose).not.toHaveBeenCalled();
    // info toast emitted, never an error toast
    const toasts = dispatchEventSpy.mock.calls
      .map((c) => c[0])
      .filter((e): e is CustomEvent => e instanceof CustomEvent && e.type === "studio:toast")
      .map((e) => (e.detail as { severity: string }).severity);
    expect(toasts).toContain("info");
    expect(toasts).not.toContain("error");
  });

  it("renders the duplicate outcome inline", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "m" });
    mockGitPublish.mockResolvedValueOnce(PUBLISH_OK);
    mockSubmitToQueue.mockResolvedValueOnce({ kind: "duplicate", id: "s2", state: "TIER1_SCANNING" });

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:owner/repo.git" fileCount={1} onClose={onClose} defaultMode="ai" skillName="greet" />,
      );
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    const outcome = container.querySelector('[data-testid="publish-outcome"]');
    expect(outcome?.getAttribute("data-outcome")).toBe("duplicate");
    expect(outcome?.textContent?.toLowerCase()).toContain("already in the queue");
  });

  it("renders the blocked outcome inline", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "m" });
    mockGitPublish.mockResolvedValueOnce(PUBLISH_OK);
    mockSubmitToQueue.mockResolvedValueOnce({ kind: "blocked", submissionId: "s9" });

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:owner/repo.git" fileCount={1} onClose={onClose} defaultMode="ai" skillName="evil" />,
      );
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    const outcome = container.querySelector('[data-testid="publish-outcome"]');
    expect(outcome?.getAttribute("data-outcome")).toBe("blocked");
    expect(outcome?.textContent?.toLowerCase()).toContain("blocked");
  });

  it("'Open on website' link opens via the desktop shell bridge", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "m" });
    mockGitPublish.mockResolvedValueOnce(PUBLISH_OK);
    mockSubmitToQueue.mockResolvedValueOnce({ kind: "created", id: "s1", skillName: "greet", skillPath: "p", state: "RECEIVED", createdAt: "x" });

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:owner/repo.git" fileCount={1} onClose={onClose} defaultMode="ai" skillName="greet" />,
      );
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });
    await act(async () => {
      (container.querySelector('[data-testid="publish-open-website"]') as HTMLButtonElement).click();
      await flush();
    });
    expect(mockOpenExternal).toHaveBeenCalledTimes(1);
    expect(mockOpenExternal.mock.calls[0][0]).toContain("verified-skill.com/submit");
  });

  it("Done button dismisses the drawer after a submit", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "m" });
    mockGitPublish.mockResolvedValueOnce(PUBLISH_OK);
    mockSubmitToQueue.mockResolvedValueOnce({ kind: "created", id: "s1", skillName: "greet", skillPath: "p", state: "RECEIVED", createdAt: "x" });

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:owner/repo.git" fileCount={1} onClose={onClose} defaultMode="ai" skillName="greet" />,
      );
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });
    await act(async () => {
      findButton("Done").click();
      await flush();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("on push failure: inline error, no submit, drawer stays open", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "x" });
    mockGitPublish.mockRejectedValueOnce(new Error("rejected: hook failed"));

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:o/r.git" fileCount={1} onClose={onClose} defaultMode="ai" skillName="greet" />,
      );
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    expect(mockSubmitToQueue).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="publish-error-push"]')).toBeTruthy();
    const toastCall = dispatchEventSpy.mock.calls.find((c) => (c[0] as Event).type === "studio:toast");
    const ev = toastCall![0] as CustomEvent<{ severity: string; message: string }>;
    expect(ev.detail.severity).toBe("error");
    expect(ev.detail.message).toContain("hook failed");
  });

  it("rebase_conflict (HTTP 200 conflict:true): renders conflicted files inline + 'remote conflict' toast, no submit", async () => {
    // 0875 AC-US1-03 — a non-fast-forward push that couldn't rebase cleanly comes
    // back as { success:false, conflict:true, reason:"rebase_conflict", conflictedFiles }.
    // The drawer must surface the conflicted files INLINE (publish-error-push), not
    // close, not submit, and emit a conflict-framed error toast.
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: x" });
    mockGitPublish.mockResolvedValueOnce({
      success: false,
      conflict: true,
      reason: "rebase_conflict",
      conflictedFiles: ["skill.md", "README.md"],
      error: "Remote has changes that conflict with yours in: skill.md, README.md. Pull and resolve manually, then publish again.",
      stdout: "",
      stderr: "",
    });

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:o/r.git" fileCount={1} onClose={onClose} defaultMode="ai" skillName="greet" />,
      );
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    expect(mockSubmitToQueue).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const inline = container.querySelector('[data-testid="publish-error-push"]');
    expect(inline).toBeTruthy();
    expect(inline?.textContent).toContain("skill.md");
    expect(inline?.textContent).toContain("README.md");
    const toastCall = dispatchEventSpy.mock.calls.find((c) => (c[0] as Event).type === "studio:toast");
    const ev = toastCall![0] as CustomEvent<{ severity: string; message: string }>;
    expect(ev.detail.severity).toBe("error");
    expect(ev.detail.message.toLowerCase()).toContain("remote conflict");
  });

  it("rebase_failed (no conflicted files): toast says 'could not rebase' — NOT framed as a conflict", async () => {
    // 0875 — a non-conflict rebase failure (network/auth/autostash) returns
    // reason:"rebase_failed" with no conflicted files. The toast must not claim a
    // content conflict; the inline body uses the server's error message.
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: x" });
    mockGitPublish.mockResolvedValueOnce({
      success: false,
      conflict: true,
      reason: "rebase_failed",
      conflictedFiles: [],
      error: "Could not rebase onto the remote (no conflicting files detected — this may be a network, auth, or autostash problem). Pull manually and try again.",
      stdout: "",
      stderr: "",
    });

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:o/r.git" fileCount={1} onClose={onClose} defaultMode="ai" skillName="greet" />,
      );
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    const inline = container.querySelector('[data-testid="publish-error-push"]');
    expect(inline?.textContent?.toLowerCase()).toContain("could not rebase");
    const toastCall = dispatchEventSpy.mock.calls.find((c) => (c[0] as Event).type === "studio:toast");
    const ev = toastCall![0] as CustomEvent<{ severity: string; message: string }>;
    expect(ev.detail.severity).toBe("error");
    expect(ev.detail.message.toLowerCase()).toContain("could not rebase");
    expect(ev.detail.message.toLowerCase()).not.toContain("remote conflict");
  });

  it("reconciled push (reconciled:true): success messaging notes '(reconciled with remote)'", async () => {
    // 0875 AC-US1-03 — when a non-fast-forward push was auto-rebased and retried,
    // the success toast must note that we reconciled with the remote.
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: x" });
    mockGitPublish.mockResolvedValueOnce({ ...PUBLISH_OK, reconciled: true });
    // Make the in-app submit 401 so we take the website-fallback info-toast path
    // (which echoes the reconciledNote), rather than the created-outcome path.
    mockSubmitToQueue.mockRejectedValueOnce(new Error("401 unauthorized"));

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:owner/repo.git" fileCount={1} onClose={onClose} defaultMode="ai" skillName="greet" />,
      );
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    const infoToast = dispatchEventSpy.mock.calls
      .map((c) => c[0])
      .filter((e): e is CustomEvent => e instanceof CustomEvent && e.type === "studio:toast")
      .map((e) => e.detail as { severity: string; message: string })
      .find((d) => d.severity === "info");
    expect(infoToast).toBeTruthy();
    expect(infoToast!.message).toContain("reconciled with remote");
  });

  it("non-github remote + skillName: push succeeds → website-fallback outcome, NOT 'Publish failed'", async () => {
    // GitLab remote → normalizeRemoteUrl throws inside the skillName branch.
    // The push already succeeded, so the drawer must degrade to the website-
    // fallback outcome (info toast) instead of letting buildSubmitUrlFromRemote
    // re-throw and surface a "Publish failed" error.
    mockGitCommitMessage.mockResolvedValueOnce({ message: "feat: x" });
    mockGitPublish.mockResolvedValueOnce({
      ...PUBLISH_OK,
      remoteUrl: "git@gitlab.com:owner/repo.git",
    });

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@gitlab.com:owner/repo.git" fileCount={1} onClose={onClose} defaultMode="ai" skillName="greet" />,
      );
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    // No in-app submit (no valid github repoUrl) and no push-failure error block.
    expect(mockSubmitToQueue).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="publish-error-push"]')).toBeNull();
    // Website-fallback outcome rendered (drawer stays open, push acknowledged).
    const outcome = container.querySelector('[data-testid="publish-outcome"]');
    expect(outcome?.getAttribute("data-outcome")).toBe("website-fallback");
    // The fallback link points at the bare submit page (remote not normalizable).
    await act(async () => {
      (container.querySelector('[data-testid="publish-open-website"]') as HTMLButtonElement).click();
      await flush();
    });
    expect(mockOpenExternal.mock.calls[0][0]).toBe("https://verified-skill.com/submit");
    // Toast is INFO, never the error "Publish failed".
    const toasts = dispatchEventSpy.mock.calls
      .filter((c) => (c[0] as Event).type === "studio:toast")
      .map((c) => (c[0] as CustomEvent<{ message: string; severity: string }>).detail);
    expect(toasts.some((t) => t.severity === "error")).toBe(false);
    expect(toasts.some((t) => t.message.includes("Publish failed"))).toBe(false);
  });

  it("without a skillName: falls back to the website-open flow (no in-app submit)", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "x" });
    mockGitPublish.mockResolvedValueOnce(PUBLISH_OK);

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:owner/repo.git" fileCount={1} onClose={onClose} defaultMode="ai" />,
      );
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });

    expect(mockSubmitToQueue).not.toHaveBeenCalled();
    const outcome = container.querySelector('[data-testid="publish-outcome"]');
    expect(outcome?.getAttribute("data-outcome")).toBe("website-fallback");
  });

  it("Commit & Push is disabled while the request is in flight", async () => {
    mockGitCommitMessage.mockResolvedValueOnce({ message: "x" });
    let resolvePublish: (v: unknown) => void = () => {};
    mockGitPublish.mockImplementationOnce(() => new Promise((r) => { resolvePublish = r; }));

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:owner/repo.git" fileCount={1} onClose={onClose} defaultMode="ai" skillName="greet" />,
      );
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });
    expect(findButton("Commit & Push").disabled).toBe(true);

    mockSubmitToQueue.mockResolvedValueOnce({ kind: "created", id: "s1", skillName: "greet", skillPath: "p", state: "RECEIVED", createdAt: "x" });
    await act(async () => {
      resolvePublish(PUBLISH_OK);
      await flush();
    });
    // Settled → outcome shown, Done button available.
    expect(container.querySelector('[data-testid="publish-done"]')).toBeTruthy();
  });
});
