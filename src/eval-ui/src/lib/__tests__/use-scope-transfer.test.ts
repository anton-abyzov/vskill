// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0688 T-019: useScopeTransfer hook contract.
//
// Orchestrates the promote/test-install/revert ceremony:
//   1. captureRect(skill)               — FLIP: First
//   2. api.<verb>Skill(...)             — SSE POST; resolves on `done`
//   3. refresh()                        — re-scan skill list
//   4. rAF → runFlip(skill, firstRect)  — FLIP: Last + Invert + Play
//   5. toast(...)                       — 5s duration, Undo action on promote
//
// These tests stub api + flip + toast + refresh to prove the orchestration
// happens in the right order with the right arguments, without touching the
// network, the DOM geometry, or the animation library.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- mocks (must be declared before module import) ------------------------

const promoteSkill = vi.fn();
const testInstallSkill = vi.fn();
const revertSkill = vi.fn();

vi.mock("../../api", () => ({
  api: {
    promoteSkill: (...args: unknown[]) => promoteSkill(...args),
    testInstallSkill: (...args: unknown[]) => testInstallSkill(...args),
    revertSkill: (...args: unknown[]) => revertSkill(...args),
  },
}));

const captureRect = vi.fn();
const runFlip = vi.fn();

vi.mock("../flip", () => ({
  captureRect: (...args: unknown[]) => captureRect(...args),
  runFlip: (...args: unknown[]) => runFlip(...args),
}));

const refreshSkills = vi.fn();

vi.mock("../../StudioContext", () => ({
  useStudio: () => ({ refreshSkills }),
}));

// ---------------------------------------------------------------------------

type HookReturn = import("../use-scope-transfer").UseScopeTransferReturn;

async function mountHook() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ToastProvider } = await import("../../components/ToastProvider");
  const { useScopeTransfer } = await import("../use-scope-transfer");

  const ref: { current: HookReturn | null } = { current: null };

  function Probe() {
    ref.current = useScopeTransfer();
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(ToastProvider, null, React.createElement(Probe)));
  });

  return {
    container,
    api(): HookReturn {
      return ref.current!;
    },
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function stubRAF() {
  // Run rAF callbacks synchronously within `act`, so tests don't have to
  // drive a separate clock.
  (globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame =
    ((cb: () => void) => {
      cb();
      return 0;
    }) as typeof requestAnimationFrame;
}

beforeEach(() => {
  promoteSkill.mockReset();
  testInstallSkill.mockReset();
  revertSkill.mockReset();
  captureRect.mockReset();
  runFlip.mockReset();
  refreshSkills.mockReset();
  stubRAF();
});

afterEach(() => {
  document.body.innerHTML = "";
});

const skill = { plugin: "p", skill: "s" };

describe("useScopeTransfer.promote (T-019)", () => {
  it("captures rect, calls api.promoteSkill, refreshes, runs flip, and toasts", async () => {
    const fakeRect = new DOMRect(10, 20, 100, 36);
    captureRect.mockReturnValue(fakeRect);
    promoteSkill.mockResolvedValue({ type: "done", scope: "own" });

    const h = await mountHook();
    try {
      await h.act(async () => {
        await h.api().promote(skill);
      });

      expect(captureRect).toHaveBeenCalledWith(skill);
      expect(promoteSkill).toHaveBeenCalledWith("p", "s", expect.any(Object));
      expect(refreshSkills).toHaveBeenCalledTimes(1);
      expect(runFlip).toHaveBeenCalledWith(skill, fakeRect);

      const toastNode = h.container.querySelector("[data-testid='toast-item']");
      expect(toastNode).not.toBeNull();
      expect(toastNode?.textContent).toMatch(/Promoted/);
      const undoBtn = Array.from(h.container.querySelectorAll("button")).find(
        (b) => b.textContent === "Undo",
      );
      expect(undoBtn).toBeTruthy();
    } finally {
      h.unmount();
    }
  });

  it("Undo toast action triggers a revert", async () => {
    captureRect.mockReturnValue(new DOMRect(0, 0, 100, 36));
    promoteSkill.mockResolvedValue({ type: "done", scope: "own" });
    revertSkill.mockResolvedValue({ type: "done", scope: "installed" });

    const h = await mountHook();
    try {
      await h.act(async () => {
        await h.api().promote(skill);
      });
      const undoBtn = Array.from(h.container.querySelectorAll("button")).find(
        (b) => b.textContent === "Undo",
      ) as HTMLButtonElement;
      expect(undoBtn).toBeTruthy();
      await h.act(async () => {
        undoBtn.click();
      });
      expect(revertSkill).toHaveBeenCalledWith("p", "s", expect.any(Object));
    } finally {
      h.unmount();
    }
  });

  it("shows error toast and skips refresh when api throws", async () => {
    captureRect.mockReturnValue(null);
    promoteSkill.mockRejectedValue(Object.assign(new Error("conflict"), { code: "ALREADY_EXISTS" }));

    const h = await mountHook();
    try {
      await h.act(async () => {
        await h.api().promote(skill).catch(() => {});
      });
      expect(refreshSkills).not.toHaveBeenCalled();
      expect(runFlip).not.toHaveBeenCalled();
      const toastNode = h.container.querySelector("[data-testid='toast-item']");
      expect(toastNode).not.toBeNull();
      expect(toastNode?.textContent).toMatch(/conflict|failed/i);
    } finally {
      h.unmount();
    }
  });
});

describe("useScopeTransfer.testInstall (T-019)", () => {
  it("defaults dest=installed, refreshes, flips, and toasts", async () => {
    captureRect.mockReturnValue(new DOMRect(0, 0, 100, 36));
    testInstallSkill.mockResolvedValue({ type: "done", scope: "installed" });

    const h = await mountHook();
    try {
      await h.act(async () => {
        await h.api().testInstall(skill);
      });
      expect(testInstallSkill).toHaveBeenCalledWith(
        "p",
        "s",
        expect.objectContaining({ dest: "installed" }),
      );
      expect(refreshSkills).toHaveBeenCalledTimes(1);
      expect(runFlip).toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("passes dest=global when requested", async () => {
    captureRect.mockReturnValue(new DOMRect(0, 0, 100, 36));
    testInstallSkill.mockResolvedValue({ type: "done", scope: "global" });

    const h = await mountHook();
    try {
      await h.act(async () => {
        await h.api().testInstall(skill, "global");
      });
      expect(testInstallSkill).toHaveBeenCalledWith(
        "p",
        "s",
        expect.objectContaining({ dest: "global" }),
      );
    } finally {
      h.unmount();
    }
  });
});

describe("useScopeTransfer.revert (T-019)", () => {
  it("calls api.revertSkill, refreshes, flips, and toasts without Undo action", async () => {
    captureRect.mockReturnValue(new DOMRect(0, 0, 100, 36));
    revertSkill.mockResolvedValue({ type: "done", scope: "installed" });

    const h = await mountHook();
    try {
      await h.act(async () => {
        await h.api().revert(skill);
      });
      expect(revertSkill).toHaveBeenCalledWith("p", "s", expect.any(Object));
      expect(refreshSkills).toHaveBeenCalledTimes(1);
      expect(runFlip).toHaveBeenCalled();
      const undoBtn = Array.from(h.container.querySelectorAll("button")).find(
        (b) => b.textContent === "Undo",
      );
      expect(undoBtn).toBeFalsy();
    } finally {
      h.unmount();
    }
  });
});
