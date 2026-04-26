// ---------------------------------------------------------------------------
// 0700 phase 2C: InstallProgressToast
//
// Subscribes to the POST /api/plugins/install/stream SSE endpoint and shows
// live stdout while the `claude plugin install` subprocess runs. Collapses
// to a single status line when idle; expands to show the last ~12 lines of
// output on hover/focus for debuggability.
//
// Because EventSource is GET-only, we implement our own POST-SSE via fetch's
// streaming response (reader.read() + TextDecoder).
// ---------------------------------------------------------------------------

import * as React from "react";
import { mutate as swrMutate } from "../hooks/useSWR";
import { triggerPluginsRefresh } from "../hooks/usePluginsPolling";

export interface InstallJob {
  plugin: string;
  marketplace: string;
  /** Full spec used for the subprocess: `<plugin>@<marketplace>`. */
  ref: string;
}

export interface InstallProgressToastProps {
  /** Current in-flight job — null hides the toast. */
  job: InstallJob | null;
  /** Called when the install finishes (success or failure) so parent can clear `job`. */
  onDone: (result: { ok: boolean; code: number | null; lines: string[] }) => void;
}

interface StreamEvent {
  type: "start" | "stdout" | "stderr" | "done" | "error";
  line?: string;
  ok?: boolean;
  code?: number | null;
  plugin?: string;
  scope?: string;
  error?: string;
}

const MAX_LINES = 12;

export function InstallProgressToast({
  job,
  onDone,
}: InstallProgressToastProps): React.ReactElement | null {
  const [lines, setLines] = React.useState<string[]>([]);
  const [status, setStatus] = React.useState<"running" | "ok" | "failed">("running");
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    if (!job) return;
    setLines([]);
    setStatus("running");
    setExpanded(false);

    const abort = new AbortController();
    let bufferedLines: string[] = [];
    let finalStatus: "running" | "ok" | "failed" = "running";

    (async () => {
      try {
        const res = await fetch("/api/plugins/install/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ plugin: job.ref }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) {
          setStatus("failed");
          onDone({ ok: false, code: res.status, lines: [`HTTP ${res.status}`] });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // SSE frames are separated by a blank line
          const frames = buf.split(/\n\n/);
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const m = frame.match(/^data:\s*(.*)$/m);
            if (!m) continue;
            try {
              const ev = JSON.parse(m[1]) as StreamEvent;
              if (ev.type === "stdout" && ev.line) {
                bufferedLines = [...bufferedLines, ev.line].slice(-MAX_LINES);
                setLines(bufferedLines);
              } else if (ev.type === "stderr" && ev.line) {
                bufferedLines = [...bufferedLines, `⚠ ${ev.line}`].slice(-MAX_LINES);
                setLines(bufferedLines);
              } else if (ev.type === "done") {
                finalStatus = ev.ok ? "ok" : "failed";
                setStatus(finalStatus);
                // Refresh both caches — sidebar + plugin list
                triggerPluginsRefresh();
                swrMutate("skills");
                onDone({ ok: ev.ok ?? false, code: ev.code ?? null, lines: bufferedLines });
              } else if (ev.type === "error" && ev.error) {
                bufferedLines = [...bufferedLines, `✘ ${ev.error}`].slice(-MAX_LINES);
                setLines(bufferedLines);
              }
            } catch {
              /* malformed frame — skip */
            }
          }
        }
        // If we reached end-of-stream without a done event, mark best-effort ok.
        if (finalStatus === "running") {
          onDone({ ok: true, code: 0, lines: bufferedLines });
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setStatus("failed");
        onDone({
          ok: false,
          code: null,
          lines: [...bufferedLines, err instanceof Error ? err.message : String(err)],
        });
      }
    })();

    return () => abort.abort();
    // Intentionally depend only on `job.ref` — a new job restarts the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.ref]);

  if (!job) return null;

  const statusColor =
    status === "ok"
      ? "var(--color-installed, #2F6A4A)"
      : status === "failed"
        ? "var(--color-error, #b91c1c)"
        : "var(--color-accent, #2f6f8f)";
  const statusGlyph = status === "ok" ? "✔" : status === "failed" ? "✘" : "…";
  const statusLabel =
    status === "ok" ? "Installed" : status === "failed" ? "Install failed" : "Installing";

  return (
    <div
      role="status"
      aria-live="polite"
      data-vskill-install-toast
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        width: "min(420px, 92vw)",
        background: "var(--color-paper, #fff)",
        border: "1px solid var(--border-default, rgba(0,0,0,0.12))",
        borderLeft: `3px solid ${statusColor}`,
        borderRadius: 6,
        boxShadow: "0 10px 20px -6px rgba(0,0,0,0.18)",
        zIndex: 90,
        fontFamily: "var(--font-sans)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "10px 12px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <span aria-hidden style={{ fontSize: 16, color: statusColor, width: 16, textAlign: "center" }}>
          {status === "running" ? <Spinner /> : statusGlyph}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
            {statusLabel}: {job.plugin}
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-tertiary)",
                marginLeft: 4,
              }}
            >
              @{job.marketplace}
            </span>
          </span>
          {!expanded && lines.length > 0 && (
            <span
              style={{
                display: "block",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-tertiary)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {lines[lines.length - 1]}
            </span>
          )}
        </span>
        <span
          aria-hidden
          style={{ fontSize: 10, color: "var(--text-tertiary)" }}
        >
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: "0 12px 12px",
            maxHeight: 180,
            overflowY: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {lines.length === 0 ? "Waiting for output…" : lines.join("\n")}
        </pre>
      )}
    </div>
  );
}

function Spinner(): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        border: "2px solid var(--color-accent, #2f6f8f)",
        borderTopColor: "transparent",
        animation: "vskill-spin 800ms linear infinite",
      }}
    >
      <style>{`@keyframes vskill-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
