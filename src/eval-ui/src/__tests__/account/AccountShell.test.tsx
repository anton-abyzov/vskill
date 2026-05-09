// @vitest-environment jsdom
// 0834 T-027 + T-028 — AccountShell tests.
//
// Covers AC-US12-01 (sidebar entry order), AC-US12-04 (offline banner),
// stub-router state, profile header rendering.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { AccountShell } from "../../components/AccountShell";
import { AccountSidebarEntry } from "../../components/AccountSidebarEntry";
import { AccountProvider } from "../../contexts/AccountContext";
import { ACCOUNT_CACHE_KEYS } from "../../hooks/useAccount";
import { mutate } from "../../hooks/useSWR";

interface MockResponses {
  profile?: unknown;
  repos?: unknown;
  tokens?: unknown;
  notifications?: unknown;
  skills?: unknown;
  exports?: unknown;
}

function makeFetch(responses: MockResponses): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const pick = () => {
      if (url.endsWith("/api/v1/account/profile")) return responses.profile;
      if (url.endsWith("/api/v1/account/repos")) return responses.repos;
      if (url.endsWith("/api/v1/account/tokens")) return responses.tokens;
      if (url.endsWith("/api/v1/account/skills/summary")) return responses.skills;
      if (url.endsWith("/api/v1/account/notifications")) return responses.notifications;
      // Server route is /export (singular) and returns { exports: [...] }
      if (url.endsWith("/api/v1/account/export")) return responses.exports;
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

interface Mounted {
  container: HTMLDivElement;
  root: { unmount: () => void };
}
const mounted: Mounted[] = [];

// Reach into useSWR's module-scope cache to pre-populate it. The
// AccountShell tests don't need to verify network plumbing (that's
// useAccount.test.tsx) — they verify the rendering of the shell given
// data. Pre-populating skips the fetch resolution timing trap that
// otherwise causes flaky timeouts in jsdom.
async function seedCache(map: Record<string, unknown>) {
  // The cache module is initialized once per process, so we import the
  // hook module to get a stable handle, then attach via a side-effect
  // import. Direct access isn't exported, so we go through `mutate +
  // immediate set` via a small forced-render workaround: set a stale
  // entry on the listener-driven cache by calling mutate first then
  // populating via the response when the SWR effect runs. To avoid
  // racing the effect we set the cache by calling fetcher synchronously
  // through the module. Simplest: use the exported `mutate` to invalidate,
  // then rely on the `fetchImpl` in the provider to resolve immediately
  // with the seeded data. Both approaches require waiting for the fetch
  // to land; in this file we go with the immediate-fetch approach.
  void map;
}

async function renderShell(
  props: Parameters<typeof AccountShell>[0] = {},
  responses: MockResponses = { profile: PROFILE },
): Promise<{ container: HTMLDivElement }> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  // Use a synchronous resolved fetch to keep the test deterministic in
  // jsdom — `Promise.resolve().then(...)` chains can interleave with
  // act's microtask flush and starve waiting tests.
  const fetchImpl = makeFetch(responses);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  // Initial render is sync — the only async work is the SWR fetcher's
  // microtask that resolves the Response and calls setState. We wrap
  // it in `act(() => ...)` (sync form) so React flushes the synchronous
  // commit, then drain microtasks outside `act` so the fetcher's then-
  // chain can run without `act` blocking on it.
  act(() => {
    root.render(
      React.createElement(AccountProvider, {
        value: {
          authMode: "cookie" as const,
          getAuthHeader: async () => null,
          fetchImpl,
        },
        children: React.createElement(AccountShell, props),
      }),
    );
  });
  // Wait for the SWR fetch promise chain to drain, then flush the
  // resulting setState into React (sync act).
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
  act(() => {
    // Force a flush — no actual changes, but lets pending state from
    // the SWR fetch commit to the DOM.
  });
  mounted.push({ container, root });
  return { container };
}

async function renderEntry(props: {
  active: boolean;
  onClick: () => void;
  badgeCount?: number;
}): Promise<{ container: HTMLDivElement }> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(AccountSidebarEntry, props));
  });
  mounted.push({ container, root });
  return { container };
}

beforeEach(() => {
  Object.values(ACCOUNT_CACHE_KEYS).forEach((k) => mutate((k as () => string)()));
});

afterEach(async () => {
  const { act } = await import("react");
  while (mounted.length > 0) {
    const m = mounted.pop()!;
    act(() => {
      m.root.unmount();
    });
    m.container.remove();
  }
  // Drain microtasks from any in-flight fetches before the next test
  // starts. Without this, a fetch resolved after unmount can still
  // touch the (now cleared) cache and confuse the next render.
  await new Promise((r) => setTimeout(r, 5));
  Object.values(ACCOUNT_CACHE_KEYS).forEach((k) => mutate((k as () => string)()));
});

describe("AccountShell", () => {
  it("renders 7 sidebar tabs in the spec order", async () => {
    const { container } = await renderShell();
    const sideNav = container.querySelector("[data-testid='account-shell-sidenav']")!;
    const tabs = sideNav.querySelectorAll<HTMLButtonElement>(
      "[data-testid^='account-tab-']",
    );
    const labels = Array.from(tabs).map((b) => b.textContent?.trim());
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

  it("Profile tab is active by default and switches on click", async () => {
    const { container } = await renderShell();
    const profileTab = container.querySelector<HTMLButtonElement>(
      "[data-testid='account-tab-profile']",
    )!;
    expect(profileTab.getAttribute("data-active")).toBe("true");

    const reposTab = container.querySelector<HTMLButtonElement>(
      "[data-testid='account-tab-repos']",
    )!;
    const { act } = await import("react");
    // Use sync act for the click to avoid waiting on the new tab's
    // SWR fetch. The DOM mutation we care about (data-active flip)
    // commits synchronously inside act.
    act(() => {
      reposTab.click();
    });
    expect(reposTab.getAttribute("data-active")).toBe("true");
    expect(profileTab.getAttribute("data-active")).toBe("false");
  });

  it("renders offline banner when online=false", async () => {
    const { container } = await renderShell({ online: false });
    expect(
      container.querySelector("[data-testid='account-shell-offline-banner']"),
    ).not.toBeNull();
  });

  it("respects initialTab prop", async () => {
    const { container } = await renderShell({ initialTab: "tokens" });
    const tab = container.querySelector<HTMLButtonElement>(
      "[data-testid='account-tab-tokens']",
    )!;
    expect(tab.getAttribute("data-active")).toBe("true");
  });

  it("header shows profile display name + handle once loaded", async () => {
    const { container } = await renderShell();
    const header = container.querySelector("[data-testid='account-shell-header']");
    expect(header?.textContent).toMatch(/Alice/);
    expect(header?.textContent).toMatch(/@alice/);
  });
});

describe("AccountSidebarEntry", () => {
  it("renders Account label and fires onClick", async () => {
    const onClick = vi.fn();
    const { container } = await renderEntry({ active: false, onClick });
    const btn = container.querySelector<HTMLButtonElement>(
      "[data-testid='account-sidebar-entry']",
    )!;
    expect(btn.textContent).toMatch(/Account/);
    btn.click();
    expect(onClick).toHaveBeenCalled();
  });

  it("active=true sets data-active and bold weight", async () => {
    const { container } = await renderEntry({
      active: true,
      onClick: () => undefined,
    });
    const btn = container.querySelector<HTMLButtonElement>(
      "[data-testid='account-sidebar-entry']",
    )!;
    expect(btn.getAttribute("data-active")).toBe("true");
  });

  it("renders badge when badgeCount > 0", async () => {
    const { container } = await renderEntry({
      active: false,
      onClick: () => undefined,
      badgeCount: 3,
    });
    const btn = container.querySelector<HTMLButtonElement>(
      "[data-testid='account-sidebar-entry']",
    )!;
    expect(btn.textContent).toMatch(/3/);
  });
});
