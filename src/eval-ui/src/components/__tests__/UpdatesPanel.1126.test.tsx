// @vitest-environment jsdom
// 1126: the Updates view shows a failed check with Retry (P1-6), runs
// "Update Selected" as a streamed POST with per-row results (P0-2), reports a
// pinned skip truthfully (P1-4), and can pin / unpin (P1-3).
import { beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({
  getSkillUpdates: vi.fn(),
  runBatchUpdate: vi.fn(),
  postSkillUpdate: vi.fn(),
  pinSkill: vi.fn(),
  unpinSkill: vi.fn(),
}));

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return { ...actual, api: { ...actual.api, ...m } };
});
vi.mock("../ChangelogViewer", () => ({ ChangelogViewer: () => null }));

const rows = [
  { name: "owner/repo/alpha", installed: "1.0.0", latest: "1.1.0", updateAvailable: true, localSkill: "alpha" },
  { name: "owner/repo/beta", installed: "2.0.0", latest: "2.1.0", updateAvailable: true, localSkill: "beta" },
];

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function mount() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { UpdatesPanel } = await import("../../pages/UpdatesPanel");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(UpdatesPanel)); });
  await act(async () => { await flush(); });
  const click = async (el: Element | null | undefined) => {
    await act(async () => { (el as HTMLElement).click(); await flush(); });
  };
  const button = (text: string) =>
    Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith(text));
  return { container, click, button, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
});

describe("UpdatesPanel 1126", () => {
  it("shows the check error with Retry instead of 'up to date', and Retry reloads", async () => {
    m.getSkillUpdates.mockRejectedValueOnce(new Error("Couldn't check for updates: rate limited")).mockResolvedValueOnce(rows);
    const h = await mount();
    try {
      expect(h.container.querySelector("[data-testid='updates-panel-error']")?.textContent).toContain("rate limited");
      expect(h.container.textContent).not.toContain("All skills are up to date");
      expect(m.getSkillUpdates).toHaveBeenCalledWith({ throwOnError: true });
      await h.click(h.container.querySelector("[data-testid='updates-panel-retry']"));
      expect(h.container.textContent).toContain("Available Updates (2)");
    } finally {
      h.unmount();
    }
  });

  it("Update Selected streams per-row results and the real counts", async () => {
    m.getSkillUpdates.mockResolvedValue(rows);
    m.runBatchUpdate.mockImplementation(async (_skills: string[], opts: { onEvent: (e: unknown) => void }) => {
      opts.onEvent({ type: "start", skill: "owner/repo/alpha" });
      opts.onEvent({ type: "done", skill: "owner/repo/alpha", version: "1.1.0" });
      opts.onEvent({ type: "start", skill: "owner/repo/beta" });
      opts.onEvent({ type: "error", skill: "owner/repo/beta", error: "scan FAILED" });
      return { updated: 1, failed: 1, skipped: 0 };
    });
    const h = await mount();
    try {
      await h.click(h.button("Select All"));
      await h.click(h.button("Update Selected (2)"));
      expect(m.runBatchUpdate).toHaveBeenCalledWith(["owner/repo/alpha", "owner/repo/beta"], expect.anything());
      const text = h.container.textContent ?? "";
      expect(text).toContain("done 1.1.0");
      expect(text).toContain("error: scan FAILED");
      expect(text).toContain("Updated 1, 1 failed");
    } finally {
      h.unmount();
    }
  });

  it("a pinned skip is shown as not updated, with the pin", async () => {
    m.getSkillUpdates.mockResolvedValue([rows[0]]);
    m.postSkillUpdate.mockResolvedValue({ ok: false, status: 200, body: "Pinned", version: "1.0.0", skipped: true, skipReason: "pinned", pinnedVersion: "1.0.0" });
    const h = await mount();
    try {
      const single = Array.from(h.container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Update");
      await h.click(single);
      expect(h.container.querySelector("[data-testid='updates-panel-row-error']")?.textContent).toContain("Pinned at 1.0.0");
      expect(h.container.textContent).not.toMatch(/Updated alpha/);
    } finally {
      h.unmount();
    }
  });

  it("Pin and Unpin call the pin routes with local ids", async () => {
    m.getSkillUpdates.mockResolvedValueOnce([rows[0]]).mockResolvedValueOnce([{ ...rows[0], pinned: true, pinnedVersion: "1.0.0" }]);
    m.pinSkill.mockResolvedValue({ found: true, pinned: true, pinnedVersion: "1.0.0" });
    const h = await mount();
    try {
      await h.click(h.container.querySelector("[data-testid='updates-panel-pin-toggle']"));
      expect(m.pinSkill).toHaveBeenCalledWith("repo", "alpha");
      expect(h.container.querySelector("[data-testid='updates-panel-pin-toggle']")?.textContent).toBe("Unpin");
      expect(h.button("📌 1.0.0")?.disabled).toBe(true);
    } finally {
      h.unmount();
    }
  });
});
