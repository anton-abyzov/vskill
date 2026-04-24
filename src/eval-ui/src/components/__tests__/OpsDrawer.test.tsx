// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0688 T-020: OpsDrawer component contract.
//
//   - role="dialog", aria-modal="false" (non-blocking right-side inspector)
//   - Renders ops newest-first
//   - Esc closes; focus returns to `triggerRef` when provided
//   - "Load more" button calls loadMore when hasMore
//   - Expandable rows reveal raw JSON
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listStudioOps = vi.fn();
const deleteStudioOp = vi.fn();

type Listener = (e: MessageEvent) => void;
class FakeEventSource {
  url: string;
  listeners: Map<string, Listener[]> = new Map();
  closed = false;
  constructor(url: string) { this.url = url; }
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
  close() { this.closed = true; }
}

vi.mock("../../api", () => ({
  api: {
    listStudioOps: (...args: unknown[]) => listStudioOps(...args),
    deleteStudioOp: (...args: unknown[]) => deleteStudioOp(...args),
    studioOpsStream: () => new FakeEventSource("/api/studio/ops/stream"),
  },
}));

function makeOp(id: string, ts: number, op: "promote" | "revert" = "promote") {
  return {
    id,
    ts,
    op,
    skillId: `p/${id}`,
    fromScope: "installed" as const,
    toScope: "own" as const,
    actor: "studio-ui" as const,
  };
}

async function render(openInit = true) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { OpsDrawer } = await import("../OpsDrawer");

  const onClose = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let open = openInit;
  function App() {
    const [o, setO] = React.useState(open);
    React.useEffect(() => {
      (App as unknown as { setOpen: (v: boolean) => void }).setOpen = setO;
    }, []);
    return React.createElement(OpsDrawer as unknown as React.FC<{ open: boolean; onClose: () => void }>, {
      open: o,
      onClose: () => {
        onClose();
        setO(false);
      },
    });
  }

  await act(async () => {
    root.render(React.createElement(App));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return {
    container,
    onClose,
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  listStudioOps.mockReset();
  deleteStudioOp.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("OpsDrawer (T-020)", () => {
  it("renders nothing when open=false", async () => {
    listStudioOps.mockResolvedValue([]);
    const h = await render(false);
    try {
      expect(document.body.querySelector("[data-testid='ops-drawer']")).toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("renders role=dialog aria-modal=false with ops newest-first", async () => {
    listStudioOps.mockResolvedValue([makeOp("a", 200), makeOp("b", 100)]);
    const h = await render(true);
    try {
      const dlg = document.body.querySelector("[data-testid='ops-drawer']");
      expect(dlg).not.toBeNull();
      expect(dlg?.getAttribute("role")).toBe("dialog");
      expect(dlg?.getAttribute("aria-modal")).toBe("false");
      const rows = document.body.querySelectorAll("[data-testid='ops-drawer-row']");
      expect(rows.length).toBe(2);
      expect(rows[0].getAttribute("data-op-id")).toBe("a");
      expect(rows[1].getAttribute("data-op-id")).toBe("b");
    } finally {
      h.unmount();
    }
  });

  it("Esc key closes the drawer", async () => {
    listStudioOps.mockResolvedValue([]);
    const h = await render(true);
    try {
      await h.act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(h.onClose).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("clicking a row toggles its raw-JSON detail", async () => {
    listStudioOps.mockResolvedValue([makeOp("a", 200)]);
    const h = await render(true);
    try {
      const row = document.body.querySelector<HTMLElement>("[data-testid='ops-drawer-row']");
      expect(row).not.toBeNull();
      await h.act(async () => { row!.click(); });
      const detail = document.body.querySelector("[data-testid='ops-drawer-row-detail']");
      expect(detail).not.toBeNull();
      expect(detail?.textContent).toContain("\"id\": \"a\"");
    } finally {
      h.unmount();
    }
  });

  it("Load more button calls listStudioOps with before=<oldest-ts>", async () => {
    listStudioOps.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => makeOp(`i${i}`, 1000 - i)));
    listStudioOps.mockResolvedValueOnce([]);

    const h = await render(true);
    try {
      const loadMore = document.body.querySelector<HTMLButtonElement>(
        "[data-testid='ops-drawer-load-more']",
      );
      expect(loadMore).not.toBeNull();
      await h.act(async () => { loadMore!.click(); });
      expect(listStudioOps).toHaveBeenNthCalledWith(2, { before: 951, limit: 50 });
    } finally {
      h.unmount();
    }
  });
});
