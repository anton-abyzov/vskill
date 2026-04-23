// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tells React we're running inside a test harness so act() batching works.
// Must be set before React is imported / rendered.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import {
  resolveTheme,
  readStoredTheme,
  writeStoredTheme,
  applyTheme,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "../theme/theme-utils";

// ------------------------------------------------------------------
// Pure helper tests (no React, no DOM rendering)
// ------------------------------------------------------------------
describe("theme-utils: pure helpers", () => {
  describe("resolveTheme", () => {
    it("returns explicit mode when 'light' or 'dark'", () => {
      expect(resolveTheme("light", true)).toBe("light");
      expect(resolveTheme("light", false)).toBe("light");
      expect(resolveTheme("dark", false)).toBe("dark");
      expect(resolveTheme("dark", true)).toBe("dark");
    });

    it("resolves 'auto' via prefers-color-scheme media match", () => {
      expect(resolveTheme("auto", true)).toBe("dark");
      expect(resolveTheme("auto", false)).toBe("light");
    });
  });

  describe("readStoredTheme", () => {
    it("returns 'auto' when storage is empty", () => {
      const fakeStorage = new Map<string, string>();
      const storage = makeStorage(fakeStorage);
      expect(readStoredTheme(storage)).toBe("auto");
    });

    it("returns stored value when valid", () => {
      const fakeStorage = new Map<string, string>([
        [THEME_STORAGE_KEY, "dark"],
      ]);
      expect(readStoredTheme(makeStorage(fakeStorage))).toBe("dark");
    });

    it("ignores invalid values", () => {
      const fakeStorage = new Map<string, string>([
        [THEME_STORAGE_KEY, "purple"],
      ]);
      expect(readStoredTheme(makeStorage(fakeStorage))).toBe("auto");
    });

    it("swallows thrown storage (private browsing) and returns 'auto'", () => {
      const throwingStorage: Storage = {
        get length() {
          return 0;
        },
        clear: () => {},
        key: () => null,
        getItem: () => {
          throw new Error("private-browsing");
        },
        setItem: () => {},
        removeItem: () => {},
      };
      expect(readStoredTheme(throwingStorage)).toBe("auto");
    });
  });

  describe("writeStoredTheme", () => {
    it("writes value into storage", () => {
      const map = new Map<string, string>();
      const storage = makeStorage(map);
      writeStoredTheme(storage, "dark");
      expect(map.get(THEME_STORAGE_KEY)).toBe("dark");
    });

    it("does not throw when storage throws", () => {
      const throwingStorage: Storage = {
        get length() {
          return 0;
        },
        clear: () => {},
        key: () => null,
        getItem: () => null,
        setItem: () => {
          throw new Error("full");
        },
        removeItem: () => {},
      };
      expect(() => writeStoredTheme(throwingStorage, "dark")).not.toThrow();
    });
  });

  describe("applyTheme", () => {
    it("sets data-theme (resolved) and data-theme-mode (user mode)", () => {
      const el = document.createElement("html");
      applyTheme(el, "auto", "dark");
      expect(el.dataset.theme).toBe("dark");
      expect(el.dataset.themeMode).toBe("auto");

      applyTheme(el, "light", "light");
      expect(el.dataset.theme).toBe("light");
      expect(el.dataset.themeMode).toBe("light");
    });
  });
});

// ------------------------------------------------------------------
// Integration tests — ThemeProvider + useTheme in jsdom
// ------------------------------------------------------------------

type HarnessCtx = {
  mode: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (m: ThemeMode) => void;
};

describe("ThemeProvider + useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-mode");
    setupMatchMedia({ dark: false, contrastMore: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("setTheme('dark') sets data-theme + localStorage; useTheme exposes state", async () => {
    const h = await renderProvider();
    try {
      h.act(() => h.latest.setTheme("dark"));
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
      expect(h.latest.mode).toBe("dark");
      expect(h.latest.resolvedTheme).toBe("dark");
    } finally {
      h.unmount();
    }
  });

  it("setTheme('auto') with dark media match resolves to dark", async () => {
    setupMatchMedia({ dark: true, contrastMore: false });
    const h = await renderProvider();
    try {
      h.act(() => h.latest.setTheme("auto"));
      expect(h.latest.mode).toBe("auto");
      expect(h.latest.resolvedTheme).toBe("dark");
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally {
      h.unmount();
    }
  });

  it("cycles light → dark → auto via setTheme", async () => {
    const h = await renderProvider();
    try {
      h.act(() => h.latest.setTheme("light"));
      expect(document.documentElement.dataset.theme).toBe("light");
      h.act(() => h.latest.setTheme("dark"));
      expect(document.documentElement.dataset.theme).toBe("dark");
      h.act(() => h.latest.setTheme("auto"));
      // dark media = false here (from beforeEach), so auto resolves to light
      expect(h.latest.resolvedTheme).toBe("light");
    } finally {
      h.unmount();
    }
  });

  it("listens to 'storage' events and syncs across tabs", async () => {
    const h = await renderProvider();
    try {
      h.act(() => {
        const event = new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          newValue: "dark",
        });
        window.dispatchEvent(event);
      });
      expect(h.latest.mode).toBe("dark");
      expect(document.documentElement.dataset.theme).toBe("dark");
    } finally {
      h.unmount();
    }
  });
});

// ------------------------------------------------------------------
// test utilities
// ------------------------------------------------------------------
function makeStorage(map: Map<string, string>): Storage {
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (n: number) => Array.from(map.keys())[n] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

function setupMatchMedia(opts: { dark: boolean; contrastMore: boolean }) {
  const listenersByQuery = new Map<
    string,
    Set<(e: MediaQueryListEvent) => void>
  >();
  const impl = (query: string): MediaQueryList => {
    const matches = query.includes("prefers-color-scheme: dark")
      ? opts.dark
      : query.includes("prefers-contrast: more")
        ? opts.contrastMore
        : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: (_t: string, cb: (e: MediaQueryListEvent) => void) => {
        if (!listenersByQuery.has(query))
          listenersByQuery.set(query, new Set());
        listenersByQuery.get(query)!.add(cb);
      },
      removeEventListener: (
        _t: string,
        cb: (e: MediaQueryListEvent) => void,
      ) => {
        listenersByQuery.get(query)?.delete(cb);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
  vi.stubGlobal("matchMedia", impl);
  (window as unknown as { matchMedia: typeof impl }).matchMedia = impl;
}

async function renderProvider(): Promise<{
  latest: HarnessCtx;
  act: (fn: () => void) => void;
  unmount: () => void;
}> {
  // Dynamically import so that the jsdom environment is ready first.
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ThemeProvider } = await import("../theme/ThemeProvider");
  const { useTheme } = await import("../theme/useTheme");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const latestRef: { current: HarnessCtx | null } = { current: null };

  function Probe() {
    const ctx = useTheme();
    latestRef.current = ctx;
    return null;
  }

  act(() => {
    root.render(React.createElement(ThemeProvider, null, React.createElement(Probe)));
  });

  if (!latestRef.current) {
    throw new Error("useTheme probe did not report a value");
  }

  const handle = {
    get latest() {
      return latestRef.current!;
    },
    act: (fn: () => void) => {
      act(() => {
        fn();
      });
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
  return handle;
}
