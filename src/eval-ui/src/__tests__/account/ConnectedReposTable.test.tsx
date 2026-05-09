// @vitest-environment jsdom
// 0834 T-025 — ConnectedReposTable component tests.
//
// Covers AC-US5-08: all 4 status colours, empty state, kebab actions,
// summary chip recalculation, and mobile card-list rendering.

import { describe, it, expect, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  ConnectedReposTable,
  relativeTime,
} from "../../components/account/ConnectedReposTable";
import type {
  ConnectedRepoDTO,
  ConnectedReposActions,
} from "../../types/account";

const FIXED_NOW = new Date("2026-05-08T12:00:00Z");

function makeRepo(
  overrides: Partial<ConnectedRepoDTO> = {},
): ConnectedRepoDTO {
  return {
    repoId: "r1",
    ownerLogin: "octocat",
    ownerAvatarUrl: "https://avatars.githubusercontent.com/u/1",
    repoName: "hello",
    repoFullName: "octocat/hello",
    isPrivate: false,
    skillsCount: 3,
    syncStatus: "green",
    lastSyncedAt: "2026-05-08T11:58:00Z",
    lastActivityAt: "2026-05-08T11:58:00Z", // 2 minutes ago
    lastErrorMessage: null,
    githubInstallationId: "12345",
    ...overrides,
  };
}

async function renderTable(props: {
  repos: ReadonlyArray<ConnectedRepoDTO>;
  viewMode?: "table" | "cards";
  pendingActions?: Record<string, "resync" | "disconnect">;
  actions?: Partial<ConnectedReposActions>;
}): Promise<{
  container: HTMLDivElement;
  unmount: () => void;
  spies: Required<ConnectedReposActions>;
}> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");

  const spies: Required<ConnectedReposActions> = {
    onOpenOnGitHub: vi.fn(),
    onResync: vi.fn(),
    onDisconnect: vi.fn(),
    onConnectNew: vi.fn(),
    ...props.actions,
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(ConnectedReposTable, {
        repos: props.repos,
        viewMode: props.viewMode,
        pendingActions: props.pendingActions,
        now: FIXED_NOW,
        ...spies,
      }),
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    spies,
  };
}

describe("ConnectedReposTable", () => {
  it("renders empty state when no repos and triggers connect-new", async () => {
    const { container, unmount, spies } = await renderTable({ repos: [] });

    expect(
      container.querySelector("[data-testid='repos-empty-state']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='repos-table']"),
    ).toBeNull();

    const connectButtons = container.querySelectorAll<HTMLButtonElement>(
      "button",
    );
    // Both summary chip + empty state CTA should fire onConnectNew.
    let firedOnce = false;
    for (const b of connectButtons) {
      if (b.textContent && /connect a github repo/i.test(b.textContent)) {
        b.click();
        firedOnce = true;
        break;
      }
    }
    expect(firedOnce).toBe(true);
    expect(spies.onConnectNew).toHaveBeenCalled();
    unmount();
  });

  it("renders all 4 status colours", async () => {
    const repos: ConnectedRepoDTO[] = [
      makeRepo({ repoId: "g", syncStatus: "green" }),
      makeRepo({ repoId: "a", syncStatus: "amber" }),
      makeRepo({
        repoId: "x",
        syncStatus: "grey",
        skillsCount: 0,
        lastActivityAt: null,
      }),
      makeRepo({ repoId: "r", syncStatus: "red", lastErrorMessage: "Boom" }),
    ];
    const { container, unmount } = await renderTable({ repos });

    expect(container.querySelector("[data-testid='status-green']")).not.toBeNull();
    expect(container.querySelector("[data-testid='status-amber']")).not.toBeNull();
    expect(container.querySelector("[data-testid='status-grey']")).not.toBeNull();
    const redDot = container.querySelector<HTMLElement>("[data-testid='status-red']");
    expect(redDot).not.toBeNull();
    // Red shows error tooltip.
    expect(redDot!.getAttribute("title")).toBe("Boom");
    unmount();
  });

  it("renders summary chip with public/private split", async () => {
    const repos = [
      makeRepo({ repoId: "1", isPrivate: false }),
      makeRepo({ repoId: "2", isPrivate: true }),
      makeRepo({ repoId: "3", isPrivate: true }),
    ];
    const { container, unmount } = await renderTable({ repos });
    const chip = container.querySelector("[data-testid='repos-summary-chip']");
    expect(chip).not.toBeNull();
    const text = chip!.textContent ?? "";
    expect(text).toContain("3");
    expect(text).toMatch(/1 public/);
    expect(text).toMatch(/2 private/);
    unmount();
  });

  it("kebab menu fires Open / Resync / Disconnect callbacks", async () => {
    const repos = [makeRepo()];
    const { container, unmount, spies } = await renderTable({ repos });
    const { act } = await import("react");

    const kebab = container.querySelector<HTMLButtonElement>(
      "[data-testid='kebab-r1']",
    )!;
    await act(async () => {
      kebab.click();
    });

    const menu = container.querySelector("[data-testid='kebab-menu-r1']");
    expect(menu).not.toBeNull();

    const items = menu!.querySelectorAll<HTMLButtonElement>("[role='menuitem']");
    expect(items.length).toBe(3);

    await act(async () => {
      items[0]!.click();
    });
    expect(spies.onOpenOnGitHub).toHaveBeenCalledWith(repos[0]);

    // Re-open menu — it auto-closes on click, so click kebab again.
    await act(async () => {
      kebab.click();
    });
    const items2 = container
      .querySelector("[data-testid='kebab-menu-r1']")!
      .querySelectorAll<HTMLButtonElement>("[role='menuitem']");
    await act(async () => {
      items2[1]!.click();
    });
    expect(spies.onResync).toHaveBeenCalledWith(repos[0]);

    await act(async () => {
      kebab.click();
    });
    const items3 = container
      .querySelector("[data-testid='kebab-menu-r1']")!
      .querySelectorAll<HTMLButtonElement>("[role='menuitem']");
    await act(async () => {
      items3[2]!.click();
    });
    expect(spies.onDisconnect).toHaveBeenCalledWith(repos[0]);
    unmount();
  });

  it("disables resync menu item and shows 'Resyncing…' when pending", async () => {
    const repos = [makeRepo()];
    const { container, unmount } = await renderTable({
      repos,
      pendingActions: { r1: "resync" },
    });
    const { act } = await import("react");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-testid='kebab-r1']")!
        .click();
    });
    const items = container
      .querySelector("[data-testid='kebab-menu-r1']")!
      .querySelectorAll<HTMLButtonElement>("[role='menuitem']");
    const resyncItem = items[1]!;
    expect(resyncItem.disabled).toBe(true);
    expect(resyncItem.textContent).toMatch(/Resyncing/);
    unmount();
  });

  it("renders card-list when viewMode='cards'", async () => {
    const { container, unmount } = await renderTable({
      repos: [makeRepo()],
      viewMode: "cards",
    });
    expect(container.querySelector("[data-testid='repos-card-list']")).not.toBeNull();
    expect(container.querySelector("[data-testid='repo-card-r1']")).not.toBeNull();
    expect(container.querySelector("[data-testid='repos-table']")).toBeNull();
    unmount();
  });

  it("shows '—' for repos with 0 skills", async () => {
    const { container, unmount } = await renderTable({
      repos: [makeRepo({ skillsCount: 0 })],
    });
    const row = container.querySelector("[data-testid='repo-row-r1']");
    expect(row).not.toBeNull();
    expect(row!.textContent).toMatch(/—/);
    unmount();
  });
});

describe("relativeTime", () => {
  it("returns 'Never' for null", () => {
    expect(relativeTime(null, FIXED_NOW)).toBe("Never");
  });
  it("returns 'Just now' under 60s", () => {
    expect(
      relativeTime(new Date(FIXED_NOW.getTime() - 30_000).toISOString(), FIXED_NOW),
    ).toBe("Just now");
  });
  it("returns Nm ago under an hour", () => {
    expect(
      relativeTime(
        new Date(FIXED_NOW.getTime() - 5 * 60_000).toISOString(),
        FIXED_NOW,
      ),
    ).toBe("5m ago");
  });
  it("returns Nh ago under a day", () => {
    expect(
      relativeTime(
        new Date(FIXED_NOW.getTime() - 3 * 60 * 60_000).toISOString(),
        FIXED_NOW,
      ),
    ).toBe("3h ago");
  });
  it("returns Nd ago under a month", () => {
    expect(
      relativeTime(
        new Date(FIXED_NOW.getTime() - 4 * 24 * 60 * 60_000).toISOString(),
        FIXED_NOW,
      ),
    ).toBe("4d ago");
  });
});
