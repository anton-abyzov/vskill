// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0856 — AccountShell "My queue" tab mount test.
//
// Proves the cabinet exposes a "My queue" nav affordance and that selecting
// it mounts the self-contained SubmissionQueuePanel (data-testid
// "submission-queue-panel"). The panel loads its feed via api.getMyQueue()
// and subscribes to the SSE stream — both are stubbed here:
//   - globalThis.fetch feeds getMyQueue an empty envelope (→ panel empty
//     state), proving graceful degradation for a user with no submissions.
//   - the sse module's openFetchEventStream is mocked to a no-op handle so
//     no real EventStream is opened in jsdom.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stub the SSE transport so the panel's subscription is inert in jsdom.
const sseCloseSpy = vi.fn();
vi.mock("../../api/sse", async () => {
  const actual = await vi.importActual<typeof import("../../api/sse")>("../../api/sse");
  return {
    ...actual,
    openFetchEventStream: vi.fn(() => ({ close: sseCloseSpy })),
  };
});

import { AccountShell } from "../../components/AccountShell";
import { AccountProvider } from "../../contexts/AccountContext";
import { ACCOUNT_CACHE_KEYS } from "../../hooks/useAccount";
import { mutate } from "../../hooks/useSWR";

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

let originalFetch: typeof globalThis.fetch;

// AccountShell tabs fetch via the AccountProvider's fetchImpl, but the
// SubmissionQueuePanel calls api.getMyQueue() which hits globalThis.fetch
// directly. Stub both: the provider fetch serves the profile (so the header
// loads) and the global fetch serves the empty submission envelope.
function makeFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/v1/account/profile")) {
      return new Response(JSON.stringify(PROFILE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/v1/submissions")) {
      return new Response(
        JSON.stringify({ submissions: [], queuePositions: {} }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

async function renderShell(
  props: Parameters<typeof AccountShell>[0] = {},
): Promise<{ container: HTMLDivElement }> {
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
        children: React.createElement(AccountShell, props),
      }),
    );
  });
  // Drain the SWR + getMyQueue fetch promise chains, then flush into React.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
  act(() => {
    // Force a flush so pending setState from the resolved fetches commits.
  });
  mounted.push({ container, root });
  return { container };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetch();
  sseCloseSpy.mockClear();
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
  await new Promise((r) => setTimeout(r, 5));
  globalThis.fetch = originalFetch;
  Object.values(ACCOUNT_CACHE_KEYS).forEach((k) => mutate((k as () => string)()));
});

describe("AccountShell — My queue tab", () => {
  it("renders a 'My queue' nav affordance between Skills and API tokens", async () => {
    const { container } = await renderShell();
    const sideNav = container.querySelector("[data-testid='account-shell-sidenav']")!;
    const labels = Array.from(
      sideNav.querySelectorAll<HTMLButtonElement>("[data-testid^='account-tab-']"),
    ).map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      "Profile",
      "Plan & billing",
      "Connected repositories",
      "Skills",
      "My queue",
      "API tokens",
      "Notifications",
      "Danger zone",
    ]);
    expect(
      container.querySelector("[data-testid='account-tab-queue']"),
    ).not.toBeNull();
  });

  it("mounts SubmissionQueuePanel when the queue tab is selected", async () => {
    const { container } = await renderShell();
    // Not mounted under the default (Profile) tab.
    expect(
      container.querySelector("[data-testid='submission-queue-panel']"),
    ).toBeNull();

    const queueTab = container.querySelector<HTMLButtonElement>(
      "[data-testid='account-tab-queue']",
    )!;
    const { act } = await import("react");
    act(() => {
      queueTab.click();
    });
    // Let getMyQueue() resolve and the panel commit its rows/empty state.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    act(() => {
      // flush
    });

    expect(queueTab.getAttribute("data-active")).toBe("true");
    expect(
      container.querySelector("[data-testid='account-queue-tab']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='submission-queue-panel']"),
    ).not.toBeNull();
  });

  it("mounts directly via initialTab='queue' and degrades to the empty state", async () => {
    const { container } = await renderShell({ initialTab: "queue" });
    const tab = container.querySelector<HTMLButtonElement>(
      "[data-testid='account-tab-queue']",
    )!;
    expect(tab.getAttribute("data-active")).toBe("true");
    expect(
      container.querySelector("[data-testid='submission-queue-panel']"),
    ).not.toBeNull();
    // No submissions → panel renders its own empty state, not a crash.
    expect(container.querySelector("[data-testid='queue-empty']")).not.toBeNull();
  });
});
