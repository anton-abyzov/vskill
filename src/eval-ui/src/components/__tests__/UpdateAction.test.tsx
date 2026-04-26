// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stub StudioContext so UpdateAction doesn't need the provider tree.
// 0766 F-002: UpdateAction now routes post-update invalidation through a
// single `onSkillUpdated(plugin, skill)` helper instead of the old
// refreshUpdates + dismissPushUpdate pair. Tests assert the new contract.
const onSkillUpdatedSpy = vi.fn();
const refreshUpdatesSpy = vi.fn(() => Promise.resolve());
const dismissPushUpdateSpy = vi.fn();
vi.mock("../../StudioContext", () => ({
  useStudio: () => ({
    onSkillUpdated: onSkillUpdatedSpy,
    refreshUpdates: refreshUpdatesSpy,
    dismissPushUpdate: dismissPushUpdateSpy,
  }),
}));

// Stub ChangelogViewer so we don't exercise its parseUnifiedDiff pipeline.
vi.mock("../ChangelogViewer", () => ({
  ChangelogViewer: (props: { fromLabel: string; toLabel: string }) => {
    const React = require("react");
    return React.createElement(
      "div",
      { "data-testid": "changelog-viewer-stub" },
      `diff ${props.fromLabel} → ${props.toLabel}`,
    );
  },
}));

// ---------------------------------------------------------------------------
// fetch mock helpers — control POST /api/skills/:plugin/:skill/update responses
// ---------------------------------------------------------------------------

type FetchResponse =
  | { type: "success"; version: string }
  | { type: "error"; status: number; body: string }
  | { type: "network" };

let nextFetchResponse: FetchResponse = { type: "success", version: "1.4.0" };
let lastFetchUrl: string | null = null;
let lastFetchMethod: string | null = null;
let fetchCallCount = 0;

function makeTextDecoder() {
  // Build a ReadableStream that returns one SSE chunk then closes.
  function makeStream(chunks: string[]) {
    let idx = 0;
    return new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (idx < chunks.length) {
          ctrl.enqueue(new TextEncoder().encode(chunks[idx++]));
        } else {
          ctrl.close();
        }
      },
    });
  }
  return makeStream;
}

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      // Legacy SSE method — should NOT be called in new implementation.
      startSkillUpdate: vi.fn(() => {
        throw new Error("startSkillUpdate must not be called — use postSkillUpdate");
      }),
      postSkillUpdate: vi.fn(async (plugin: string, skill: string) => {
        lastFetchUrl = `/api/skills/${plugin}/${skill}/update`;
        lastFetchMethod = "POST";
        fetchCallCount++;
        const resp = nextFetchResponse;
        if (resp.type === "network") {
          throw new TypeError("Failed to fetch");
        }
        if (resp.type === "error") {
          return {
            ok: false,
            status: resp.status,
            body: resp.body,
            version: undefined,
          } as { ok: false; status: number; body: string; version: undefined };
        }
        return {
          ok: true,
          status: 200,
          body: "",
          version: resp.version,
        } as { ok: true; status: number; body: string; version: string };
      }),
      getVersionDiff: vi.fn(() => Promise.resolve({
        from: "1.0.0",
        to: "1.4.0",
        diffSummary: "mock",
        contentDiff: "--- mock\n+++ mock\n",
      })),
    },
  };
});

async function mountAction(skill: Partial<import("../../types").SkillInfo>) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ToastProvider } = await import("../ToastProvider");
  const { UpdateAction } = await import("../UpdateAction");

  const merged: import("../../types").SkillInfo = {
    plugin: "plugin-a",
    skill: "skill-x",
    dir: "/tmp",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "installed",
    ...skill,
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(ToastProvider, null, React.createElement(UpdateAction, { skill: merged })),
    );
  });
  return {
    container,
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("UpdateAction — POST-based update (0736 US-001)", () => {
  beforeEach(() => {
    nextFetchResponse = { type: "success", version: "1.4.0" };
    lastFetchUrl = null;
    lastFetchMethod = null;
    fetchCallCount = 0;
    onSkillUpdatedSpy.mockClear();
    refreshUpdatesSpy.mockClear();
    dismissPushUpdateSpy.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- render guard tests (unchanged contract) ----------------------------

  it("renders 'Update to X.Y.Z' when skill is outdated with a latest version", async () => {
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe("Update to 1.4.0");
    } finally {
      h.unmount();
    }
  });

  it("renders 'Update' (no version suffix) when latestVersion is null", async () => {
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: undefined });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      expect(btn.textContent).toBe("Update");
    } finally {
      h.unmount();
    }
  });

  it("renders nothing when the skill has no outstanding update", async () => {
    const h = await mountAction({ updateAvailable: false });
    try {
      expect(h.container.querySelector("[data-testid='update-action']")).toBeFalsy();
    } finally {
      h.unmount();
    }
  });

  // ---- AC-US1-01: single POST, inline progress ----------------------------

  it("AC-US1-01: clicking Update issues exactly one POST to /api/skills/:plugin/:skill/update", async () => {
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0", plugin: "my-plugin", skill: "my-skill" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => {
        btn.click();
        await flushMicrotasks();
      });
      expect(fetchCallCount).toBe(1);
      expect(lastFetchUrl).toBe("/api/skills/my-plugin/my-skill/update");
      expect(lastFetchMethod).toBe("POST");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-01: clicking Update shows inline progress (not a toast error)", async () => {
    // Delay the fetch to observe the "updating" state mid-flight.
    let resolveUpdate!: (v: { ok: true; status: number; body: string; version: string }) => void;
    const { api } = await import("../../api");
    vi.mocked(api.postSkillUpdate).mockImplementationOnce(
      () => new Promise((res) => { resolveUpdate = res; }),
    );

    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => {
        btn.click();
        await flushMicrotasks();
      });
      // Button label should be "Updating…" while request is in-flight.
      expect(btn.textContent).toBe("Updating…");
      expect(btn.disabled).toBe(true);
      // Progress element should be visible.
      const progress = h.container.querySelector("[data-testid='update-action-progress']");
      expect(progress).toBeTruthy();
      // Resolve the update so the component doesn't hang.
      await h.act(async () => {
        resolveUpdate({ ok: true, status: 200, body: "", version: "1.4.0" });
        await flushMicrotasks();
      });
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-01: no EventSource / SSE side-channel is opened (only one fetch call)", async () => {
    // The new impl uses postSkillUpdate (mocked), which calls our spy.
    // If startSkillUpdate were called it would throw. So passing + fetchCallCount===1
    // proves we use a single fetch with no EventSource side-channel.
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => {
        btn.click();
        await flushMicrotasks();
      });
      // postSkillUpdate spy was called once (via api mock) and startSkillUpdate was NOT called.
      expect(fetchCallCount).toBe(1);
    } finally {
      h.unmount();
    }
  });

  // ---- AC-US1-02: success path --------------------------------------------

  it("AC-US1-02 (0766 F-002): on 200 success, onSkillUpdated(plugin, skill) fires", async () => {
    // 0766: post-update invalidation now goes through a single helper that
    // refreshes the bell, the listing, the versions key, and the push store
    // — no more partial invalidation that left the Versions tab stale.
    nextFetchResponse = { type: "success", version: "1.4.0" };
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0", plugin: "p", skill: "s" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => {
        btn.click();
        await flushMicrotasks();
      });
      expect(onSkillUpdatedSpy).toHaveBeenCalledTimes(1);
      expect(onSkillUpdatedSpy).toHaveBeenCalledWith("p", "s");
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-02: on success, button returns to enabled and shows updated label", async () => {
    nextFetchResponse = { type: "success", version: "1.4.0" };
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => {
        btn.click();
        await flushMicrotasks();
      });
      // After success the button should no longer be "Updating…" and be re-enabled.
      expect(btn.disabled).toBe(false);
      // No generic "Stream error" toast.
      const toasts = document.querySelectorAll("[data-testid='toast-item']");
      const texts = Array.from(toasts).map((t) => t.textContent).join(" | ");
      expect(texts).not.toContain("Stream error");
    } finally {
      h.unmount();
    }
  });

  // ---- AC-US1-03: failure path with structured error ----------------------

  it("AC-US1-03: non-2xx response shows status code + body excerpt in error banner, button stays enabled", async () => {
    nextFetchResponse = { type: "error", status: 500, body: "Internal Server Error: disk full" };
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => {
        btn.click();
        await flushMicrotasks();
      });
      // Button must stay enabled (not stuck in "Updating…").
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).not.toBe("Updating…");
      // Error display must be visible — either inline or toast, NOT generic "Stream error".
      const errorEl = h.container.querySelector("[data-testid='update-action-error']");
      const toasts = document.querySelectorAll("[data-testid='toast-item']");
      const toastTexts = Array.from(toasts).map((t) => t.textContent).join(" | ");
      const allText = (errorEl?.textContent ?? "") + " " + toastTexts;
      expect(allText).not.toContain("Stream error");
      // Must contain status code.
      expect(allText).toMatch(/500/);
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-03: network error shows informative message, not 'Stream error'", async () => {
    nextFetchResponse = { type: "network" };
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => {
        btn.click();
        await flushMicrotasks();
      });
      expect(btn.disabled).toBe(false);
      const toasts = document.querySelectorAll("[data-testid='toast-item']");
      const texts = Array.from(toasts).map((t) => t.textContent).join(" | ");
      expect(texts).not.toContain("Stream error");
      // Should mention the skill name.
      expect(texts).toMatch(/skill-x/);
    } finally {
      h.unmount();
    }
  });

  // ---- AC-US1-04: path params format <plugin>/<skill> --------------------

  it("AC-US1-04: POST URL uses <plugin>/<skill> path params (not UUID/slug)", async () => {
    const h = await mountAction({ updateAvailable: true, plugin: ".claude", skill: "greet-anton", currentVersion: "1.0.0", latestVersion: "1.1.0" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => {
        btn.click();
        await flushMicrotasks();
      });
      expect(lastFetchUrl).toBe("/api/skills/.claude/greet-anton/update");
    } finally {
      h.unmount();
    }
  });

  // ---- changelog tests (unchanged contract) --------------------------------

  it("toggling 'Preview changelog' loads and renders the ChangelogViewer", async () => {
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const toggle = h.container.querySelector("[data-testid='update-action-toggle-changelog']") as HTMLButtonElement;
      expect(h.container.querySelector("[data-testid='changelog-viewer-stub']")).toBeFalsy();
      await h.act(async () => {
        toggle.click();
        await flushMicrotasks();
      });
      await h.act(async () => { await flushMicrotasks(); });
      expect(h.container.querySelector("[data-testid='changelog-viewer-stub']")).toBeTruthy();
    } finally {
      h.unmount();
    }
  });
});
