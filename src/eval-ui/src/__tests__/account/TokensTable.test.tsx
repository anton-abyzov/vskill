// @vitest-environment jsdom
// 0834 T-025 — TokensTable tests.
// AC-US8-03: generate modal + plaintext-once panel + copy + revoke confirm.
// AC-US8-05: empty state.
// AC-US8-06: revoke confirmation modal.

import { describe, it, expect, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { TokensTable } from "../../components/account/TokensTable";
import type {
  TokenCreateResponseDTO,
  TokenDTO,
} from "../../types/account";

function setReactInputValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const NOW = new Date("2026-05-08T12:00:00Z");

function token(overrides: Partial<TokenDTO> = {}): TokenDTO {
  return {
    id: "t1",
    name: "Build CI",
    prefix: "vsk_abcdef12",
    scopes: ["read", "write"],
    lastUsedAt: "2026-05-08T11:55:00Z",
    createdAt: "2026-05-01T00:00:00Z",
    expiresAt: "2026-08-01T00:00:00Z",
    revokedAt: null,
    ...overrides,
  };
}

async function render(props: {
  tokens?: ReadonlyArray<TokenDTO>;
  recentlyCreated?: TokenCreateResponseDTO | null;
  pendingRevokeId?: string | null;
  creating?: boolean;
}): Promise<{
  container: HTMLDivElement;
  unmount: () => void;
  onCreate: ReturnType<typeof vi.fn>;
  onRevoke: ReturnType<typeof vi.fn>;
  onDismissRecentlyCreated: ReturnType<typeof vi.fn>;
}> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const onCreate = vi.fn(async () => undefined);
  const onRevoke = vi.fn(async () => undefined);
  const onDismissRecentlyCreated = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(TokensTable, {
        tokens: props.tokens ?? [],
        recentlyCreated: props.recentlyCreated ?? null,
        pendingRevokeId: props.pendingRevokeId ?? null,
        creating: props.creating,
        now: NOW,
        onCreate,
        onRevoke,
        onDismissRecentlyCreated,
      }),
    );
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    onCreate,
    onRevoke,
    onDismissRecentlyCreated,
  };
}

describe("TokensTable", () => {
  it("renders empty state with generate CTA when no tokens", async () => {
    const { container, unmount } = await render({});
    expect(container.querySelector("[data-testid='tokens-empty-state']")).not.toBeNull();
    expect(container.querySelector("[data-testid='tokens-table']")).toBeNull();
    unmount();
  });

  it("renders table with rows when tokens present", async () => {
    const { container, unmount } = await render({
      tokens: [token({ id: "a", name: "Build CI" }), token({ id: "b", name: "Local dev" })],
    });
    expect(container.querySelector("[data-testid='tokens-table']")).not.toBeNull();
    expect(container.querySelector("[data-testid='token-row-a']")).not.toBeNull();
    expect(container.querySelector("[data-testid='token-row-b']")).not.toBeNull();
    unmount();
  });

  it("opens generate modal and submits with selected scopes + expiry", async () => {
    const { container, unmount, onCreate } = await render({});
    const { act } = await import("react");

    const generate = container.querySelector<HTMLButtonElement>(
      "[data-testid='tokens-generate-button']",
    )!;
    await act(async () => {
      generate.click();
    });

    const modal = document.querySelector("[data-testid='tokens-generate-modal']");
    expect(modal).not.toBeNull();

    const nameInput = modal!.querySelector<HTMLInputElement>(
      "[data-testid='token-name-input']",
    )!;
    await act(async () => {
      setReactInputValue(nameInput, "CI");
    });

    const writeCb = modal!.querySelector<HTMLInputElement>(
      "[data-testid='scope-write']",
    )!;
    await act(async () => {
      writeCb.click();
    });

    const submit = Array.from(modal!.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => /Generate/.test(b.textContent ?? ""),
    )!;
    await act(async () => {
      submit.click();
    });

    expect(onCreate).toHaveBeenCalledWith({
      name: "CI",
      scopes: ["read", "write"],
      expiresInDays: 90,
    });
    unmount();
  });

  it("shows plaintext panel when recentlyCreated is set", async () => {
    const created: TokenCreateResponseDTO = {
      token: token(),
      plaintext: "vsk_abcdef1234567890zzzzzzzz",
    };
    const { container, unmount } = await render({ recentlyCreated: created });
    const panel = container.querySelector("[data-testid='tokens-created-modal']");
    expect(panel).not.toBeNull();
    const codeBlock = panel!.querySelector("[data-testid='tokens-plaintext']");
    expect(codeBlock?.textContent).toBe("vsk_abcdef1234567890zzzzzzzz");
    unmount();
  });

  it("revoke button opens confirmation modal and fires onRevoke", async () => {
    const t = token({ id: "t-keep" });
    const { container, unmount, onRevoke } = await render({ tokens: [t] });
    const { act } = await import("react");

    const revokeBtn = container.querySelector<HTMLButtonElement>(
      "[data-testid='token-revoke-t-keep']",
    )!;
    await act(async () => {
      revokeBtn.click();
    });

    const modal = document.querySelector("[data-testid='tokens-revoke-modal']");
    expect(modal).not.toBeNull();
    expect(modal!.textContent).toMatch(/vsk_abcdef12/);

    const confirm = Array.from(modal!.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => /^Revoke$/.test((b.textContent ?? "").trim()),
    )!;
    await act(async () => {
      confirm.click();
    });
    expect(onRevoke).toHaveBeenCalledWith(t);
    unmount();
  });

  it("revoked tokens render greyed-out without revoke button", async () => {
    const revoked = token({ revokedAt: "2026-05-07T00:00:00Z" });
    const { container, unmount } = await render({ tokens: [revoked] });
    expect(
      container.querySelector("[data-testid='token-revoke-t1']"),
    ).toBeNull();
    const row = container.querySelector("[data-testid='token-row-t1']");
    expect(row?.textContent).toMatch(/Revoked/);
    unmount();
  });
});
