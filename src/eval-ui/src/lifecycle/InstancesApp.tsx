// 0832 T-012: Window > Studio Instances list view.
//
// Lists every studio instance reported by `list_studio_instances`. Each row
// has Switch + Stop actions. Tauri-spawned rows are disabled and labeled
// "(this app)". Empty state shows the disabled placeholder per AC-US3-05.

import { useCallback, useEffect, useState } from "react";

interface InstanceRow {
  pid: number;
  port: number;
  source: "tauri" | "npx-cli" | "node-direct";
  sourceShort: string;
  startedAt: string;
  isSelf: boolean;
}

interface InvokeFn {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

function getInvoke(): InvokeFn | null {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: InvokeFn } };
  };
  return w.__TAURI__?.core?.invoke ?? null;
}

interface BackendRow {
  pid: number;
  port: number;
  source: string;
  source_short: string;
  started_at: string;
  is_self: boolean;
}

function normalize(rec: BackendRow): InstanceRow {
  return {
    pid: rec.pid,
    port: rec.port,
    source: (rec.source as InstanceRow["source"]) ?? "npx-cli",
    sourceShort: rec.source_short ?? "npx",
    startedAt: rec.started_at ?? "",
    isSelf: !!rec.is_self,
  };
}

export function InstancesApp() {
  const [rows, setRows] = useState<InstanceRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const invoke = getInvoke();
    if (!invoke) {
      setRows([]);
      return;
    }
    try {
      const result = (await invoke("list_studio_instances")) as BackendRow[];
      setRows(result.map(normalize));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("list_studio_instances failed:", e);
      setRows([]);
    }
  }, []);

  // Refresh on mount per AC-US3-04 (within 1s, not on a poll).
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 0832 F-GRILL-02: re-fetch when the window is reopened (Tauri reuses the
  // existing window via show()+set_focus(); React state otherwise persists
  // and the user sees stale rows). The Rust side emits this event from
  // open_studio_instances_window when the window already existed.
  useEffect(() => {
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
    if (!w.__TAURI__?.event) return;
    let unlisten: (() => void) | null = null;
    w.__TAURI__.event
      .listen("studio-instances://refresh", () => {
        refresh();
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* ignore — same-window mount path still refreshes via the other effect */
      });
    return () => {
      if (unlisten) unlisten();
    };
  }, [refresh]);

  const onSwitch = useCallback(
    async (port: number) => {
      if (busy) return;
      setBusy(true);
      const invoke = getInvoke();
      if (invoke) {
        try {
          await invoke("switch_to_studio_instance", { port });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("switch failed:", e);
        }
      }
      setBusy(false);
    },
    [busy],
  );

  const onStop = useCallback(
    async (pid: number) => {
      if (busy) return;
      // Confirmation per AC-US3-03. window.confirm is fine for native shells.
      if (!window.confirm(`Stop studio instance pid ${pid}?`)) return;
      setBusy(true);
      const invoke = getInvoke();
      if (invoke) {
        try {
          await invoke("stop_studio_instance", { pid });
          await refresh();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("stop failed:", e);
        }
      }
      setBusy(false);
    },
    [busy, refresh],
  );

  if (rows === null) {
    return (
      <div className="lifecycle-shell">
        <h1>Studio Instances</h1>
        <div className="lc-detected">Loading…</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="lifecycle-shell">
        <h1>Studio Instances</h1>
        <div className="lc-actions">
          <button type="button" className="lc-btn" disabled aria-disabled>
            <span className="lc-btn-title">No other instances</span>
            <span className="lc-btn-help">
              Skill Studio is the only running instance.
            </span>
          </button>
        </div>
        <div className="lc-footer">
          <button
            type="button"
            className="lc-cancel"
            onClick={refresh}
            disabled={busy}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lifecycle-shell">
      <h1>Studio Instances</h1>
      <div className="lc-actions" role="list">
        {rows.map((row) => (
          <div
            key={`${row.pid}-${row.port}`}
            className="lc-btn"
            role="listitem"
            aria-disabled={row.isSelf}
            style={
              row.isSelf
                ? { opacity: 0.6, cursor: "default" }
                : { cursor: "default" }
            }
          >
            <span className="lc-btn-title">
              port {row.port} · {row.sourceShort} · {row.pid}
              {row.isSelf ? "  (this app)" : ""}
            </span>
            <span
              className="lc-btn-help"
              style={{ display: "flex", gap: 8, marginTop: 4 }}
            >
              <button
                type="button"
                className="lc-cancel"
                disabled={row.isSelf || busy}
                onClick={() => onSwitch(row.port)}
              >
                Switch
              </button>
              <button
                type="button"
                className="lc-cancel"
                disabled={row.isSelf || busy}
                onClick={() => onStop(row.pid)}
              >
                Stop
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="lc-footer">
        <button
          type="button"
          className="lc-cancel"
          onClick={refresh}
          disabled={busy}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
