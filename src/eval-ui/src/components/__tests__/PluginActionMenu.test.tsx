// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0767 — PluginActionMenu uninstall flow
//
// Verifies the new ConfirmDialog-driven uninstall replaces the old
// window.confirm() and surfaces success/error through the studio:toast bus
// instead of relying on tiny inline error text inside the dropdown.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const swrMutateMock = vi.fn();
vi.mock("../../hooks/useSWR", () => ({
  mutate: swrMutateMock,
}));

const triggerPluginsRefreshMock = vi.fn();
vi.mock("../../hooks/usePluginsPolling", () => ({
  triggerPluginsRefresh: triggerPluginsRefreshMock,
}));

interface MountResult {
  container: HTMLDivElement;
  act: (fn: () => void | Promise<void>) => Promise<void>;
  unmount: () => void;
}

async function mount(props: {
  pluginName: string;
  enabled: boolean;
  onAfterAction?: () => void;
}): Promise<MountResult> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { PluginActionMenu } = await import("../PluginActionMenu");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(PluginActionMenu, props));
  });

  return {
    container,
    act: async (fn) => {
      await act(async () => {
        await fn();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function openMenu(h: MountResult): HTMLButtonElement {
  const trigger = h.container.querySelector(
    "[data-vskill-plugin-action-trigger]",
  ) as HTMLButtonElement;
  trigger.click();
  return trigger;
}

function findUninstallItem(h: MountResult): HTMLButtonElement {
  const items = Array.from(
    h.container.querySelectorAll<HTMLButtonElement>("[role='menuitem']"),
  );
  const item = items.find((i) => i.textContent?.startsWith("Uninstall"));
  if (!item) throw new Error("Uninstall menu item not rendered");
  return item;
}

function findConfirmDialog(): HTMLElement | null {
  return document.querySelector("[data-testid='confirm-dialog']");
}

describe("PluginActionMenu — uninstall ConfirmDialog (0767)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let toastEvents: { message: string; severity?: string }[];
  let toastListener: (e: Event) => void;

  beforeEach(() => {
    fetchMock = vi.fn();
    (globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch;
    toastEvents = [];
    toastListener = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; severity?: string }>).detail;
      toastEvents.push({ message: detail.message, severity: detail.severity });
    };
    window.addEventListener("studio:toast", toastListener);
    swrMutateMock.mockReset();
    triggerPluginsRefreshMock.mockReset();
  });

  afterEach(() => {
    window.removeEventListener("studio:toast", toastListener);
    vi.restoreAllMocks();
  });

  it("AC-US1-01/02: clicking Uninstall opens a ConfirmDialog with destructive variant", async () => {
    const h = await mount({ pluginName: "skill-creator", enabled: true });
    try {
      await h.act(async () => {
        openMenu(h);
        await flush();
      });
      await h.act(async () => {
        findUninstallItem(h).click();
        await flush();
      });
      const dialog = findConfirmDialog();
      expect(dialog).toBeTruthy();
      expect(dialog?.querySelector("h2")?.textContent).toContain("skill-creator");
      const confirmBtn = document.querySelector(
        "[data-testid='confirm-dialog-confirm']",
      ) as HTMLButtonElement;
      expect(confirmBtn).toBeTruthy();
      expect(confirmBtn.textContent).toBe("Uninstall");
      // No fetch call yet — the dialog must gate the API request.
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-03: cancelling the dialog makes no API call and dismisses both menu and dialog", async () => {
    const h = await mount({ pluginName: "skill-creator", enabled: true });
    try {
      await h.act(async () => {
        openMenu(h);
        await flush();
      });
      await h.act(async () => {
        findUninstallItem(h).click();
        await flush();
      });
      await h.act(async () => {
        const cancel = document.querySelector(
          "[data-testid='confirm-dialog-cancel']",
        ) as HTMLButtonElement;
        cancel.click();
        await flush();
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(findConfirmDialog()).toBeFalsy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-04 + AC-US2-01: confirming triggers the uninstall API and emits a success toast", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, plugins: [] }),
    });
    const onAfter = vi.fn();
    const h = await mount({
      pluginName: "skill-creator",
      enabled: true,
      onAfterAction: onAfter,
    });
    try {
      await h.act(async () => {
        openMenu(h);
        await flush();
      });
      await h.act(async () => {
        findUninstallItem(h).click();
        await flush();
      });
      await h.act(async () => {
        const confirm = document.querySelector(
          "[data-testid='confirm-dialog-confirm']",
        ) as HTMLButtonElement;
        confirm.click();
        await flush();
        await flush();
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/plugins/skill-creator/uninstall");
      expect(init.method).toBe("POST");
      expect(toastEvents.some(
        (t) => t.severity === "success" && t.message.includes("skill-creator"),
      )).toBe(true);
      expect(onAfter).toHaveBeenCalled();
      expect(swrMutateMock).toHaveBeenCalledWith("skills");
      expect(triggerPluginsRefreshMock).toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("AC-US4-01: a server failure (ok:false) emits an error toast carrying the CLI error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: false,
        code: "claude-cli-failed",
        error: "Plugin not found in installed plugins",
      }),
    });
    const h = await mount({ pluginName: "ghost", enabled: true });
    try {
      await h.act(async () => {
        openMenu(h);
        await flush();
      });
      await h.act(async () => {
        findUninstallItem(h).click();
        await flush();
      });
      await h.act(async () => {
        const confirm = document.querySelector(
          "[data-testid='confirm-dialog-confirm']",
        ) as HTMLButtonElement;
        confirm.click();
        await flush();
        await flush();
      });
      expect(toastEvents.some(
        (t) => t.severity === "error" && t.message.includes("not found"),
      )).toBe(true);
    } finally {
      h.unmount();
    }
  });
});
