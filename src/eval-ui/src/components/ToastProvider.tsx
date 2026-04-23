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
import { ToastStack, type ToastRecord, type ToastSeverity } from "./Toast";

/**
 * Toast queue + lifecycle manager (T-052).
 *
 * Contract:
 *   - Up to `maxVisible` toasts rendered simultaneously (bottom-right stack,
 *     newest on bottom, oldest above). When the queue exceeds the cap the
 *     extras wait and shift in as others dismiss.
 *   - Auto-dismiss after `durationMs` (default 4000ms). Pass `durationMs: 0`
 *     for sticky toasts (e.g., rollback prompts until user acts).
 *   - `Escape` dismisses the newest visible toast.
 *   - Screen readers receive the announcement via `<AriaLive>` — polite by
 *     default, assertive for severity="error".
 *   - `prefers-reduced-motion` is respected by globals.css (0ms durations);
 *     the provider makes no motion decisions itself.
 */

export interface ToastInput {
  message: string;
  severity?: ToastSeverity;
  durationMs?: number;
  action?: ToastRecord["action"];
  id?: string;
}

export interface ToastContextValue {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>.");
  }
  return ctx;
}

export interface ToastProviderProps {
  children?: ReactNode;
  /** Max simultaneously-visible toasts. Defaults to 4 per the spec. */
  maxVisible?: number;
  /** Default auto-dismiss (ms). Defaults to 4000ms. */
  defaultDurationMs?: number;
}

export function ToastProvider({
  children,
  maxVisible = 4,
  defaultDurationMs = 4000,
}: ToastProviderProps) {
  const [queue, setQueue] = useState<ToastRecord[]>([]);
  const [politeMsg, setPoliteMsg] = useState<string>("");
  const [assertiveMsg, setAssertiveMsg] = useState<string>("");
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setQueue((q) => q.filter((t) => t.id !== id));
  }, []);

  const scheduleAutoDismiss = useCallback(
    (id: string, durationMs: number) => {
      if (durationMs <= 0) return;
      const timer = setTimeout(() => {
        dismiss(id);
      }, durationMs);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  const toast = useCallback(
    (input: ToastInput) => {
      const id = input.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const record: ToastRecord = {
        id,
        message: input.message,
        severity: input.severity ?? "info",
        durationMs: input.durationMs ?? defaultDurationMs,
        action: input.action,
      };
      setQueue((q) => [...q, record]);
      // Announce to the matching live region.
      if (record.severity === "error") setAssertiveMsg(record.message);
      else setPoliteMsg(record.message);
      scheduleAutoDismiss(id, record.durationMs!);
      return id;
    },
    [defaultDurationMs, scheduleAutoDismiss],
  );

  const clear = useCallback(() => {
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
    setQueue([]);
  }, []);

  // Escape dismisses the newest visible toast.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setQueue((q) => {
        if (q.length === 0) return q;
        const visible = q.slice(0, maxVisible);
        const newest = visible[visible.length - 1];
        const timer = timersRef.current.get(newest.id);
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(newest.id);
        }
        return q.filter((t) => t.id !== newest.id);
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maxVisible]);

  // Cleanup timers on unmount.
  useEffect(() => {
    return () => {
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
    };
  }, []);

  const visible = queue.slice(0, maxVisible);

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss, clear }),
    [toast, dismiss, clear],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack
        toasts={visible}
        onDismiss={dismiss}
        liveMessage={politeMsg}
        liveAssertiveMessage={assertiveMsg}
      />
    </ToastContext.Provider>
  );
}
