// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0874 Workstream B — PublishDrawer privacy chooser tests.
//
// The publish flow now carries a PUBLIC / PRIVATE / decide-later chooser
// (adapted from the platform's PrivacyTernaryField). Tier gates it:
//   - FREE: the PRIVATE option is LOCKED with an inline "Upgrade to publish
//     privately" CTA; submitting still sends privacy:'public'.
//   - PRO:  PRIVATE is selectable; submitToQueue receives privacy:'private'.
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

const mockOpenExternal = vi.fn(async () => {});
vi.mock("../../preferences/lib/useDesktopBridge", () => ({
  openExternalUrlViaDesktop: (...a: unknown[]) => mockOpenExternal(...a),
}));

// Tier gate — switch isFree/isPro per test via the mutable holder.
const tierMock = vi.hoisted(() => ({ isFree: true, isPro: false }));
vi.mock("../../hooks/useTier", () => ({
  useTier: () => ({ isFree: tierMock.isFree, isPro: tierMock.isPro }),
  PRICING_URL: "https://verified-skill.com/pricing",
}));

// Stub the paywall — it pulls in QuotaContext + the desktop bridge, which are
// out of scope here. We only assert that the locked PRIVATE option opens it.
vi.mock("../PaywallModal", () => ({
  PaywallModal: ({ open }: { open: boolean }) => {
    if (!open) return null;
    const React = require("react");
    return React.createElement("div", { "data-testid": "paywall-modal" }, "Paywall");
  },
}));

import { PublishDrawer } from "../PublishDrawer";

let container: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mockGitCommitMessage.mockReset();
  mockGitPublish.mockReset();
  mockSubmitToQueue.mockReset();
  mockOpenExternal.mockClear();
  tierMock.isFree = true;
  tierMock.isPro = false;
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

function findTextarea(): HTMLTextAreaElement {
  const t = container.querySelector("textarea");
  if (!t) throw new Error("textarea not found");
  return t as HTMLTextAreaElement;
}

function reactTypeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(name: string): HTMLButtonElement {
  const btns = Array.from(container.querySelectorAll("button"));
  const b = btns.find((b) => b.getAttribute("aria-label") === name || b.textContent?.trim() === name);
  if (!b) throw new Error(`button '${name}' not found`);
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
const CREATED = { kind: "created", id: "s1", skillName: "greet", skillPath: "p", state: "RECEIVED", createdAt: "x" } as const;

describe("PublishDrawer privacy chooser (0874)", () => {
  it("renders the privacy options (public + private/locked), default public", async () => {
    // PRO so the private option renders unlocked here.
    tierMock.isFree = false;
    tierMock.isPro = true;
    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:owner/repo.git" fileCount={1} onClose={onClose} defaultMode="manual" skillName="greet" />,
      );
      await flush();
    });
    expect(container.querySelector('[data-testid="publish-privacy-public"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="publish-privacy-private"]')).toBeTruthy();
    // Default selection is PUBLIC.
    expect(
      container.querySelector('[data-testid="publish-privacy-public"]')?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("FREE: PRIVATE option is locked + shows an Upgrade CTA; submit still sends 'public'", async () => {
    tierMock.isFree = true;
    tierMock.isPro = false;
    mockGitPublish.mockResolvedValueOnce(PUBLISH_OK);
    mockSubmitToQueue.mockResolvedValueOnce(CREATED);

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:owner/repo.git" fileCount={1} onClose={onClose} defaultMode="manual" skillName="greet" />,
      );
      await flush();
    });

    // Private renders LOCKED for free users, with an upgrade CTA.
    const locked = container.querySelector('[data-testid="publish-privacy-locked"]');
    expect(locked).toBeTruthy();
    expect(container.textContent).toContain("Upgrade to publish privately");

    // Clicking the locked private option must NOT select private — it opens the paywall.
    await act(async () => {
      (locked as HTMLButtonElement).click();
      await flush();
    });
    expect(locked?.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector('[data-testid="paywall-modal"]')).toBeTruthy();
    // Public stays selected.
    expect(
      container.querySelector('[data-testid="publish-privacy-public"]')?.getAttribute("aria-checked"),
    ).toBe("true");

    // Submit → privacy stays 'public' despite the click on the locked option.
    await act(async () => {
      reactTypeInto(findTextarea(), "feat: greet");
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });
    expect(mockSubmitToQueue).toHaveBeenCalledTimes(1);
    expect(mockSubmitToQueue.mock.calls[0][0]).toMatchObject({ privacy: "public" });
  });

  it("PRO: PRIVATE is selectable → submitToQueue receives privacy:'private'", async () => {
    tierMock.isFree = false;
    tierMock.isPro = true;
    mockGitPublish.mockResolvedValueOnce(PUBLISH_OK);
    mockSubmitToQueue.mockResolvedValueOnce(CREATED);

    await act(async () => {
      root.render(
        <PublishDrawer remoteUrl="git@github.com:owner/repo.git" fileCount={1} onClose={onClose} defaultMode="manual" skillName="greet" />,
      );
      await flush();
    });

    // No locked state for paid users.
    expect(container.querySelector('[data-testid="publish-privacy-locked"]')).toBeNull();

    // Select PRIVATE.
    await act(async () => {
      (container.querySelector('[data-testid="publish-privacy-private"]') as HTMLButtonElement).click();
      await flush();
    });
    expect(
      container.querySelector('[data-testid="publish-privacy-private"]')?.getAttribute("aria-checked"),
    ).toBe("true");

    // Submit → privacy is 'private'.
    await act(async () => {
      reactTypeInto(findTextarea(), "feat: greet");
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });
    expect(mockSubmitToQueue).toHaveBeenCalledTimes(1);
    expect(mockSubmitToQueue.mock.calls[0][0]).toMatchObject({ privacy: "private" });
  });
});
