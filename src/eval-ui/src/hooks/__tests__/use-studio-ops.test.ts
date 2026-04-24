// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0688 T-020: useStudioOps hook.
//
// Responsibilities:
//   - On mount: GET /api/studio/ops?limit=50 → seeds state
//   - Live: opens EventSource("/api/studio/ops/stream"); on "op" events,
//     prepends to state (newest first). Dedupes by id.
//   - loadMore(): fetches ?before=<oldest-ts>&limit=50 and appends
//   - remove(id): DELETE /api/studio/ops/:id and drops from state
//   - Cleans up EventSource on unmount
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listStudioOps = vi.fn();
const deleteStudioOp = vi.fn();
const studioOpsStream = vi.fn();

vi.mock("../../api", () => ({
  api: {
    listStudioOps: (...args: unknown[]) => listStudioOps(...args),
    deleteStudioOp: (...args: unknown[]) => deleteStudioOp(...args),
    studioOpsStream: (...args: unknown[]) => studioOpsStream(...args),
  },
}));

// Minimal EventSource stub with manual emit + close tracking.
type Listener = (e: MessageEvent) => void;
class FakeEventSource {
  url: string;
  listeners: Map<string, Listener[]> = new Map();
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(name: string, cb: Listener) {
    const arr = this.listeners.get(name) ?? [];
    arr.push(cb);
    this.listeners.set(name, arr);
  }
  removeEventListener(name: string, cb: Listener) {
    const arr = (this.listeners.get(name) ?? []).filter((l) => l !== cb);
    this.listeners.set(name, arr);
  }
  emit(name: string, data: unknown) {
    const e = new MessageEvent(name, { data: JSON.stringify(data) });
    for (const cb of this.listeners.get(name) ?? []) cb(e);
  }
  close() {
    this.closed = true;
  }
}

type HookReturn = import("../use-studio-ops").UseStudioOpsReturn;

async function mountHook() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { useStudioOps } = await import("../use-studio-ops");

  const ref: { current: HookReturn | null } = { current: null };

  function Probe() {
    ref.current = useStudioOps();
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Probe));
  });

  return {
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

function makeOp(id: string, ts: number, op: "promote" | "revert" = "promote") {
  return { id, ts, op, skillId: `p/${id}`, actor: "studio-ui" as const };
}

let es: FakeEventSource;

beforeEach(() => {
  listStudioOps.mockReset();
  deleteStudioOp.mockReset();
  studioOpsStream.mockReset();
  es = new FakeEventSource("/api/studio/ops/stream");
  studioOpsStream.mockReturnValue(es);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useStudioOps (T-020)", () => {
  it("seeds state from initial list and opens the SSE stream", async () => {
    const initial = [makeOp("a", 100), makeOp("b", 90)];
    listStudioOps.mockResolvedValue(initial);

    const h = await mountHook();
    try {
      await h.act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(listStudioOps).toHaveBeenCalledWith({ limit: 50 });
      expect(studioOpsStream).toHaveBeenCalledTimes(1);
      expect(h.api().ops.map((o) => o.id)).toEqual(["a", "b"]);
    } finally {
      h.unmount();
    }
  });

  it("prepends live op events (newest first)", async () => {
    listStudioOps.mockResolvedValue([makeOp("a", 100)]);
    const h = await mountHook();
    try {
      await h.act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await h.act(async () => {
        es.emit("op", makeOp("b", 200));
      });
      expect(h.api().ops.map((o) => o.id)).toEqual(["b", "a"]);
    } finally {
      h.unmount();
    }
  });

  it("dedupes live events by id", async () => {
    listStudioOps.mockResolvedValue([makeOp("a", 100)]);
    const h = await mountHook();
    try {
      await h.act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await h.act(async () => {
        es.emit("op", makeOp("a", 100));
      });
      expect(h.api().ops.map((o) => o.id)).toEqual(["a"]);
    } finally {
      h.unmount();
    }
  });

  it("loadMore fetches ?before=<oldest-ts> and appends to the tail", async () => {
    listStudioOps.mockResolvedValueOnce([makeOp("a", 200), makeOp("b", 100)]);
    listStudioOps.mockResolvedValueOnce([makeOp("c", 90), makeOp("d", 80)]);

    const h = await mountHook();
    try {
      await h.act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await h.act(async () => {
        await h.api().loadMore();
      });
      expect(listStudioOps).toHaveBeenNthCalledWith(2, { before: 100, limit: 50 });
      expect(h.api().ops.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
    } finally {
      h.unmount();
    }
  });

  it("remove() calls DELETE and drops from state", async () => {
    listStudioOps.mockResolvedValue([makeOp("a", 100), makeOp("b", 90)]);
    deleteStudioOp.mockResolvedValue({ ok: true });

    const h = await mountHook();
    try {
      await h.act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await h.act(async () => {
        await h.api().remove("a");
      });
      expect(deleteStudioOp).toHaveBeenCalledWith("a");
      expect(h.api().ops.map((o) => o.id)).toEqual(["b"]);
    } finally {
      h.unmount();
    }
  });

  it("closes the EventSource on unmount", async () => {
    listStudioOps.mockResolvedValue([]);
    const h = await mountHook();
    await h.act(async () => { await Promise.resolve(); });
    h.unmount();
    expect(es.closed).toBe(true);
  });
});
