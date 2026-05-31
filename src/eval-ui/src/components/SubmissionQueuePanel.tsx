// ---------------------------------------------------------------------------
// 0856 — SubmissionQueuePanel.
//
// In-app, SSE-driven view of the signed-in user's own submission queue. No
// website redirect, no manual refresh: it loads the user's feed once via
// GET /api/v1/submissions?mine=1, then subscribes to the per-user submission
// event stream (/api/v1/submissions/stream?mine=1 — server-scoped to the
// caller). The client-side own-id filter in applyEvent is RETAINED as
// defense-in-depth in case any shared frame slips through.
//
// Columns mirror the website QueuePageClient: Skill · State · Position ·
// Updated. Rows update live as `state_changed` events arrive. On a terminal
// transition (approved / rejected) a native macOS notification fires via the
// Tauri notification plugin (no-op in the browser).
//
// SSE transport: openFetchEventStream (fetch-based) — it rides the patched
// globalThis.fetch so the X-Studio-Token gate is satisfied automatically
// (EventSource cannot set headers). Cloudflare Workers idle out at ~30s; the
// platform stream emits a 25s keepalive, and we add reconnect-with-backoff on
// top so a dropped connection self-heals.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SubmissionRow } from "../api";
import { openFetchEventStream, type FetchEventStreamHandle } from "../api/sse";
import {
  notifySubmissionOutcome,
  APPROVED_STATES,
  REJECTED_STATES,
} from "../hooks/useSubmissionNotifications";

// Server-scoped per-user stream: `?mine=1` makes the platform emit only the
// caller's own submission events (requires auth). We KEEP the client-side
// own-id filter in applyEvent as defense-in-depth (and to ignore any shared
// frames that slip through a stale/unauthed connection).
const STREAM_URL = "/api/v1/submissions/stream?mine=1";

/** Terminal states — once a row hits one of these, notify + stop tracking it. */
const TERMINAL_STATES = new Set<string>([...APPROVED_STATES, ...REJECTED_STATES]);

/** Shape of the SSE `data:` payload emitted by the platform event bus. */
interface SubmissionStreamEvent {
  submissionId: string;
  skillName: string;
  state: string;
  score?: number | null;
  message?: string;
  timestamp: string;
}

function isStreamEvent(v: unknown): v is SubmissionStreamEvent {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as Record<string, unknown>).submissionId === "string" &&
    typeof (v as Record<string, unknown>).state === "string"
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stateColor(state: string): string {
  if (APPROVED_STATES.has(state)) return "#22C55E";
  if (REJECTED_STATES.has(state)) return "#EF4444";
  return "#F59E0B"; // in-flight
}

export interface SubmissionQueuePanelProps {
  /** Test seam: override the SSE opener (defaults to openFetchEventStream). */
  openStream?: typeof openFetchEventStream;
  /** Test seam: override the terminal-state notifier. */
  notify?: typeof notifySubmissionOutcome;
}

export function SubmissionQueuePanel({
  openStream = openFetchEventStream,
  notify = notifySubmissionOutcome,
}: SubmissionQueuePanelProps = {}): React.ReactElement {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // The set of submission ids that belong to this user — the client-side
  // filter for the global stream. Held in a ref so the long-lived SSE handler
  // reads the current set without re-subscribing on every row change.
  const ownIdsRef = useRef<Set<string>>(new Set());
  // Ids that have already fired a terminal notification — dedupe guard so a
  // re-emitted terminal event doesn't double-notify.
  const notifiedRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.getMyQueue();
      if (!mountedRef.current) return;
      const list = res.submissions ?? [];
      setRows(list);
      setPositions(res.queuePositions ?? {});
      ownIdsRef.current = new Set(list.map((r) => r.id));
      // Seed the dedupe guard with rows already terminal at load time so we
      // don't notify for outcomes that happened before the panel opened.
      for (const r of list) {
        if (TERMINAL_STATES.has(r.state)) notifiedRef.current.add(r.id);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // ── Apply one stream event to local state (client-filtered to own ids) ────
  const applyEvent = useCallback(
    (evt: SubmissionStreamEvent) => {
      if (!ownIdsRef.current.has(evt.submissionId)) return; // not ours — ignore
      setRows((prev) => {
        let found = false;
        const next = prev.map((r) => {
          if (r.id !== evt.submissionId) return r;
          found = true;
          return {
            ...r,
            state: evt.state,
            skillName: evt.skillName || r.skillName,
            updatedAt: evt.timestamp || r.updatedAt,
          };
        });
        if (!found) return prev;
        return next;
      });
      // Once terminal, drop the live queue position (no longer queued).
      if (TERMINAL_STATES.has(evt.state)) {
        setPositions((prev) => {
          if (!(evt.submissionId in prev)) return prev;
          const copy = { ...prev };
          delete copy[evt.submissionId];
          return copy;
        });
        if (!notifiedRef.current.has(evt.submissionId)) {
          notifiedRef.current.add(evt.submissionId);
          void notify(evt.submissionId, evt.skillName, evt.state);
        }
      }
    },
    [notify],
  );

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    void loadFeed();
    return () => {
      mountedRef.current = false;
    };
  }, [loadFeed]);

  // ── SSE subscription with reconnect/backoff ───────────────────────────────
  useEffect(() => {
    let handle: FetchEventStreamHandle | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      handle = openStream(STREAM_URL, {
        // Cloudflare idles connections at ~30s; the platform sends a 25s
        // keepalive. Give the fetch reader a generous safety window past that
        // so a healthy stream is never torn down by the client timer.
        timeoutMs: 600_000,
        onEvent: (frame) => {
          if (stopped) return;
          setConnected(true);
          attempt = 0; // healthy frame → reset backoff
          // Comments/keepalives surface as empty/non-JSON data — skip them.
          if (!frame.data || frame.data === "connected" || frame.data === "keepalive") {
            return;
          }
          let payload: unknown;
          try {
            payload = JSON.parse(frame.data);
          } catch {
            return;
          }
          if (isStreamEvent(payload)) applyEvent(payload);
        },
        onError: () => {
          if (stopped) return;
          setConnected(false);
          scheduleReconnect();
        },
        // A CLEAN upstream close (CF isolate recycle/deploy/idle-evict) ends the
        // stream with no error. Without this the panel would show a false "Live"
        // forever. Treat it exactly like onError: drop the indicator and
        // reconnect with backoff. `stopped` guards the unmount/explicit-close
        // path so a deliberate teardown never schedules a reconnect.
        onClose: () => {
          if (stopped) return;
          setConnected(false);
          scheduleReconnect();
        },
      });
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer != null) return;
      // Exponential backoff capped at 30s: 1s, 2s, 4s, 8s, 16s, 30s, 30s…
      const backoff = Math.min(1000 * 2 ** attempt, 30_000);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (stopped) return;
        try {
          handle?.close();
        } catch {
          /* noop */
        }
        connect();
      }, backoff);
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
      try {
        handle?.close();
      } catch {
        /* noop */
      }
    };
    // applyEvent / openStream are stable (useCallback / props); the stream
    // lives for the panel's lifetime and reads own-ids via the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section data-testid="submission-queue-panel" aria-label="My submission queue" style={{ fontFamily: "var(--font-mono, monospace)" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <strong style={{ fontSize: 13, letterSpacing: "-0.01em" }}>My submissions</strong>
        <span
          data-testid="queue-stream-status"
          title={connected ? "Live" : "Reconnecting…"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: connected ? "#22C55E" : "#9CA3AF",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: connected ? "#22C55E" : "#9CA3AF",
              display: "inline-block",
            }}
          />
          {connected ? "Live" : "Offline"}
        </span>
      </header>

      {loading && (
        <div data-testid="queue-loading" style={{ fontSize: 12, color: "#9CA3AF", padding: "8px 0" }}>
          Loading your submissions…
        </div>
      )}

      {loadError && !loading && (
        <div role="alert" data-testid="queue-error" style={{ fontSize: 12, color: "#EF4444", padding: "8px 0" }}>
          Couldn’t load your submissions: {loadError}{" "}
          <button
            type="button"
            onClick={() => void loadFeed()}
            style={{ background: "none", border: "none", color: "var(--color-accent, #2563EB)", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !loadError && rows.length === 0 && (
        <div data-testid="queue-empty" style={{ fontSize: 12, color: "#9CA3AF", padding: "8px 0" }}>
          No submissions yet. Publish a skill to add it to the queue.
        </div>
      )}

      {rows.length > 0 && (
        <table data-testid="queue-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#9CA3AF", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Skill</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>State</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Position</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pos = positions[r.id];
              const terminal = TERMINAL_STATES.has(r.state);
              return (
                <tr
                  key={r.id}
                  data-testid={`queue-row-${r.id}`}
                  data-state={r.state}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{r.skillName}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <span data-testid={`queue-state-${r.id}`} style={{ color: stateColor(r.state) }}>
                      {r.state}
                    </span>
                  </td>
                  <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }} data-testid={`queue-position-${r.id}`}>
                    {terminal || pos == null ? "—" : `#${pos}`}
                  </td>
                  <td style={{ padding: "6px 8px", color: "#9CA3AF", fontVariantNumeric: "tabular-nums" }}>
                    {fmtTime(r.updatedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
