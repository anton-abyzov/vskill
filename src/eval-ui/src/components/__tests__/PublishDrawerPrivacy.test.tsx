// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0874 Workstream B — PublishDrawer privacy chooser tests.
//
// The publish flow now carries a PUBLIC / PRIVATE / decide-later chooser
// (adapted from the platform's PrivacyTernaryField). Tier gates it:
//   - FREE: the PRIVATE option is LOCKED with an inline "Upgrade to publish
//     privately" CTA; submitting still sends privacy:'public'.
//   - PRO:  PRIVATE is selectable; submitToQueue receives privacy:'private'.
//
// 0874 AC-07: that behaviour applies only while hosted private publishing is
// open. The three original tests run with the launch gate mocked open; the
// closed-gate block below covers what ships today.
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

// Launch gate — switch open/closed per test via the mutable holder.
const gateMock = vi.hoisted(() => ({ open: true }));
vi.mock("../../hosted-publishing", () => ({
  get HOSTED_PRIVATE_PUBLISHING_AVAILABLE() {
    return gateMock.open;
  },
  HOSTED_WAITLIST_URL: "https://verified-skill.com/pricing#hosted-waitlist",
}));

// Stub the paywall — it pulls in QuotaContext + the desktop bridge, which are
// out of scope here. We only assert that the locked PRIVATE option opens it.
vi.mock("../PaywallModal", () => ({
  PaywallModal: ({ open, context }: { open: boolean; context?: string }) => {
    if (!open) return null;
    const React = require("react");
    return React.createElement("div", { "data-testid": "paywall-modal", "data-context": context }, "Paywall");
  },
}));

import { PublishDrawer } from "../PublishDrawer";
import { SubmissionRefusedError } from "../../submission-queue";

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
  gateMock.open = true;
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
    expect(container.querySelector('[data-testid="paywall-modal"]')?.getAttribute("data-context")).toBe("publish");
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

describe("PublishDrawer privacy chooser, launch gate closed (0874 AC-07)", () => {
  async function renderDrawer(props: Partial<React.ComponentProps<typeof PublishDrawer>> = {}) {
    await act(async () => {
      root.render(
        <PublishDrawer
          remoteUrl="git@github.com:owner/repo.git"
          fileCount={1}
          onClose={onClose}
          defaultMode="manual"
          skillName="greet"
          {...props}
        />,
      );
      await flush();
    });
  }

  async function commit() {
    await act(async () => {
      reactTypeInto(findTextarea(), "feat: greet");
      await flush();
    });
    await act(async () => {
      findButton("Commit & Push").click();
      await flush();
    });
  }

  for (const tier of ["free", "pro"] as const) {
    it(`${tier.toUpperCase()}: Public is selected, Private cannot be selected and offers the waitlist, no paywall`, async () => {
      gateMock.open = false;
      tierMock.isFree = tier === "free";
      tierMock.isPro = tier === "pro";
      await renderDrawer();

      expect(
        container.querySelector('[data-testid="publish-privacy-public"]')?.getAttribute("aria-checked"),
      ).toBe("true");
      const unavailable = container.querySelector('[data-testid="publish-privacy-unavailable"]');
      expect(unavailable).toBeTruthy();
      expect(unavailable?.getAttribute("aria-disabled")).toBe("true");
      expect(unavailable?.textContent).toContain("not open yet");
      // Neither the selectable nor the paywall-locked Private option renders.
      expect(container.querySelector('[data-testid="publish-privacy-private"]')).toBeNull();
      expect(container.querySelector('[data-testid="publish-privacy-locked"]')).toBeNull();
      expect(container.textContent).not.toContain("Upgrade to publish privately");
      // Decide later is gone while the gate is closed.
      expect(container.querySelector('[data-testid="publish-privacy-decide-later"]')).toBeNull();

      // Clicking the card selects nothing; the waitlist link opens the pricing waitlist.
      await act(async () => {
        (unavailable as HTMLElement).click();
        await flush();
      });
      expect(
        container.querySelector('[data-testid="publish-privacy-public"]')?.getAttribute("aria-checked"),
      ).toBe("true");
      await act(async () => {
        (container.querySelector('[data-testid="publish-privacy-waitlist"]') as HTMLButtonElement).click();
        await flush();
      });
      expect(mockOpenExternal).toHaveBeenCalledWith("https://verified-skill.com/pricing#hosted-waitlist");
      expect(container.querySelector('[data-testid="paywall-modal"]')).toBeNull();
    });
  }

  it("submit sends privacy 'public' and no tenantId, even when the host asked for private", async () => {
    gateMock.open = false;
    tierMock.isFree = false;
    tierMock.isPro = true;
    mockGitPublish.mockResolvedValueOnce(PUBLISH_OK);
    mockSubmitToQueue.mockResolvedValueOnce(CREATED);
    await renderDrawer({ privacy: "private", tenantId: "t-1" });

    expect(
      container.querySelector('[data-testid="publish-privacy-public"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    await commit();

    expect(mockSubmitToQueue).toHaveBeenCalledTimes(1);
    const body = mockSubmitToQueue.mock.calls[0][0];
    expect(body.privacy).toBe("public");
    expect(body.tenantId).toBeUndefined();
  });

  it("a platform 503 private_publishing_unavailable reads as not submitted, not the sign-in fallback", async () => {
    gateMock.open = false;
    mockGitPublish.mockResolvedValueOnce(PUBLISH_OK);
    mockSubmitToQueue.mockRejectedValueOnce(
      new SubmissionRefusedError(
        "private_publishing_unavailable",
        "Hosted private publishing is not available yet. Keep private skills local.",
        503,
      ),
    );
    await renderDrawer();
    await commit();

    const outcome = container.querySelector('[data-testid="publish-outcome"]');
    expect(outcome?.getAttribute("data-outcome")).toBe("not-submitted");
    expect(outcome?.textContent).toContain("Hosted private publishing is not available yet.");
    expect(container.querySelector('[data-testid="publish-open-website"]')).toBeNull();
    expect(container.textContent?.toLowerCase()).not.toContain("sign in");
  });
});
