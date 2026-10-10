// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Connecting a private repo is not plan-gated (0874: only publishing private
// skills sits behind the launch-gate waitlist). The repo widget must show an
// accurate "Private" visibility badge for every tier and never a "Pro" chip.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectedRepoWidget, type RepoInfo } from "../ConnectedRepoWidget";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function repo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    name: "acme/secret-skills",
    branch: "main",
    is_private: true,
    sync_state: { kind: "clean" },
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(
  info: RepoInfo,
  props: Partial<React.ComponentProps<typeof ConnectedRepoWidget>> = {},
): Promise<void> {
  const fetchRepoInfo = vi.fn().mockResolvedValue(info);
  await act(async () => {
    root.render(
      <ConnectedRepoWidget
        folder="/tmp/acme"
        fetchRepoInfo={fetchRepoInfo}
        pollIntervalMs={60_000}
        {...props}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

describe("ConnectedRepoWidget private repo cue", () => {
  for (const tier of [undefined, null, "free", "pro", "enterprise"] as const) {
    it(`shows a Private badge and no Pro chip for tier=${String(tier)}`, async () => {
      await render(repo(), { tier });
      const pill = q("visibility-pill");
      expect(pill).not.toBeNull();
      expect(pill?.getAttribute("data-visibility")).toBe("private");
      expect(pill?.getAttribute("data-private")).toBe("true");
      expect(pill?.textContent).toContain("Private");
      expect(pill?.getAttribute("aria-label")).toBe("Private repository");
      expect(q("repo-upgrade-chip")).toBeNull();
      expect(container.textContent ?? "").not.toMatch(/\bPro\b/);
    });
  }

  it("offers Connect to free users when the host wires it", async () => {
    const onConnect = vi.fn();
    await render(repo(), { tier: "free", onConnectPrivateClick: onConnect });
    const btn = q("repo-connect-private") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => btn!.click());
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("renders the public pill for public repos", async () => {
    await render(repo({ is_private: false }), { tier: "free" });
    const pill = q("visibility-pill");
    expect(pill?.getAttribute("data-visibility")).toBe("public");
    expect(pill?.textContent).toContain("public");
    expect(q("repo-connect-private")).toBeNull();
  });

  it("renders a neutral pill when visibility is unknown", async () => {
    await render(repo({ is_private: null }));
    expect(q("visibility-pill")?.getAttribute("data-visibility")).toBe("unknown");
  });
});
