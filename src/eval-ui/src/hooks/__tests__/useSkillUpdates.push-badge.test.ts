// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SkillUpdateEvent } from "../../types/skill-update";

// ---------------------------------------------------------------------------
// MockEventSource — instances are tracked in `esInstances` so tests can drive
// onmessage/onerror/custom `gone` dispatch deterministically.
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

function fireMessage(es: MockES, event: SkillUpdateEvent): void {
  const msg = new MessageEvent("message", { data: JSON.stringify(event), lastEventId: event.eventId });
  es.onmessage?.(msg);
}

function fireNamedUpdate(es: MockES, event: SkillUpdateEvent): void {
  const msg = new MessageEvent("skill.updated", { data: JSON.stringify(event), lastEventId: event.eventId });
  for (const cb of es.listeners.get("skill.updated") ?? []) cb(msg);
}

function fireError(es: MockES): void {
  es.readyState = 0;
  es.onerror?.(new Event("error"));
}

function fireGone(es: MockES, reason = "too-old"): void {
  const cbs = es.listeners.get("gone") ?? [];
  const msg = new MessageEvent("gone", { data: JSON.stringify({ reason }) });
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

// Mock the api module so polling path + check-updates are observable.
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

async function mountHook(opts?: Parameters<typeof import("../useSkillUpdates").useSkillUpdates>[0]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { useSkillUpdates } = await import("../useSkillUpdates");

  const apiRef: { current: import("../useSkillUpdates").UseSkillUpdatesReturn | null } = { current: null };

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

import { updateStore } from "../../stores/updateStore";
import type { SkillUpdateInfo } from "../../api";

const NAME = "acme/repo/hello-skill";

function pushed(version: string, skillSlug: string | undefined = `sk_published_${NAME}`): SkillUpdateEvent {
  return {
    type: "skill.updated",
    eventId: `evt_${version}`,
    skillId: "11111111-2222-3333-4444-555555555555",
    ...(skillSlug ? { skillSlug } : {}),
    version,
    gitSha: "abc",
    publishedAt: new Date(1_700_000_000_000).toISOString(),
  };
}

function row(over: Partial<SkillUpdateInfo> = {}): SkillUpdateInfo {
  return { name: NAME, installed: "1.0.0", latest: "1.0.0", updateAvailable: false, ...over };
}

describe("applyPushedVersion", () => {
  let applyPushedVersion: typeof import("../useSkillUpdates").applyPushedVersion;
  beforeEach(async () => {
    ({ applyPushedVersion } = await import("../useSkillUpdates"));
  });

  it("marks the matching installed row outdated with the pushed version", () => {
    const out = applyPushedVersion([row()], pushed("1.1.0"));
    expect(out[0]).toMatchObject({ updateAvailable: true, latest: "1.1.0" });
  });

  it("leaves the list untouched for other skills, older versions, pinned rows or no slug", () => {
    const list = [row()];
    expect(applyPushedVersion(list, pushed("1.1.0", "sk_published_acme/repo/other"))).toBe(list);
    expect(applyPushedVersion(list, pushed("1.0.0"))).toBe(list);
    expect(applyPushedVersion(list, pushed("1.1.0", ""))).toBe(list);
    const pinned = [row({ pinned: true, pinnedVersion: "1.0.0" })];
    expect(applyPushedVersion(pinned, pushed("1.1.0"))).toBe(pinned);
  });

  it("does not downgrade a newer latest already known", () => {
    const list = [row({ latest: "1.2.0", updateAvailable: true })];
    expect(applyPushedVersion(list, pushed("1.1.0"))).toBe(list);
    expect(applyPushedVersion(list, pushed("1.3.0"))[0].latest).toBe("1.3.0");
  });
});

describe("useSkillUpdates — pushed skill.updated lights the bell", () => {
  beforeEach(() => {
    esInstances.length = 0;
    vi.stubGlobal("EventSource", MockEventSource);
    getSkillUpdatesSpy.mockReset();
    getSkillUpdatesSpy.mockResolvedValue([row()]);
    checkUpdatesSpy.mockReset();
    checkUpdatesSpy.mockResolvedValue([]);
    updateStore.reset();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("raises updateCount from 0 to 1 on the event, without another poll", async () => {
    const h = await mountHook({ skillIds: [`sk_published_${NAME}`] });
    try {
      await h.act(async () => {
        await flushMicrotasks();
      });
      expect(h.api().updateCount).toBe(0);
      const polls = getSkillUpdatesSpy.mock.calls.length;
      await h.act(async () => {
        fireOpen(latestES());
        fireMessage(latestES(), pushed("1.1.0"));
        await flushMicrotasks();
      });
      expect(h.api().updateCount).toBe(1);
      expect(h.api().updates[0]).toMatchObject({ updateAvailable: true, latest: "1.1.0" });
      expect(getSkillUpdatesSpy.mock.calls.length).toBe(polls);
    } finally {
      h.unmount();
    }
  });
  it("handles the platform's named `event: skill.updated` frames", async () => {
    const h = await mountHook({ skillIds: [`sk_published_${NAME}`] });
    try {
      await h.act(async () => {
        await flushMicrotasks();
      });
      expect(h.api().updateCount).toBe(0);
      await h.act(async () => {
        fireOpen(latestES());
        fireNamedUpdate(latestES(), pushed("1.1.0"));
        await flushMicrotasks();
      });
      expect(h.api().updateCount).toBe(1);
    } finally {
      h.unmount();
    }
  });
});
