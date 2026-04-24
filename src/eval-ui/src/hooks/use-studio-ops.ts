// ---------------------------------------------------------------------------
// 0688 T-020: useStudioOps — client-side log subscription.
//
// Mounts:
//   - GET /api/studio/ops?limit=50                  → seeds initial state
//   - EventSource GET /api/studio/ops/stream         → live "op" events
//
// State is kept newest-first. Live events are deduped by `id` (the server
// appends the same id we saw in the initial page if the stream reconnects
// mid-load). `loadMore()` pages backward via `?before=<oldest-ts>`.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { StudioOp } from "../types";

export interface UseStudioOpsReturn {
  ops: StudioOp[];
  loading: boolean;
  loadMore: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  hasMore: boolean;
}

export function useStudioOps(): UseStudioOpsReturn {
  const [ops, setOps] = useState<StudioOp[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const initial = await api.listStudioOps({ limit: 50 });
        if (cancelled) return;
        setOps(initial);
        setHasMore(initial.length === 50);
      } catch {
        if (cancelled) return;
        setOps([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const es = api.studioOpsStream();
    esRef.current = es;
    const onOp = (e: MessageEvent) => {
      try {
        const op = JSON.parse(e.data) as StudioOp;
        setOps((prev) => (prev.some((o) => o.id === op.id) ? prev : [op, ...prev]));
      } catch {
        /* ignore malformed payloads */
      }
    };
    es.addEventListener("op", onOp as EventListener);

    return () => {
      cancelled = true;
      es.removeEventListener("op", onOp as EventListener);
      es.close();
      esRef.current = null;
    };
  }, []);

  const loadMore = useCallback(async () => {
    setOps((prev) => {
      const oldest = prev[prev.length - 1];
      if (!oldest) return prev;
      // Kick the async fetch; we merge results in a followup setter.
      void (async () => {
        const next = await api.listStudioOps({ before: oldest.ts, limit: 50 });
        setOps((cur) => {
          const seen = new Set(cur.map((o) => o.id));
          const merged = [...cur];
          for (const op of next) if (!seen.has(op.id)) merged.push(op);
          return merged;
        });
        setHasMore(next.length === 50);
      })();
      return prev;
    });
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteStudioOp(id);
    setOps((prev) => prev.filter((o) => o.id !== id));
  }, []);

  return { ops, loading, loadMore, remove, hasMore };
}
