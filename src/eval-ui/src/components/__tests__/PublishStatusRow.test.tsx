// @vitest-environment jsdom
// 0772 US-005 — PublishStatusRow renders the right CTA per status.

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

// PublishButton calls api.gitProbe internally; stub it to avoid network.
vi.mock("../PublishButton", () => ({
  PublishButton: ({ remoteUrl }: { remoteUrl: string }) => {
    const React = require("react");
    return React.createElement("button", {
      "data-testid": "stub-publish-button",
      "data-remote": remoteUrl,
    }, "Publish");
  },
}));

async function renderRow(props: { projectBasename?: string } = {}): Promise<{
  container: HTMLDivElement;
  unmount: () => void;
}> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { PublishStatusRow } = await import("../PublishStatusRow");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(PublishStatusRow, props));
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("PublishStatusRow (0772 US-005)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("AC-US5-02: status='no-git' renders the gh repo create command with the project basename", async () => {
    mocks.status.current = { hasGit: false, githubOrigin: null, status: "no-git" };
    const { container, unmount } = await renderRow({ projectBasename: "greet-anton-test" });
    const row = container.querySelector("[data-testid='publish-status-row']");
    expect(row?.getAttribute("data-status")).toBe("no-git");
    const cmd = container.querySelector("[data-testid='publish-status-command']");
    expect(cmd?.textContent).toContain("gh repo create greet-anton-test");
    expect(cmd?.textContent).toContain("--public --source=. --remote=origin --push");
    unmount();
  });

  it("AC-US5-02: status='non-github' renders the gh remote add hint", async () => {
    mocks.status.current = { hasGit: true, githubOrigin: null, status: "non-github" };
    const { container, unmount } = await renderRow();
    const row = container.querySelector("[data-testid='publish-status-row']");
    expect(row?.getAttribute("data-status")).toBe("non-github");
    const cmd = container.querySelector("[data-testid='publish-status-command']");
    expect(cmd?.textContent).toContain("gh repo create");
    unmount();
  });

  it("AC-US5-02: status='github' renders the Publish-ready badge + PublishButton", async () => {
    mocks.status.current = {
      hasGit: true,
      githubOrigin: "https://github.com/foo/bar",
      status: "github",
    };
    const { container, unmount } = await renderRow();
    const row = container.querySelector("[data-testid='publish-status-row']");
    expect(row?.getAttribute("data-status")).toBe("github");
    expect(row?.textContent).toContain("Publish-ready");
    expect(row?.textContent).toContain("https://github.com/foo/bar");
    const stub = container.querySelector("[data-testid='stub-publish-button']") as HTMLButtonElement;
    expect(stub).toBeTruthy();
    expect(stub.getAttribute("data-remote")).toBe("https://github.com/foo/bar");
    unmount();
  });

  it("AC-US5-03: Copy button has aria-label and copies the command", async () => {
    mocks.status.current = { hasGit: false, githubOrigin: null, status: "no-git" };
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (s: string) => { writes.push(s); } },
    });
    const { container, unmount } = await renderRow({ projectBasename: "demo" });
    const copy = container.querySelector("[data-testid='publish-status-copy']") as HTMLButtonElement;
    expect(copy.getAttribute("aria-label")).toBe("Copy GitHub setup command");
    copy.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(writes.length).toBe(1);
    expect(writes[0]).toContain("gh repo create demo");
    unmount();
  });
});
