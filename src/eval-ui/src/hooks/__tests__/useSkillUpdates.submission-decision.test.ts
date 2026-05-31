// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0859 — desktop half: subscribe to usr_<userId> + route submission_decision
//        SSE events to the native notification.
//
// Covers:
//   T-003 — the ?skills filter includes usr_<userId> ONLY when logged in.
//   T-004 — a `submission_decision` named SSE event fires
//           notifySubmissionOutcome with the right args (approved vs rejected
//           is delegated to the 0847 routing) and does NOT emit a studio:toast
//           or touch the update store; skill-update events still toast.
//   Dedupe — a Last-Event-ID replay of the same decision notifies only once.
//
// The MockEventSource mirrors the one in useSkillUpdates.sse.test.ts so the
// named-event dispatch path (addEventListener("submission_decision", ...)) is
// exercised exactly as the real EventSource would deliver it.
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { updateStore } from "../../stores/updateStore";
import type { SkillUpdateEvent } from "../../types/skill-update";

// Spy on the side-effecting notifier; keep planSubmissionNotification real so a
// follow-up could assert routing through the same module if needed.
const notifySpy = vi.fn(
  async (_submissionId: string, _skillName: string, _state: string) => true,
);
vi.mock("../useSubmissionNotifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useSubmissionNotifications")>();
  return {
    ...actual,
    notifySubmissionOutcome: (submissionId: string, skillName: string, state: string) =>
      notifySpy(submissionId, skillName, state),
  };
});

import { resetDecisionDedupe } from "../useSubmissionNotifications";

// ---------------------------------------------------------------------------
// MockEventSource — tracks named-event listeners so tests can fire
// `submission_decision` / `gone` / default `message` frames deterministically.
// ---------------------------------------------------------------------------
interface MockES {
  url: string;
  readyState: number;
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  listeners: Map<string, Array<(e: MessageEvent) => void>>;
  close: () => void;
  _closed: boolean;
}

const esInstances: MockES[] = [];

class MockEventSource implements MockES {
  url: string;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  _closed = false;

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor(url: string | URL) {
    this.url = typeof url === "string" ? url : url.toString();
    esInstances.push(this);
  }

  addEventListener(type: string, cb: (e: MessageEvent) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }

  removeEventListener(type: string, cb: (e: MessageEvent) => void): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i >= 0) arr.splice(i, 1);
  }

  close(): void {
    this._closed = true;
    this.readyState = 2;
  }
}

function latestES(): MockES {
  const es = esInstances[esInstances.length - 1];
  if (!es) throw new Error("no EventSource instance created yet");
  return es;
}

function fireOpen(es: MockES): void {
  es.readyState = 1;
  es.onopen?.(new Event("open"));
}

function fireSkillUpdate(es: MockES, event: SkillUpdateEvent): void {
  const msg = new MessageEvent("message", {
    data: JSON.stringify(event),
    lastEventId: event.eventId,
  });
  es.onmessage?.(msg);
}

function fireSubmissionDecision(
  es: MockES,
  payload: { submissionId: string; state: string; skillName?: string; eventId?: string },
): void {
  const cbs = es.listeners.get("submission_decision") ?? [];
  const msg = new MessageEvent("submission_decision", {
    data: JSON.stringify({ type: "submission_decision", ...payload }),
    lastEventId: payload.eventId ?? payload.submissionId,
  });
  for (const cb of cbs) cb(msg);
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// Mock the api module so the polling path + check-updates are inert.
const getSkillUpdatesSpy = vi.fn();
const checkUpdatesSpy = vi.fn();
vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkillUpdates: getSkillUpdatesSpy,
      checkSkillUpdates: checkUpdatesSpy,
    },
  };
});

async function mountHook(
  opts?: Parameters<typeof import("../useSkillUpdates").useSkillUpdates>[0],
) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { useSkillUpdates } = await import("../useSkillUpdates");

  const apiRef: {
    current: import("../useSkillUpdates").UseSkillUpdatesReturn | null;
  } = { current: null };

  function Probe() {
    apiRef.current = useSkillUpdates(opts);
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Probe));
  });
  return {
    api() {
      return apiRef.current!;
    },
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function mkSkillUpdate(n: number, skillId: string): SkillUpdateEvent {
  return {
    type: "skill.updated",
    eventId: `evt_${n.toString().padStart(4, "0")}`,
    skillId,
    version: `1.${n}.0`,
    gitSha: `sha${n}`,
    publishedAt: new Date(1_700_000_000_000 + n).toISOString(),
    diffSummary: `update ${n}`,
  };
}

describe("useSkillUpdates — 0859 submission_decision (desktop half)", () => {
  beforeEach(() => {
    esInstances.length = 0;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    setVisibility("visible");
    getSkillUpdatesSpy.mockReset();
    getSkillUpdatesSpy.mockResolvedValue([]);
    checkUpdatesSpy.mockReset();
    checkUpdatesSpy.mockResolvedValue([]);
    notifySpy.mockClear();
    notifySpy.mockResolvedValue(true);
    resetDecisionDedupe();
    updateStore.reset();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // T-003 — usr_<userId> in the ?skills filter only when logged in
  // -------------------------------------------------------------------------
  describe("T-003: user-channel subscription (AC-US1-02, AC-US2-02)", () => {
    it("appends usr_<userId> to the ?skills filter when logged in", async () => {
      const h = await mountHook({ skillIds: ["skill-B", "skill-A"], userId: "u123" });
      try {
        const url = new URL(latestES().url, "http://localhost");
        const skills = (url.searchParams.get("skills") ?? "").split(",");
        expect(skills).toContain("usr_u123");
        expect(skills).toContain("skill-A");
        expect(skills).toContain("skill-B");
      } finally {
        h.unmount();
      }
    });

    it("opens a stream on the user channel alone even with no installed skills", async () => {
      const h = await mountHook({ skillIds: [], userId: "u123" });
      try {
        expect(esInstances.length).toBe(1);
        const url = new URL(latestES().url, "http://localhost");
        expect(url.searchParams.get("skills")).toBe("usr_u123");
      } finally {
        h.unmount();
      }
    });

    it("does NOT add any usr_ id when signed-out (no userId)", async () => {
      const h = await mountHook({ skillIds: ["skill-A", "skill-B"] });
      try {
        const url = new URL(latestES().url, "http://localhost");
        const skills = url.searchParams.get("skills") ?? "";
        expect(skills).toBe("skill-A,skill-B");
        expect(skills).not.toContain("usr_");
      } finally {
        h.unmount();
      }
    });

    it("treats a blank userId as signed-out (no usr_ id)", async () => {
      const h = await mountHook({ skillIds: ["skill-A"], userId: "   " });
      try {
        const skills =
          new URL(latestES().url, "http://localhost").searchParams.get("skills") ?? "";
        expect(skills).not.toContain("usr_");
        expect(skills).toBe("skill-A");
      } finally {
        h.unmount();
      }
    });

    it("keeps the user channel under the 500-id cap (never dropped)", async () => {
      const many = Array.from({ length: 600 }, (_, i) => `skill-${i.toString().padStart(4, "0")}`);
      const h = await mountHook({ skillIds: many, userId: "u123" });
      try {
        const skills = (
          new URL(latestES().url, "http://localhost").searchParams.get("skills") ?? ""
        ).split(",");
        expect(skills.length).toBe(500);
        expect(skills).toContain("usr_u123");
      } finally {
        h.unmount();
      }
    });
  });

  // -------------------------------------------------------------------------
  // T-004 — submission_decision → native notification, no toast
  // -------------------------------------------------------------------------
  describe("T-004: decision → native notification (AC-US1-03, AC-US2-01)", () => {
    it("fires notifySubmissionOutcome on an approved decision (no toast)", async () => {
      const toasts: unknown[] = [];
      const listener = (e: Event) => toasts.push(e);
      window.addEventListener("studio:toast", listener);
      try {
        const h = await mountHook({ skillIds: ["skill-A"], userId: "u123" });
        try {
          await h.act(async () => {
            fireOpen(latestES());
            fireSubmissionDecision(latestES(), {
              submissionId: "sub_1",
              state: "PUBLISHED",
              skillName: "greet",
            });
            await flushMicrotasks();
          });
          expect(notifySpy).toHaveBeenCalledTimes(1);
          expect(notifySpy).toHaveBeenCalledWith("sub_1", "greet", "PUBLISHED");
          // No skill-update toast and no push-store entry — purely additive.
          expect(toasts.length).toBe(0);
          expect(h.api().pushUpdateCount).toBe(0);
        } finally {
          h.unmount();
        }
      } finally {
        window.removeEventListener("studio:toast", listener);
      }
    });

    it("fires notifySubmissionOutcome on a rejected decision with the submission id", async () => {
      const h = await mountHook({ skillIds: ["skill-A"], userId: "u123" });
      try {
        await h.act(async () => {
          fireOpen(latestES());
          fireSubmissionDecision(latestES(), {
            submissionId: "sub_rej",
            state: "REJECTED",
            skillName: "greet",
          });
          await flushMicrotasks();
        });
        // The rejected → clickable → /submit/<id> routing is owned by the 0847
        // notifier; here we assert it received the REJECTED state + the id it
        // needs to build the click target.
        expect(notifySpy).toHaveBeenCalledWith("sub_rej", "greet", "REJECTED");
      } finally {
        h.unmount();
      }
    });

    it("defaults a missing skillName to an empty string for the notifier", async () => {
      const h = await mountHook({ userId: "u123" });
      try {
        await h.act(async () => {
          fireOpen(latestES());
          fireSubmissionDecision(latestES(), { submissionId: "sub_2", state: "PUBLISHED" });
          await flushMicrotasks();
        });
        expect(notifySpy).toHaveBeenCalledWith("sub_2", "", "PUBLISHED");
      } finally {
        h.unmount();
      }
    });

    it("ignores a malformed submission_decision payload (missing submissionId)", async () => {
      const h = await mountHook({ userId: "u123" });
      try {
        await h.act(async () => {
          fireOpen(latestES());
          fireSubmissionDecision(latestES(), {
            submissionId: "",
            state: "PUBLISHED",
          });
          await flushMicrotasks();
        });
        expect(notifySpy).not.toHaveBeenCalled();
      } finally {
        h.unmount();
      }
    });

    it("dedupes a replayed decision (same submissionId+state) — notifies once", async () => {
      const h = await mountHook({ userId: "u123" });
      try {
        await h.act(async () => {
          fireOpen(latestES());
          fireSubmissionDecision(latestES(), { submissionId: "sub_3", state: "PUBLISHED" });
          fireSubmissionDecision(latestES(), { submissionId: "sub_3", state: "PUBLISHED" });
          await flushMicrotasks();
        });
        expect(notifySpy).toHaveBeenCalledTimes(1);
      } finally {
        h.unmount();
      }
    });

    it("still notifies when the same submission transitions to a different state", async () => {
      const h = await mountHook({ userId: "u123" });
      try {
        await h.act(async () => {
          fireOpen(latestES());
          fireSubmissionDecision(latestES(), { submissionId: "sub_4", state: "TIER1_FAILED" });
          fireSubmissionDecision(latestES(), { submissionId: "sub_4", state: "REJECTED" });
          await flushMicrotasks();
        });
        expect(notifySpy).toHaveBeenCalledTimes(2);
      } finally {
        h.unmount();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Regression — skill-update toasts still work alongside the new path
  // -------------------------------------------------------------------------
  describe("regression: skill-update path unaffected (AC-US2-01)", () => {
    it("still dispatches a studio:toast on a skill.updated message", async () => {
      const toasts: Array<{ message: string }> = [];
      const listener = (e: Event) => {
        if (e instanceof CustomEvent) toasts.push(e.detail);
      };
      window.addEventListener("studio:toast", listener);
      try {
        const h = await mountHook({ skillIds: ["skill-A"], userId: "u123" });
        try {
          await h.act(async () => {
            fireOpen(latestES());
            fireSkillUpdate(latestES(), mkSkillUpdate(1, "skill-A"));
            await flushMicrotasks();
          });
          expect(toasts.length).toBe(1);
          expect(toasts[0].message).toContain("1.1.0");
          expect(h.api().pushUpdateCount).toBe(1);
          // The skill-update did NOT trip the submission notifier.
          expect(notifySpy).not.toHaveBeenCalled();
        } finally {
          h.unmount();
        }
      } finally {
        window.removeEventListener("studio:toast", listener);
      }
    });
  });
});
