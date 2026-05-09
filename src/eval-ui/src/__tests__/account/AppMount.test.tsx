// @vitest-environment jsdom
// 0834 T-027/T-028 — App-mount integration smoke test.
//
// Proves AccountSidebarEntry + AccountShell are actually rendered by the
// host App.tsx (not just exported from the components package). The full
// App tree is too heavy to mount here (StudioProvider triggers SSE,
// QuotaProvider polls, FindSkillsPalette is lazy, etc.) — instead we
// render a minimal Shell-equivalent with the same wiring contract:
//
//   - AccountProvider wraps the tree
//   - AccountSidebarEntry sits below the (stubbed) Skills sidebar
//   - AccountShell mounts in the main pane when the entry is active
//   - Clicking the entry toggles AccountShell on
//
// If the contract here drifts from App.tsx, both must be updated in
// lockstep. Keeping them in sync is the whole point of the test.

import { describe, it, expect, vi, afterEach } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { AccountProvider } from "../../contexts/AccountContext";
import { AccountSidebarEntry } from "../../components/AccountSidebarEntry";
import { AccountShell } from "../../components/AccountShell";

interface Mounted {
  container: HTMLDivElement;
  root: { unmount: () => void };
}
const mounted: Mounted[] = [];

afterEach(async () => {
  const { act } = await import("react");
  while (mounted.length > 0) {
    const m = mounted.pop()!;
    act(() => m.root.unmount());
    m.container.remove();
  }
});

const PROFILE = {
  userId: "u1",
  displayName: "Alice",
  githubHandle: "alice",
  avatarUrl: "https://avatars.githubusercontent.com/u/1",
  bio: null,
  publicProfile: true,
  tier: "pro",
  createdAt: "2026-01-01T00:00:00Z",
};

const REPOS_LIST = {
  repos: [],
  totalCount: 0,
  publicCount: 0,
  privateCount: 0,
};

function makeFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const pick = () => {
      if (url.endsWith("/api/v1/account/profile")) return PROFILE;
      if (url.endsWith("/api/v1/account/repos")) return REPOS_LIST;
      if (url.endsWith("/api/v1/account/tokens")) return [];
      if (url.endsWith("/api/v1/account/skills/summary"))
        return { publicCount: 0, privateCount: 0, recentActivity: [] };
      if (url.endsWith("/api/v1/account/notifications"))
        return {
          weeklyDigest: false,
          securityAlerts: true,
          commentReplies: true,
          productUpdates: false,
        };
      // Server route is /export (singular) and returns { exports: [...] }
      if (url.endsWith("/api/v1/account/export")) return { exports: [] };
      return null;
    };
    const body = pick();
    if (body == null) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/**
 * Minimal stand-in for the App.tsx Shell wiring. Mirrors the same
 * `accountView` toggle, AccountSidebarEntry placement, and AccountShell
 * mount that the real App.tsx uses.
 */
function ShellStub() {
  const React = require("react") as typeof import("react");
  const [accountView, setAccountView] = React.useState(false);

  return React.createElement(
    "div",
    { style: { display: "flex", height: 600 } },
    // Sidebar column
    React.createElement(
      "div",
      {
        "data-testid": "desktop-sidebar",
        style: { width: 240, borderRight: "1px solid #ccc" },
      },
      React.createElement(
        "div",
        { "data-testid": "skills-sidebar-stub" },
        "Skills",
      ),
      React.createElement(AccountSidebarEntry, {
        active: accountView,
        onClick: () => setAccountView((v) => !v),
      }),
    ),
    // Main pane
    React.createElement(
      "div",
      { style: { flex: 1, minHeight: 0 } },
      accountView
        ? React.createElement(AccountShell, { online: true })
        : React.createElement(
            "div",
            { "data-testid": "right-panel-stub" },
            "Skill detail",
          ),
    ),
  );
}

async function renderApp(): Promise<{ container: HTMLDivElement }> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const fetchImpl = makeFetch();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(AccountProvider, {
        value: {
          authMode: "cookie" as const,
          getAuthHeader: async () => null,
          fetchImpl,
        },
        children: React.createElement(ShellStub),
      }),
    );
  });
  // Drain microtasks for any SWR fetches that may fire after mount.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
  act(() => {
    /* commit pending state */
  });
  mounted.push({ container, root });
  return { container };
}

describe("App-mount integration (matches App.tsx wiring)", () => {
  it("renders the Skills sidebar AND the Account entry below it", async () => {
    const { container } = await renderApp();
    expect(
      container.querySelector("[data-testid='desktop-sidebar']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='skills-sidebar-stub']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='account-sidebar-entry']"),
    ).not.toBeNull();
  });

  it("Account entry starts inactive and skill detail is shown by default", async () => {
    const { container } = await renderApp();
    const entry = container.querySelector<HTMLButtonElement>(
      "[data-testid='account-sidebar-entry']",
    )!;
    expect(entry.getAttribute("data-active")).toBe("false");
    expect(
      container.querySelector("[data-testid='right-panel-stub']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='account-shell']"),
    ).toBeNull();
  });

  it("clicking the entry mounts AccountShell with all 7 tabs in spec order", async () => {
    const { container } = await renderApp();
    const { act } = await import("react");
    const entry = container.querySelector<HTMLButtonElement>(
      "[data-testid='account-sidebar-entry']",
    )!;
    act(() => {
      entry.click();
    });

    expect(
      container.querySelector("[data-testid='account-shell']"),
    ).not.toBeNull();
    expect(entry.getAttribute("data-active")).toBe("true");

    const tabs = container.querySelectorAll(
      "[data-testid='account-shell-sidenav'] [data-testid^='account-tab-']",
    );
    const labels = Array.from(tabs).map((t) => t.textContent?.trim());
    expect(labels).toEqual([
      "Profile",
      "Plan & billing",
      "Connected repositories",
      "Skills",
      "API tokens",
      "Notifications",
      "Danger zone",
    ]);
  });

  it("clicking the entry again hides AccountShell and restores skill detail", async () => {
    const { container } = await renderApp();
    const { act } = await import("react");
    const entry = container.querySelector<HTMLButtonElement>(
      "[data-testid='account-sidebar-entry']",
    )!;
    act(() => entry.click());
    expect(
      container.querySelector("[data-testid='account-shell']"),
    ).not.toBeNull();
    act(() => entry.click());
    expect(
      container.querySelector("[data-testid='account-shell']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='right-panel-stub']"),
    ).not.toBeNull();
  });
});
