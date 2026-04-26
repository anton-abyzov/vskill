// @vitest-environment jsdom
// 0772 US-006 — SidebarGitHubIndicator renders only when not connected.

import { describe, it, expect, beforeEach, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  status: {
    current: { hasGit: false, githubOrigin: null, status: "no-git" as const },
  },
}));

vi.mock("../../hooks/useGitHubStatus", () => ({
  useGitHubStatus: () => ({
    status: mocks.status.current,
    loading: false,
    error: undefined,
    revalidate: vi.fn(),
  }),
}));

async function renderIndicator(projectRoot = "claude-code"): Promise<{
  container: HTMLDivElement;
  unmount: () => void;
}> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { SidebarGitHubIndicator } = await import("../SidebarGitHubIndicator");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(SidebarGitHubIndicator, { projectRoot }));
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("SidebarGitHubIndicator (0772 US-006)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    try { window.localStorage.clear(); } catch { /* ignore */ }
  });

  it("AC-US6-01: renders the cloud-off icon when status='no-git'", async () => {
    mocks.status.current = { hasGit: false, githubOrigin: null, status: "no-git" };
    const { container, unmount } = await renderIndicator();
    const btn = container.querySelector(
      "[data-testid='sidebar-github-not-connected']",
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBe("GitHub not connected — click for help");
    expect(btn.getAttribute("title")).toMatch(/gh repo create/);
    unmount();
  });

  it("AC-US6-01: renders for status='non-github' with the appropriate tooltip", async () => {
    mocks.status.current = { hasGit: true, githubOrigin: null, status: "non-github" };
    const { container, unmount } = await renderIndicator();
    const btn = container.querySelector(
      "[data-testid='sidebar-github-not-connected']",
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("title")).toMatch(/origin is not github/i);
    unmount();
  });

  it("AC-US6-02: renders nothing when status='github'", async () => {
    mocks.status.current = {
      hasGit: true,
      githubOrigin: "https://github.com/foo/bar",
      status: "github",
    };
    const { container, unmount } = await renderIndicator();
    const btn = container.querySelector("[data-testid='sidebar-github-not-connected']");
    expect(btn).toBeFalsy();
    unmount();
  });

  it("AC-US6-03: clicking dispatches studio:focus-publish-row", async () => {
    mocks.status.current = { hasGit: false, githubOrigin: null, status: "no-git" };
    const events: Event[] = [];
    const listener = (e: Event): void => { events.push(e); };
    window.addEventListener("studio:focus-publish-row", listener);

    const { container, unmount } = await renderIndicator();
    const btn = container.querySelector(
      "[data-testid='sidebar-github-not-connected']",
    ) as HTMLButtonElement;
    btn.click();
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("studio:focus-publish-row");
    window.removeEventListener("studio:focus-publish-row", listener);
    unmount();
  });

  it("AC-US6-05: dismissed projects render nothing", async () => {
    mocks.status.current = { hasGit: false, githubOrigin: null, status: "no-git" };
    window.localStorage.setItem("vskill-github-hint-dismissed-claude-code", "true");
    const { container, unmount } = await renderIndicator("claude-code");
    const btn = container.querySelector("[data-testid='sidebar-github-not-connected']");
    expect(btn).toBeFalsy();
    unmount();
  });
});
