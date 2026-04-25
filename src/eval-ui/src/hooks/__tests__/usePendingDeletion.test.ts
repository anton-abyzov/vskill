// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// usePendingDeletion (0722) — owns the 10s Undo buffer for skill deletion.
//
// Contract:
//   enqueueDelete(skill)  → starts a delayMs timer; on fire, calls
//                           api.deleteSkill(plugin, skill) and emits
//                           onCommit / onFailure to the caller.
//   cancelDelete(skillKey)→ clears the pending timer; api.deleteSkill is
//                           NEVER called.
//   flushPending()        → fires all pending immediately (used in
//                           beforeunload); resolves once all settle.
//   isPending(skillKey)   → boolean.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const deleteSkill = vi.fn();

vi.mock("../../api", () => ({
  api: {
    deleteSkill: (...args: unknown[]) => deleteSkill(...args),
  },
}));

type Skill = { plugin: string; skill: string };
type Hook = import("../usePendingDeletion").UsePendingDeletionReturn;

async function mountHook(opts?: {
  delayMs?: number;
  onCommit?: (s: Skill) => void;
  onFailure?: (s: Skill, e: Error) => void;
}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { usePendingDeletion } = await import("../usePendingDeletion");

  const ref: { current: Hook | null } = { current: null };

  function Probe() {
    ref.current = usePendingDeletion(opts);
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Probe));
  });

  return {
    api(): Hook {
      return ref.current!;
    },
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const skillA: Skill = { plugin: "easychamp", skill: "greet-anton" };
const skillB: Skill = { plugin: "personal", skill: "haiku-writer" };

beforeEach(() => {
  deleteSkill.mockReset();
  deleteSkill.mockResolvedValue({ ok: true });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("usePendingDeletion (0722)", () => {
  it("does NOT call api.deleteSkill if cancelDelete is called within the window", async () => {
    const onCommit = vi.fn();
    const h = await mountHook({ delayMs: 10_000, onCommit });
    try {
      await h.act(async () => {
        h.api().enqueueDelete(skillA);
      });
      expect(h.api().isPending("easychamp/greet-anton")).toBe(true);

      await h.act(async () => {
        h.api().cancelDelete("easychamp/greet-anton");
      });

      // Even if the timer would have fired, it must not because cancel cleared it.
      await h.act(async () => {
        vi.advanceTimersByTime(11_000);
      });

      expect(deleteSkill).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
      expect(h.api().isPending("easychamp/greet-anton")).toBe(false);
    } finally {
      h.unmount();
    }
  });

  it("calls api.deleteSkill exactly once when the timer fires", async () => {
    const onCommit = vi.fn();
    const h = await mountHook({ delayMs: 10_000, onCommit });
    try {
      await h.act(async () => {
        h.api().enqueueDelete(skillA);
      });

      await h.act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(deleteSkill).toHaveBeenCalledTimes(1);
      expect(deleteSkill).toHaveBeenCalledWith("easychamp", "greet-anton");
      expect(onCommit).toHaveBeenCalledWith(skillA);
      expect(h.api().isPending("easychamp/greet-anton")).toBe(false);
    } finally {
      h.unmount();
    }
  });

  it("flushPending() commits every pending delete and clears the queue", async () => {
    const onCommit = vi.fn();
    const h = await mountHook({ delayMs: 10_000, onCommit });
    try {
      await h.act(async () => {
        h.api().enqueueDelete(skillA);
        h.api().enqueueDelete(skillB);
      });

      await h.act(async () => {
        await h.api().flushPending();
      });

      expect(deleteSkill).toHaveBeenCalledTimes(2);
      expect(deleteSkill).toHaveBeenCalledWith("easychamp", "greet-anton");
      expect(deleteSkill).toHaveBeenCalledWith("personal", "haiku-writer");
      expect(h.api().isPending("easychamp/greet-anton")).toBe(false);
      expect(h.api().isPending("personal/haiku-writer")).toBe(false);
    } finally {
      h.unmount();
    }
  });

  it("emits onFailure when the API rejects", async () => {
    deleteSkill.mockRejectedValueOnce(new Error("EACCES"));
    const onCommit = vi.fn();
    const onFailure = vi.fn();
    const h = await mountHook({ delayMs: 10_000, onCommit, onFailure });
    try {
      await h.act(async () => {
        h.api().enqueueDelete(skillA);
      });
      await h.act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onCommit).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledTimes(1);
      const [skillArg, errArg] = onFailure.mock.calls[0];
      expect(skillArg).toEqual(skillA);
      expect((errArg as Error).message).toContain("EACCES");
    } finally {
      h.unmount();
    }
  });
});
