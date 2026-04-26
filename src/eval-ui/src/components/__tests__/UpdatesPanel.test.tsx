// @vitest-environment jsdom
// F-007: UpdatesPanel.handleSingleUpdate must use api.postSkillUpdate (POST),
// NOT api.startSkillUpdate (broken EventSource). This is the same
// ERR_CONNECTION_REFUSED bug US-001 fixed on UpdateAction.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

const postSkillUpdateSpy = vi.fn();
const startSkillUpdateSpy = vi.fn();

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkillUpdates: vi.fn(async () => [
        {
          name: "owner/repo/greet-anton",
          installed: "1.0.0",
          latest: "2.0.0",
          updateAvailable: true,
        },
      ]),
      postSkillUpdate: postSkillUpdateSpy,
      startSkillUpdate: startSkillUpdateSpy,
      getVersionDiff: vi.fn(async () => ({
        from: "1.0.0",
        to: "2.0.0",
        contentDiff: "--- a\n+++ b\n",
        diffSummary: "mock",
      })),
    },
  };
});

// Stub ChangelogViewer
vi.mock("../ChangelogViewer", () => ({
  ChangelogViewer: () => {
    const React = require("react");
    return React.createElement("div", { "data-testid": "changelog-viewer-stub" }, "changelog");
  },
}));

async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function mountPanel() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { UpdatesPanel } = await import("../../pages/UpdatesPanel");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(UpdatesPanel));
  });
  await act(async () => { await flushMicrotasks(); });
  return {
    container,
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("UpdatesPanel — handleSingleUpdate uses postSkillUpdate (F-007)", () => {
  beforeEach(() => {
    postSkillUpdateSpy.mockClear();
    startSkillUpdateSpy.mockClear();
    postSkillUpdateSpy.mockResolvedValue({ ok: true, status: 200, body: "", version: "2.0.0" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clicking single Update button calls api.postSkillUpdate, NOT api.startSkillUpdate", async () => {
    const h = await mountPanel();
    try {
      // Find the "Update" button (not "Update Selected" batch button).
      const allButtons = Array.from(h.container.querySelectorAll("button"));
      const updateBtn = allButtons.find(
        (b) => b.textContent?.trim() === "Update" && !b.textContent?.includes("Selected"),
      );
      expect(updateBtn).toBeTruthy();

      await h.act(async () => {
        updateBtn!.click();
        await flushMicrotasks();
      });

      expect(postSkillUpdateSpy).toHaveBeenCalledTimes(1);
      expect(startSkillUpdateSpy).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("postSkillUpdate is called with correct plugin and skill name extracted from full name", async () => {
    const h = await mountPanel();
    try {
      const allButtons = Array.from(h.container.querySelectorAll("button"));
      const updateBtn = allButtons.find(
        (b) => b.textContent?.trim() === "Update" && !b.textContent?.includes("Selected"),
      );
      await h.act(async () => {
        updateBtn!.click();
        await flushMicrotasks();
      });

      // Skill name is "owner/repo/greet-anton", plugin = "repo", skill = "greet-anton"
      const [calledPlugin, calledSkill] = postSkillUpdateSpy.mock.calls[0] as [string, string, ...unknown[]];
      expect(calledPlugin).toBe("repo");
      expect(calledSkill).toBe("greet-anton");
    } finally {
      h.unmount();
    }
  });

  it("on postSkillUpdate failure, shows structured error in the UI (not silent)", async () => {
    postSkillUpdateSpy.mockResolvedValueOnce({ ok: false, status: 500, body: "Server Error", version: undefined });

    const h = await mountPanel();
    try {
      const allButtons = Array.from(h.container.querySelectorAll("button"));
      const updateBtn = allButtons.find(
        (b) => b.textContent?.trim() === "Update" && !b.textContent?.includes("Selected"),
      );
      await h.act(async () => {
        updateBtn!.click();
        await flushMicrotasks();
      });

      // After failure the button should NOT be stuck in "Updating" state.
      expect(updateBtn!.textContent?.trim()).not.toBe("Updating");
      // An error indicator should be visible somewhere in the panel.
      const panelText = h.container.textContent ?? "";
      // Either "500" or "Error" or similar error indicator.
      const hasError = panelText.includes("500") || panelText.includes("failed") || panelText.includes("error") || panelText.includes("Error");
      expect(hasError).toBe(true);
    } finally {
      h.unmount();
    }
  });

  it("on postSkillUpdate network error, button recovers to enabled state", async () => {
    postSkillUpdateSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const h = await mountPanel();
    try {
      const allButtons = Array.from(h.container.querySelectorAll("button"));
      const updateBtn = allButtons.find(
        (b) => b.textContent?.trim() === "Update" && !b.textContent?.includes("Selected"),
      );
      await h.act(async () => {
        updateBtn!.click();
        await flushMicrotasks();
      });

      // Button should not be permanently disabled.
      expect(updateBtn!.disabled).toBe(false);
    } finally {
      h.unmount();
    }
  });
});
