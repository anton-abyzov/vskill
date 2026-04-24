// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0703 — CreateSkillModal pre-flight duplicate check on Generate-with-AI path.
//
// The "Generate with AI" button must probe /api/authoring/skill-exists before
// navigating. If the skill already exists, show an inline error and stay on
// step 2. Only navigate when exists:false.
// ---------------------------------------------------------------------------

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CreateSkillModal } from "../CreateSkillModal";

// Stub out the SWR mutate — modal imports it but we don't care about cache.
vi.mock("../../hooks/useSWR", () => ({
  mutate: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function mountModal(): { container: HTMLElement; unmount: () => void; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(CreateSkillModal, {
        open: true,
        onClose: vi.fn(),
        initialMode: "standalone",
        isClaudeCode: true,
        projectRoot: "/tmp/proj",
      }),
    );
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function advanceToDetails(container: HTMLElement): Promise<void> {
  // Click Continue → (the first "Continue" button is the only one with that label)
  const continueBtn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.includes("Continue"),
  );
  if (!continueBtn) throw new Error("Continue button not found");
  await act(async () => {
    continueBtn.click();
    await Promise.resolve();
  });
}

async function typeSkillName(container: HTMLElement, name: string): Promise<void> {
  // The skill-name input is the only kebab-validated text input on the step-2 screen.
  const inputs = Array.from(container.querySelectorAll('input[type="text"]'));
  const skillInput = inputs.find((i) => (i as HTMLInputElement).placeholder === "my-new-skill") as
    | HTMLInputElement
    | undefined;
  if (!skillInput) throw new Error("skill-name input not found");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(skillInput, name);
  skillInput.dispatchEvent(new Event("input", { bubbles: true }));
  await act(async () => { await Promise.resolve(); });
}

async function clickGenerateWithAi(container: HTMLElement): Promise<void> {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.includes("Generate with AI"),
  );
  if (!btn) throw new Error("Generate with AI button not found");
  await act(async () => {
    btn.click();
    await Promise.resolve();
  });
  // let any pending microtasks (fetch resolve) settle
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
const originalLocation = window.location;
let fetchCalls: FetchCall[] = [];
let assignMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchCalls = [];
  assignMock = vi.fn();
  // jsdom's window.location.assign is not reconfigurable on its own, but the
  // whole `location` property on `window` is. Swap in a thin proxy.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...originalLocation,
      assign: assignMock,
      hash: "",
      href: originalLocation.href,
    },
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

function stubFetch(response: { ok: boolean; status?: number; body: unknown }): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url, init });
    // /api/authoring/plugins bootstrap call must also succeed
    if (url.includes("/api/authoring/plugins")) {
      return {
        ok: true,
        json: async () => ({ plugins: [] }),
      } as Response;
    }
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body,
    } as Response;
  }) as unknown as typeof fetch;
}

describe("0703 — CreateSkillModal Generate-with-AI pre-check", () => {
  it("AC-US2-04: shows error and does NOT navigate when skill already exists", async () => {
    stubFetch({
      ok: true,
      body: { exists: true, path: "/tmp/proj/skills/anton-greet" },
    });

    const h = mountModal();
    try {
      await advanceToDetails(h.container);
      await typeSkillName(h.container, "anton-greet");
      await clickGenerateWithAi(h.container);

      expect(assignMock).not.toHaveBeenCalled();
      expect(h.container.textContent).toMatch(/already exists/i);
      // Probe must have gone out
      const probe = fetchCalls.find((c) => c.url.includes("/api/authoring/skill-exists"));
      expect(probe).toBeDefined();
      expect(probe!.url).toContain("skillName=anton-greet");
      expect(probe!.url).toContain("mode=standalone");
    } finally {
      h.unmount();
    }
  });

  it("AC-US2-05: navigates to /#/create when the skill name is free", async () => {
    stubFetch({
      ok: true,
      body: { exists: false, path: "/tmp/proj/skills/anton-greet" },
    });

    const h = mountModal();
    try {
      await advanceToDetails(h.container);
      await typeSkillName(h.container, "anton-greet");
      await clickGenerateWithAi(h.container);

      expect(assignMock).toHaveBeenCalledTimes(1);
      const navUrl = String(assignMock.mock.calls[0][0]);
      expect(navUrl).toContain("/#/create");
      expect(navUrl).toContain("skillName=anton-greet");
      expect(navUrl).toContain("mode=standalone");
    } finally {
      h.unmount();
    }
  });
});
