// @vitest-environment jsdom
// 0834 T-025 — ProfileForm tests.
//
// AC-US4-01: avatar + display name + read-only handle + bio + public toggle.
// AC-US4-02: save disabled when pristine; submits PATCH on change.

import { describe, it, expect, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ProfileForm } from "../../components/account/ProfileForm";
import type { ProfileDTO } from "../../types/account";

const PROFILE: ProfileDTO = {
  userId: "u1",
  displayName: "Alice",
  githubHandle: "alice",
  avatarUrl: "https://avatars.githubusercontent.com/u/1",
  bio: "Skill builder",
  publicProfile: true,
  tier: "pro",
  createdAt: "2026-01-01T00:00:00Z",
};

// React 18 uses the value-setter "tracker" to detect controlled-input
// changes. Plain `el.value = "x"` bypasses it; we have to call the
// prototype setter explicitly so the synthetic onChange fires.
function setReactInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderForm(props: {
  profile?: ProfileDTO;
  saving?: boolean;
  errorMessage?: string | null;
  onSubmit?: (patch: unknown) => Promise<void>;
}): Promise<{
  container: HTMLDivElement;
  unmount: () => void;
  onSubmit: ReturnType<typeof vi.fn>;
}> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");

  const onSubmit = vi.fn(props.onSubmit ?? (async () => undefined));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(ProfileForm, {
        profile: props.profile ?? PROFILE,
        onSubmit,
        saving: props.saving,
        errorMessage: props.errorMessage,
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

describe("ProfileForm", () => {
  it("renders avatar, handle (read-only), display name, bio, and public toggle", async () => {
    const { container, unmount } = await renderForm({});
    const handleInput = container.querySelector<HTMLInputElement>(
      "#profile-github-handle",
    );
    expect(handleInput?.value).toBe("alice");
    expect(handleInput?.readOnly).toBe(true);

    const displayName = container.querySelector<HTMLInputElement>(
      "[data-testid='profile-display-name']",
    );
    expect(displayName?.value).toBe("Alice");

    const bio = container.querySelector<HTMLTextAreaElement>(
      "[data-testid='profile-bio']",
    );
    expect(bio?.value).toBe("Skill builder");

    const toggle = container.querySelector<HTMLInputElement>(
      "[data-testid='profile-public-toggle']",
    );
    expect(toggle?.checked).toBe(true);

    const avatar = container.querySelector<HTMLImageElement>("img");
    expect(avatar?.src).toContain("avatars.githubusercontent.com");
    unmount();
  });

  it("disables Save button when pristine, enables once dirty", async () => {
    const { container, unmount } = await renderForm({});
    const save = container.querySelector<HTMLButtonElement>(
      "[data-testid='profile-save-button']",
    )!;
    expect(save.disabled).toBe(true);

    const name = container.querySelector<HTMLInputElement>(
      "[data-testid='profile-display-name']",
    )!;
    const { act } = await import("react");
    await act(async () => {
      setReactInputValue(name, "Alice 2");
    });
    expect(save.disabled).toBe(false);
    unmount();
  });

  it("submits only changed fields", async () => {
    const { container, unmount, onSubmit } = await renderForm({});
    const { act } = await import("react");
    const bio = container.querySelector<HTMLTextAreaElement>(
      "[data-testid='profile-bio']",
    )!;
    await act(async () => {
      setReactInputValue(bio, "New bio");
    });

    const save = container.querySelector<HTMLButtonElement>(
      "[data-testid='profile-save-button']",
    )!;
    await act(async () => {
      save.click();
    });

    expect(onSubmit).toHaveBeenCalledWith({ bio: "New bio" });
    unmount();
  });

  it("renders inline error when errorMessage is set", async () => {
    const { container, unmount } = await renderForm({
      errorMessage: "Network failed",
    });
    const err = container.querySelector("[data-testid='profile-form-error']");
    expect(err).not.toBeNull();
    expect(err!.textContent).toMatch(/Network failed/);
    unmount();
  });

  it("disables all inputs while saving", async () => {
    const { container, unmount } = await renderForm({ saving: true });
    const name = container.querySelector<HTMLInputElement>(
      "[data-testid='profile-display-name']",
    );
    const bio = container.querySelector<HTMLTextAreaElement>(
      "[data-testid='profile-bio']",
    );
    const save = container.querySelector<HTMLButtonElement>(
      "[data-testid='profile-save-button']",
    );
    expect(name?.disabled).toBe(true);
    expect(bio?.disabled).toBe(true);
    expect(save?.disabled).toBe(true);
    expect(save?.textContent).toMatch(/Saving/);
    unmount();
  });
});
