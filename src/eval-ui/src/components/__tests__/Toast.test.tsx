// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ReactLib = typeof import("react");
type Root = ReturnType<typeof import("react-dom/client")["createRoot"]>;
type ToastApi = import("../ToastProvider").ToastContextValue;

async function mountWithApi() {
  const React: ReactLib = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ToastProvider, useToast } = await import("../ToastProvider");

  const apiRef: { current: ToastApi | null } = { current: null };

  function Probe() {
    apiRef.current = useToast();
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(
      React.createElement(ToastProvider, null, React.createElement(Probe)),
    );
  });

  return {
    container,
    root,
    api(): ToastApi {
      return apiRef.current!;
    },
    act: (fn: () => void) => act(fn),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("Toast / ToastProvider (T-052)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a toast in the bottom-right stack", async () => {
    const h = await mountWithApi();
    try {
      h.act(() => {
        h.api().toast({ message: "Saved", severity: "success" });
      });
      const stack = h.container.querySelector("[data-testid='toast-stack']") as HTMLElement;
      expect(stack).toBeTruthy();
      expect(stack.style.position).toBe("fixed");
      expect(stack.style.right).toBe("16px");
      expect(stack.style.bottom).toBe("16px");
      const items = h.container.querySelectorAll("[data-testid='toast-item']");
      expect(items.length).toBe(1);
      expect(items[0].textContent).toContain("Saved");
    } finally {
      h.unmount();
    }
  });

  it("auto-dismisses after 4000ms by default", async () => {
    const h = await mountWithApi();
    try {
      h.act(() => {
        h.api().toast({ message: "Installed" });
      });
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(1);
      h.act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(0);
    } finally {
      h.unmount();
    }
  });

  it("respects a custom durationMs", async () => {
    const h = await mountWithApi();
    try {
      h.act(() => {
        h.api().toast({ message: "Quick", durationMs: 1000 });
      });
      h.act(() => vi.advanceTimersByTime(999));
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(1);
      h.act(() => vi.advanceTimersByTime(2));
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(0);
    } finally {
      h.unmount();
    }
  });

  it("durationMs=0 produces a sticky toast", async () => {
    const h = await mountWithApi();
    try {
      h.act(() => {
        h.api().toast({ message: "Sticky", durationMs: 0 });
      });
      h.act(() => vi.advanceTimersByTime(60_000));
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(1);
    } finally {
      h.unmount();
    }
  });

  it("queues more than 4 toasts but only renders the first 4", async () => {
    const h = await mountWithApi();
    try {
      h.act(() => {
        const api = h.api();
        for (let i = 0; i < 6; i++) api.toast({ message: `t-${i}` });
      });
      const items = h.container.querySelectorAll("[data-testid='toast-item']");
      expect(items.length).toBe(4);
    } finally {
      h.unmount();
    }
  });

  it("Escape dismisses the newest visible toast", async () => {
    const h = await mountWithApi();
    try {
      h.act(() => {
        h.api().toast({ message: "first", durationMs: 0 });
        h.api().toast({ message: "second", durationMs: 0 });
      });
      const keydown = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      h.act(() => {
        window.dispatchEvent(keydown);
      });
      const items = h.container.querySelectorAll("[data-testid='toast-item']");
      expect(items.length).toBe(1);
      expect(items[0].textContent).toContain("first");
    } finally {
      h.unmount();
    }
  });

  it("error severity uses role='alert'", async () => {
    const h = await mountWithApi();
    try {
      h.act(() => {
        h.api().toast({ message: "Bad things", severity: "error", durationMs: 0 });
      });
      const item = h.container.querySelector("[data-testid='toast-item']")!;
      expect(item.getAttribute("role")).toBe("alert");
      expect(item.getAttribute("data-severity")).toBe("error");
    } finally {
      h.unmount();
    }
  });

  it("success severity uses role='status'", async () => {
    const h = await mountWithApi();
    try {
      h.act(() => {
        h.api().toast({ message: "Saved", severity: "success", durationMs: 0 });
      });
      const item = h.container.querySelector("[data-testid='toast-item']")!;
      expect(item.getAttribute("role")).toBe("status");
    } finally {
      h.unmount();
    }
  });

  it("Retry action invokes callback and dismisses", async () => {
    const h = await mountWithApi();
    try {
      const onRetry = vi.fn();
      h.act(() => {
        h.api().toast({
          message: "Failed",
          severity: "error",
          durationMs: 0,
          action: { label: "Retry", onInvoke: onRetry },
        });
      });
      const btn = Array.from(h.container.querySelectorAll("button")).find(
        (b) => b.textContent === "Retry",
      )!;
      expect(btn).toBeTruthy();
      h.act(() => btn.click());
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(0);
    } finally {
      h.unmount();
    }
  });

  it("dismiss(id) removes a specific toast", async () => {
    const h = await mountWithApi();
    try {
      let id = "";
      h.act(() => {
        id = h.api().toast({ message: "x", durationMs: 0 });
      });
      h.act(() => h.api().dismiss(id));
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(0);
    } finally {
      h.unmount();
    }
  });
});
