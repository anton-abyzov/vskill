// @vitest-environment jsdom
// 0834 T-025 — DangerZone tests.
// AC-US11-01: 3 cards + delete-account requires typed handle confirmation.

import { describe, it, expect, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { DangerZone } from "../../components/account/DangerZone";

function setReactInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function render(props: {
  pending?: { signOutAll?: boolean; exportRequest?: boolean; deleteAccount?: boolean };
  exports?: ReadonlyArray<{
    id: string;
    status: "queued" | "processing" | "ready" | "failed" | "expired";
    requestedAt: string;
    completedAt: string | null;
    downloadUrl: string | null;
    expiresAt: string | null;
  }>;
}): Promise<{
  container: HTMLDivElement;
  unmount: () => void;
  spies: {
    onSignOutAll: ReturnType<typeof vi.fn>;
    onExportRequest: ReturnType<typeof vi.fn>;
    onDeleteAccount: ReturnType<typeof vi.fn>;
  };
}> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const spies = {
    onSignOutAll: vi.fn(async () => undefined),
    onExportRequest: vi.fn(async () => undefined),
    onDeleteAccount: vi.fn(async () => undefined),
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(DangerZone, {
        githubHandle: "alice",
        exports: props.exports,
        pending: props.pending,
        ...spies,
      }),
    );
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    spies,
  };
}

describe("DangerZone", () => {
  it("renders 3 danger cards", async () => {
    const { container, unmount } = await render({});
    expect(container.querySelector("[data-testid='danger-card-sign-out-of-all-devices']")).not.toBeNull();
    expect(container.querySelector("[data-testid='danger-card-export-my-data']")).not.toBeNull();
    expect(container.querySelector("[data-testid='danger-card-delete-account']")).not.toBeNull();
    unmount();
  });

  it("export request fires immediately (no confirmation modal)", async () => {
    const { container, unmount, spies } = await render({});
    const { act } = await import("react");
    const card = container.querySelector("[data-testid='danger-card-export-my-data']")!;
    const btn = card.querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      btn.click();
    });
    expect(spies.onExportRequest).toHaveBeenCalled();
    unmount();
  });

  it("sign-out-all opens modal and fires onSignOutAll on confirm", async () => {
    const { container, unmount, spies } = await render({});
    const { act } = await import("react");
    const card = container.querySelector("[data-testid='danger-card-sign-out-of-all-devices']")!;
    const btn = card.querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      btn.click();
    });
    const modal = document.querySelector("[data-testid='sign-out-all-modal']");
    expect(modal).not.toBeNull();
    const confirm = Array.from(
      modal!.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => /Sign out everywhere/.test(b.textContent ?? ""))!;
    await act(async () => {
      confirm.click();
    });
    expect(spies.onSignOutAll).toHaveBeenCalled();
    unmount();
  });

  it("delete-account requires typing the GitHub handle", async () => {
    const { container, unmount, spies } = await render({});
    const { act } = await import("react");
    const card = container.querySelector("[data-testid='danger-card-delete-account']")!;
    const btn = card.querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      btn.click();
    });

    const modal = document.querySelector("[data-testid='delete-account-modal']")!;
    const confirm = Array.from(
      modal.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => /Delete account/.test(b.textContent ?? ""))!;
    expect(confirm.disabled).toBe(true);

    const input = modal.querySelector<HTMLInputElement>(
      "[data-testid='delete-account-confirm-input']",
    )!;

    await act(async () => {
      setReactInputValue(input, "wrong");
    });
    expect(confirm.disabled).toBe(true);

    await act(async () => {
      setReactInputValue(input, "alice");
    });
    expect(confirm.disabled).toBe(false);

    await act(async () => {
      confirm.click();
    });
    expect(spies.onDeleteAccount).toHaveBeenCalled();
    unmount();
  });

  it("renders past export jobs", async () => {
    const { container, unmount } = await render({
      exports: [
        {
          id: "e1",
          status: "ready",
          requestedAt: "2026-05-01T00:00:00Z",
          completedAt: "2026-05-01T01:00:00Z",
          downloadUrl: "https://example.com/dump.json",
          expiresAt: "2026-05-08T01:00:00Z",
        },
      ],
    });
    const table = container.querySelector("[data-testid='exports-table']");
    expect(table).not.toBeNull();
    expect(table!.textContent).toMatch(/ready/);
    expect(table!.querySelector("a[href*='example.com']")).not.toBeNull();
    unmount();
  });
});
