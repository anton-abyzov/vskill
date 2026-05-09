// @vitest-environment jsdom
// 0834 T-025 — NotificationsForm tests.
// AC-US10-01: security alerts always-on (disabled-checked).
// AC-US10-02: save persists prefs and forces securityAlerts=true.

import { describe, it, expect, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { NotificationsForm } from "../../components/account/NotificationsForm";
import type { NotificationPrefsDTO } from "../../types/account";

const DEFAULT_PREFS: NotificationPrefsDTO = {
  weeklyDigest: false,
  securityAlerts: true,
  commentReplies: true,
  productUpdates: false,
};

async function render(props: {
  prefs?: NotificationPrefsDTO;
  saving?: boolean;
}): Promise<{
  container: HTMLDivElement;
  unmount: () => void;
  onSubmit: ReturnType<typeof vi.fn>;
}> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const onSubmit = vi.fn(async () => undefined);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(NotificationsForm, {
        prefs: props.prefs ?? DEFAULT_PREFS,
        saving: props.saving,
        onSubmit,
      }),
    );
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    onSubmit,
  };
}

describe("NotificationsForm", () => {
  it("renders 4 rows including security alerts as disabled-checked", async () => {
    const { container, unmount } = await render({});
    const rows = container.querySelectorAll("[data-testid^='notif-row-']");
    expect(rows.length).toBe(4);

    const security = container.querySelector<HTMLInputElement>(
      "[data-testid='notif-checkbox-securityAlerts']",
    );
    expect(security?.checked).toBe(true);
    expect(security?.disabled).toBe(true);
    unmount();
  });

  it("save button is disabled when pristine", async () => {
    const { container, unmount } = await render({});
    const save = container.querySelector<HTMLButtonElement>(
      "[data-testid='notifications-save-button']",
    )!;
    expect(save.disabled).toBe(true);
    unmount();
  });

  it("becomes dirty + submits when a checkbox toggles", async () => {
    const { container, unmount, onSubmit } = await render({});
    const { act } = await import("react");
    const weekly = container.querySelector<HTMLInputElement>(
      "[data-testid='notif-checkbox-weeklyDigest']",
    )!;
    await act(async () => {
      weekly.click();
    });

    const save = container.querySelector<HTMLButtonElement>(
      "[data-testid='notifications-save-button']",
    )!;
    expect(save.disabled).toBe(false);

    await act(async () => {
      save.click();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]![0] as NotificationPrefsDTO;
    expect(submitted.weeklyDigest).toBe(true);
    expect(submitted.securityAlerts).toBe(true); // forced-on invariant
    unmount();
  });
});
