// @vitest-environment jsdom
// 0741 T-007: RepoHealthBadge port unit tests — covers the loading skeleton,
// the rendered status pill, and the no-op when repoUrl is missing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let originalFetch: typeof fetch | undefined;

function mockFetchOnce(response: { ok: boolean; status?: string }) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok,
    json: () => Promise.resolve({ status: response.status }),
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
});

async function render(props: { skillName: string; repoUrl: string | undefined }) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { default: RepoHealthBadge } = await import("../RepoHealthBadge");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(RepoHealthBadge, props));
  });

  return {
    container,
    async settle() {
      // Let microtasks flush so the fetch promise chain resolves.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("RepoHealthBadge (ported)", () => {
  it("renders nothing when no repoUrl is provided", async () => {
    mockFetchOnce({ ok: true, status: "ONLINE" });
    const h = await render({ skillName: "owner/repo/skill", repoUrl: undefined });
    expect(h.container.children.length).toBe(0);
    h.unmount();
  });

  it("shows a loading skeleton while the fetch is in-flight", async () => {
    let resolve: (v: unknown) => void = () => {};
    const pending = new Promise((r) => { resolve = r; });
    globalThis.fetch = vi.fn().mockReturnValue(pending) as unknown as typeof fetch;
    const h = await render({ skillName: "owner/repo/skill", repoUrl: "https://github.com/o/r" });
    expect(h.container.querySelector("[data-testid='repo-health-loading']")).toBeTruthy();
    resolve({ ok: true, json: () => Promise.resolve({ status: "ONLINE" }) });
    await h.settle();
    h.unmount();
  });

  it("renders the status pill on success", async () => {
    mockFetchOnce({ ok: true, status: "ONLINE" });
    const h = await render({ skillName: "owner/repo/skill", repoUrl: "https://github.com/o/r" });
    await h.settle();
    const pill = h.container.querySelector("[data-testid='repo-health-badge']");
    expect(pill).toBeTruthy();
    expect(pill?.textContent).toBe("ONLINE");
    h.unmount();
  });

  it("renders nothing when the API returns UNKNOWN", async () => {
    mockFetchOnce({ ok: true, status: "UNKNOWN" });
    const h = await render({ skillName: "owner/repo/skill", repoUrl: "https://github.com/o/r" });
    await h.settle();
    expect(h.container.querySelector("[data-testid='repo-health-badge']")).toBeNull();
    h.unmount();
  });

  it("renders nothing when the API errors", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const h = await render({ skillName: "owner/repo/skill", repoUrl: "https://github.com/o/r" });
    await h.settle();
    expect(h.container.querySelector("[data-testid='repo-health-badge']")).toBeNull();
    h.unmount();
  });

  it("calls the correct API path for hierarchical skill names", async () => {
    const fn = mockFetchOnce({ ok: true, status: "ONLINE" });
    const h = await render({ skillName: "owner/repo/skill", repoUrl: "https://github.com/o/r" });
    await h.settle();
    expect(fn).toHaveBeenCalledWith("/api/v1/skills/owner/repo/skill/repo-health");
    h.unmount();
  });
});
