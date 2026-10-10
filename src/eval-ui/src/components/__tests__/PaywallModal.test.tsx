// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0874 AC-07 — PaywallModal copy per context, upgrade, dismiss, and the
// force-sync race where the tier comes back paid while the modal is open.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const quotaMock = vi.hoisted(() => ({
  forceSync: vi.fn(async (_fresh?: boolean) => {}),
  snapshot: null as null | { cache: { response: { tier: string } } },
}));
vi.mock("../../contexts/QuotaContext", () => ({
  useQuota: () => ({ forceSync: quotaMock.forceSync, snapshot: quotaMock.snapshot }),
}));

const openExternalUrl = vi.fn(async (_url: string) => {});
vi.mock("../../preferences/lib/useDesktopBridge", () => ({
  useDesktopBridge: () => ({ openExternalUrl }),
}));

import { PaywallModal } from "../PaywallModal";
import { PRICING_URL } from "../../hooks/useTier";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  quotaMock.forceSync.mockClear();
  quotaMock.snapshot = { cache: { response: { tier: "free" } } };
  openExternalUrl.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function title(): string {
  return container.querySelector("#paywall-modal-title")?.textContent ?? "";
}

describe("PaywallModal", () => {
  it("renders nothing when closed", async () => {
    await act(async () => {
      root.render(<PaywallModal open={false} onClose={() => {}} />);
      await flush();
    });
    expect(container.querySelector('[data-testid="paywall-modal"]')).toBeNull();
  });

  it("defaults to the connect copy", async () => {
    await act(async () => {
      root.render(<PaywallModal open onClose={() => {}} skillName="anton/foo" />);
      await flush();
    });
    expect(title()).toBe("Connect private repositories with Skill Studio Pro");
    expect(container.textContent).toContain("Pro adds private repo connections");
    expect(container.textContent).toContain("anton/foo won’t connect until you upgrade.");
  });

  it("uses publish wording in the publish context", async () => {
    await act(async () => {
      root.render(<PaywallModal open onClose={() => {}} context="publish" skillName="greet" />);
      await flush();
    });
    expect(title()).toBe("Publish private skills with Skill Studio Pro");
    expect(container.textContent).toMatch(/publish a skill privately/i);
    expect(container.textContent).not.toContain("private repo connections");
    expect(container.textContent).not.toContain("won’t connect");
  });

  it("Upgrade opens the pricing page through the desktop bridge", async () => {
    await act(async () => {
      root.render(<PaywallModal open onClose={() => {}} context="publish" />);
      await flush();
    });
    await act(async () => {
      (container.querySelector('[data-testid="paywall-upgrade"]') as HTMLButtonElement).click();
      await flush();
    });
    expect(openExternalUrl).toHaveBeenCalledWith(PRICING_URL);
  });

  it("Maybe later closes the modal", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(<PaywallModal open onClose={onClose} />);
      await flush();
    });
    await act(async () => {
      (container.querySelector('[data-testid="paywall-maybe-later"]') as HTMLButtonElement).click();
      await flush();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("force-syncs on open and proceeds when the tier comes back paid", async () => {
    const onClose = vi.fn();
    const onProceed = vi.fn();
    await act(async () => {
      root.render(<PaywallModal open onClose={onClose} onProceed={onProceed} context="publish" />);
      await flush();
    });
    expect(quotaMock.forceSync).toHaveBeenCalledWith(true);
    expect(onProceed).not.toHaveBeenCalled();

    // The fresh sync lands a paid tier in the quota snapshot.
    quotaMock.snapshot = { cache: { response: { tier: "pro" } } };
    await act(async () => {
      root.render(<PaywallModal open onClose={onClose} onProceed={onProceed} context="publish" />);
      await flush();
    });
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});
