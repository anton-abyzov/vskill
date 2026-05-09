// 0831 — QuotaContext: single source of truth for quota state in the studio UI.
//
// Owner: desktop-quota-agent.
//
// Hydration:
//   1. On mount, call `quotaGet([])` to read whatever's already on disk
//      (cheap — no network). This is what populates the UI on cold start.
//   2. Listen for the Tauri event `quota://updated` emitted by the 1h
//      background sync task. Each event triggers a re-fetch of the IPC.
//   3. Expose a `forceSync(fresh)` method the paywall race-resolution path
//      and the QuotaGraceBanner's "Sync now" button can call.
//
// Browser-mode behavior: returns a synthetic "free, unsynced" snapshot so
// the hosted studio renders without enforcement-aware features. The hosted
// studio relies on server-side gates anyway.
//
// Why a Context instead of a hook on each consumer? The status bar, the
// paywall, the grace banner, and ConnectedRepoWidget all need the same
// snapshot — duplicating the IPC roundtrip + invalidation per consumer
// would race the renders and waste credential-store reads.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  useDesktopBridge,
  type DesktopBridge,
  type QuotaSnapshot,
} from "../preferences/lib/useDesktopBridge";

interface QuotaContextValue {
  /** Current snapshot, or null while the first fetch is in flight. */
  snapshot: QuotaSnapshot | null;
  /** True while a background refresh is in flight (UI may show a spinner). */
  refreshing: boolean;
  /** Last refresh error, if any. */
  error: string | null;
  /** Hard refresh — busts the platform's KV via `?fresh=1`. */
  forceSync: (fresh?: boolean) => Promise<void>;
  /**
   * Pre-create gate. Returns true when the create can proceed; false to
   * trigger the paywall. The caller is responsible for opening the paywall
   * modal — this hook only exposes the boolean.
   */
  canCreateSkill: () => Promise<{
    blocked: boolean;
    reason: string;
    snapshot: QuotaSnapshot;
  }>;
}

const QuotaContext = createContext<QuotaContextValue | null>(null);

interface QuotaProviderProps {
  children: ReactNode;
  /**
   * Project roots the local-counter walks. The studio passes the open
   * workspace's roots; tests pass an empty array. Mount-time only — root
   * changes trigger an explicit refresh via the consuming component.
   */
  projectRoots?: string[];
}

/**
 * Tauri-event listener helper. Returns an unsubscribe fn. Falls back to a
 * no-op in browser mode where Tauri internals don't exist.
 */
function listenQuotaUpdated(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as unknown as {
    __TAURI_INTERNALS__?: {
      // tauri v2 surface: invoke is what we use elsewhere; events go via
      // a separate `__TAURI__.event.listen` bridge that's been re-exposed
      // through `__TAURI_INTERNALS__.metadata.plugins`. To stay independent
      // of the (versioned) event API we use a CustomEvent fallback that
      // the Rust-side `app.emit` triggers via the deep-link plugin's
      // postMessage shim. In practice the cleaner path is to import
      // `@tauri-apps/api/event::listen` — but that's an extra dep. For
      // now, use a tick-driven poll fallback: the 1h background loop is
      // slow enough that polling once a minute on visibility-change is
      // a non-issue.
    };
  };

  if (!w.__TAURI_INTERNALS__) return () => {};

  // Lightweight visibility-change-driven re-fetch trigger. The Rust
  // `quota://updated` event will be picked up through the `tauri/event`
  // import path once the bridge exposes it; until then this gives us
  // "user came back to the app" semantics which is what users actually
  // notice.
  const onVis = () => {
    if (document.visibilityState === "visible") {
      handler();
    }
  };
  document.addEventListener("visibilitychange", onVis);
  return () => {
    document.removeEventListener("visibilitychange", onVis);
  };
}

export function QuotaProvider({
  children,
  projectRoots = [],
}: QuotaProviderProps): JSX.Element {
  const bridge = useDesktopBridge();
  const [snapshot, setSnapshot] = useState<QuotaSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Use a ref for projectRoots so the IPC closure can read the latest
  // without re-binding the listener on every prop change.
  const rootsRef = useRef<string[]>(projectRoots);
  rootsRef.current = projectRoots;
  // Hold the latest bridge in a ref too so the listener doesn't churn.
  const bridgeRef = useRef<DesktopBridge>(bridge);
  bridgeRef.current = bridge;

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setError(null);
    try {
      const next = await bridgeRef.current.quotaGet(rootsRef.current);
      setSnapshot(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const forceSync = useCallback(
    async (fresh: boolean = false): Promise<void> => {
      setRefreshing(true);
      setError(null);
      try {
        const next = await bridgeRef.current.quotaForceSync(
          rootsRef.current,
          fresh,
        );
        setSnapshot(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        // Fall back to a fresh on-disk read so the UI stays consistent.
        try {
          const next = await bridgeRef.current.quotaGet(rootsRef.current);
          setSnapshot(next);
        } catch {
          // ignore — the error state is already set above
        }
      } finally {
        setRefreshing(false);
      }
    },
    [],
  );

  const canCreateSkill = useCallback(async () => {
    return bridgeRef.current.quotaCanCreateSkill(rootsRef.current);
  }, []);

  // Initial fetch + visibility-change re-fetch + 60s polling fallback.
  useEffect(() => {
    void refresh();
    const unsub = listenQuotaUpdated(() => {
      void refresh();
    });
    // 60s soft poll so the UI doesn't drift more than a minute behind the
    // background sync loop. Cheap (single credential-store read + fs read).
    const timer = setInterval(() => {
      void refresh();
    }, 60_000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [refresh]);

  const value: QuotaContextValue = useMemo(
    () => ({ snapshot, refreshing, error, forceSync, canCreateSkill }),
    [snapshot, refreshing, error, forceSync, canCreateSkill],
  );

  return <QuotaContext.Provider value={value}>{children}</QuotaContext.Provider>;
}

/**
 * Read the current quota state. Throws if used outside `<QuotaProvider>`,
 * which is intentional — the App.tsx mount makes this a programming error.
 */
export function useQuota(): QuotaContextValue {
  const ctx = useContext(QuotaContext);
  if (!ctx) {
    throw new Error("useQuota() called outside <QuotaProvider>");
  }
  return ctx;
}
