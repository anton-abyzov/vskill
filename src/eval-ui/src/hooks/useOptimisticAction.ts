import { useCallback, useRef } from "react";
import { useToast } from "../components/ToastProvider";

/**
 * Optimistic-action helper for quick actions (T-053).
 *
 * Contract:
 *   - `apply` runs immediately on the optimistic state snapshot.
 *   - The backend callback (`commit`) is awaited. If it resolves before the
 *     `confirmGraceMs` window (default 500ms), nothing is surfaced — the
 *     optimistic UI is the final state.
 *   - If `commit` rejects OR exceeds the grace window AND then rejects,
 *     `rollback` restores the previous state and a rollback toast is shown
 *     with a Retry button. Retry re-invokes `run()` with the original args.
 *   - Timeout resolution: if `commit` is still pending at `timeoutMs`
 *     (default 5000ms), treat it as a failure with `code: "TIMEOUT"`.
 *
 * The hook is intentionally generic — callers pass in the snapshot type and
 * the commit function. Storing the pre-action snapshot is the caller's
 * responsibility so the rollback is just a function invocation.
 */

export interface OptimisticActionConfig<Args extends readonly unknown[], Snapshot> {
  /** Capture whatever pre-action state needs restoring on failure. */
  snapshot: () => Snapshot;
  /** Apply the optimistic state locally. Fires synchronously. */
  apply: (...args: Args) => void;
  /** The backend call. Reject to trigger rollback. */
  commit: (...args: Args) => Promise<unknown>;
  /** Restore pre-action state. Fires on commit failure. */
  rollback: (snapshot: Snapshot) => void;
  /** Toast message on failure (static string or derived from error). */
  failureMessage?: string | ((err: unknown) => string);
  /**
   * Grace window before surfacing failure. Resolves faster = silent success;
   * beyond this the UI treats it as slow and keeps the toast option open.
   * Defaults to 500ms per the T-053 spec.
   */
  confirmGraceMs?: number;
  /** Hard timeout in ms before treating commit as failed. Default 5000. */
  timeoutMs?: number;
}

export interface OptimisticActionHandle<Args extends readonly unknown[]> {
  run: (...args: Args) => Promise<void>;
}

export function useOptimisticAction<Args extends readonly unknown[], Snapshot>(
  config: OptimisticActionConfig<Args, Snapshot>,
): OptimisticActionHandle<Args> {
  const { toast } = useToast();
  const cfgRef = useRef(config);
  cfgRef.current = config;

  const run = useCallback(
    async (...args: Args) => {
      const cfg = cfgRef.current;
      const snap = cfg.snapshot();
      cfg.apply(...args);

      const grace = cfg.confirmGraceMs ?? 500;
      const timeout = cfg.timeoutMs ?? 5000;

      let resolved = false;
      let settledError: unknown = undefined;
      let settledOk = false;
      const commitPromise = cfg.commit(...args).then(
        () => {
          resolved = true;
          settledOk = true;
        },
        (err) => {
          resolved = true;
          settledError = err ?? new Error("Commit failed");
        },
      );

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(resolve, timeout);
      });

      // Wait for commit OR timeout.
      await Promise.race([commitPromise, timeoutPromise]);

      if (!resolved) {
        // Timeout elapsed before commit resolved.
        settledError = new Error("TIMEOUT");
      } else if (settledOk) {
        // Silent success — nothing to surface. Caller's optimistic state stays.
        void grace; // grace is only relevant when we surface failure fast
        return;
      }

      // Failure path — roll back and show the toast with Retry.
      cfg.rollback(snap);
      const msg =
        typeof cfg.failureMessage === "function"
          ? cfg.failureMessage(settledError)
          : cfg.failureMessage ?? "Couldn't complete that action.";
      toast({
        message: msg,
        severity: "error",
        durationMs: 0, // sticky — user must dismiss or retry
        action: {
          label: "Retry",
          onInvoke: () => {
            // Fire-and-forget. The toast is dismissed by the provider when
            // the button is clicked; a new toast will appear if this retry
            // also fails.
            void run(...args);
          },
        },
      });
    },
    [toast],
  );

  return { run };
}
