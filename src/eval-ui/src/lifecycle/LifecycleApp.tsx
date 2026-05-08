// 0832 lifecycle modal React app — three primary actions for the user when
// a running studio instance is detected at desktop boot. IPC handlers in
// commands.rs do the heavy lifting (kill / navigate / spawn).

import { useCallback, useEffect, useRef, useState } from "react";

interface ProcessRecord {
  pid: number;
  port: number;
  startedAt: string;
  source: "tauri" | "npx-cli" | "node-direct";
  cmdline: string;
}

type LifecycleDefault = "ask" | "use-existing" | "stop-and-replace" | "run-alongside";

interface InvokeFn {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

function getInvoke(): InvokeFn | null {
  // Tauri 2 exposes invoke at window.__TAURI__.core.invoke. In dev/browser
  // mode (vite preview without Tauri) this is undefined — we render the UI
  // but every action no-ops with a console warning.
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: InvokeFn } };
  };
  return w.__TAURI__?.core?.invoke ?? null;
}

function relativeTime(iso: string): string {
  if (!iso) return "just now";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "just now";
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function sourceLabel(s: ProcessRecord["source"]): string {
  if (s === "tauri") return "this app";
  if (s === "npx-cli") return "npx";
  return "node";
}

export function LifecycleApp() {
  const [detected, setDetected] = useState<ProcessRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  // On mount: ask Rust for the cached ProcessRecord. Fallback: subscribe to
  // the lifecycle://detected event in case the Rust-side seed wasn't set
  // before this window booted (race).
  useEffect(() => {
    const invoke = getInvoke();
    if (invoke) {
      invoke("get_detected_instance")
        .then((rec) => {
          if (rec) setDetected(rec as ProcessRecord);
        })
        .catch(() => {
          /* swallow — empty state shows nothing */
        });
    }

    let unlisten: (() => void) | null = null;
    const w = window as unknown as {
      __TAURI__?: {
        event?: {
          listen: (
            channel: string,
            handler: (e: { payload: unknown }) => void,
          ) => Promise<() => void>;
        };
      };
    };
    if (w.__TAURI__?.event) {
      w.__TAURI__.event
        .listen("lifecycle://detected", (e: { payload: unknown }) => {
          if (e.payload) setDetected(e.payload as ProcessRecord);
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {
          /* ignore */
        });
    }
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Default focus on the primary "Use that instance" button per AC-US2-02.
  useEffect(() => {
    if (detected) primaryRef.current?.focus();
  }, [detected]);

  const persistDefaultIfChecked = useCallback(
    async (choice: Exclude<LifecycleDefault, "ask">) => {
      if (!dontAsk) return;
      const invoke = getInvoke();
      if (!invoke) return;
      try {
        await invoke("set_setting", {
          key: "studio.lifecycleDefault",
          value: choice,
        });
      } catch (e) {
        // Non-fatal — user can re-pick next time.
        // eslint-disable-next-line no-console
        console.warn("could not persist lifecycleDefault:", e);
      }
    },
    [dontAsk],
  );

  const onUseExisting = useCallback(async () => {
    if (!detected || busy) return;
    setBusy(true);
    await persistDefaultIfChecked("use-existing");
    const invoke = getInvoke();
    if (invoke) {
      try {
        await invoke("lifecycle_use_existing", { port: detected.port });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("lifecycle_use_existing failed:", e);
        setBusy(false);
      }
    }
  }, [busy, detected, persistDefaultIfChecked]);

  const onStopExisting = useCallback(async () => {
    if (!detected || busy) return;
    setBusy(true);
    await persistDefaultIfChecked("stop-and-replace");
    const invoke = getInvoke();
    if (invoke) {
      try {
        await invoke("lifecycle_stop_existing", { pid: detected.pid });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("lifecycle_stop_existing failed:", e);
        setBusy(false);
      }
    }
  }, [busy, detected, persistDefaultIfChecked]);

  const onRunAlongside = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    await persistDefaultIfChecked("run-alongside");
    const invoke = getInvoke();
    if (invoke) {
      try {
        await invoke("lifecycle_run_alongside");
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("lifecycle_run_alongside failed:", e);
        setBusy(false);
      }
    }
  }, [busy, persistDefaultIfChecked]);

  const onCancel = useCallback(() => {
    const invoke = getInvoke();
    if (invoke) {
      // Cancel = exit the desktop app cleanly per AC-US2-03.
      invoke("quit").catch(() => {
        /* ignore */
      });
    }
  }, []);

  if (!detected) {
    return (
      <div className="lifecycle-shell">
        <h1>Skill Studio is already running</h1>
        <div className="lc-detected">Detecting running instances…</div>
        <div className="lc-actions" />
        <div className="lc-footer">
          <button type="button" className="lc-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const label = `port ${detected.port} · ${sourceLabel(detected.source)} · started ${relativeTime(detected.startedAt)}`;

  return (
    <div className="lifecycle-shell">
      <h1>Skill Studio is already running</h1>
      <div className="lc-detected" aria-live="polite">{label}</div>
      <div className="lc-actions">
        <button
          ref={primaryRef}
          type="button"
          className="lc-btn lc-btn--primary"
          onClick={onUseExisting}
          disabled={busy}
        >
          <span className="lc-btn-title">Use that instance</span>
          <span className="lc-btn-help">
            Open the running studio at port {detected.port}.
          </span>
        </button>
        <button
          type="button"
          className="lc-btn"
          onClick={onStopExisting}
          disabled={busy}
        >
          <span className="lc-btn-title">Stop it and use desktop app</span>
          <span className="lc-btn-help">
            SIGTERM (3s grace) → SIGKILL, then start a fresh sidecar.
          </span>
        </button>
        <button
          type="button"
          className="lc-btn"
          onClick={onRunAlongside}
          disabled={busy}
        >
          <span className="lc-btn-title">Run alongside</span>
          <span className="lc-btn-help">
            Spawn this app on a separate port; both instances coexist.
          </span>
        </button>
      </div>
      <div className="lc-footer">
        <label className="lc-checkbox">
          <input
            type="checkbox"
            checked={dontAsk}
            onChange={(e) => setDontAsk(e.target.checked)}
          />
          Don't ask again — always do this
        </label>
        <button type="button" className="lc-cancel" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
