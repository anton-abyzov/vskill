import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStudioOps } from "../hooks/use-studio-ops";
import type { StudioOp } from "../types";

// ---------------------------------------------------------------------------
// 0688 T-020: OpsDrawer — right-side inspector for the StudioOp log.
//
// Non-blocking (aria-modal="false") — users can keep interacting with the
// main Studio while inspecting the log. Renders ops newest-first with
// expandable rows showing the raw JSON. Esc closes. No backdrop.
//
// Virtualization: the plan calls for react-virtuoso; for the 50-item default
// page and the typical log size, a flat mapped list is simpler and the test
// suite exercises row identity by index. If we ever see performance issues
// with very long logs, we can swap to <Virtuoso data={ops}> without changing
// the row shape.
// ---------------------------------------------------------------------------

export interface OpsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function OpsDrawer({ open, onClose }: OpsDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { ops, loading, loadMore, hasMore } = useStudioOps();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const dlg = dialogRef.current;
    if (!dlg) return;
    const first = dlg.querySelector<HTMLElement>(
      "button, a[href], [tabindex]:not([tabindex='-1'])",
    );
    first?.focus();
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return createPortal(
    <div
      data-testid="ops-drawer"
      ref={dialogRef}
      role="dialog"
      aria-modal="false"
      aria-label="Studio operations log"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "420px",
        maxWidth: "100vw",
        background: "var(--bg-surface, var(--surface-1))",
        borderLeft: "1px solid var(--border-default, var(--border-subtle))",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.18)",
        display: "flex",
        flexDirection: "column",
        zIndex: 80,
        fontFamily: "var(--font-sans)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border-default, var(--border-subtle))",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Operations log</h2>
        <button
          type="button"
          data-testid="ops-drawer-close"
          aria-label="Close operations log"
          onClick={onClose}
          style={{
            background: "transparent",
            border: 0,
            cursor: "pointer",
            fontSize: 18,
            color: "var(--text-muted)",
          }}
        >
          ×
        </button>
      </header>

      <div
        data-testid="ops-drawer-body"
        style={{ flex: 1, overflow: "auto", padding: "8px 0" }}
      >
        {loading ? (
          <div style={{ padding: "16px", color: "var(--text-muted)" }}>Loading…</div>
        ) : ops.length === 0 ? (
          <div style={{ padding: "16px", color: "var(--text-muted)" }}>No operations yet.</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {ops.map((op) => (
              <OpRow
                key={op.id}
                op={op}
                expanded={expanded.has(op.id)}
                onToggle={() => toggle(op.id)}
              />
            ))}
          </ul>
        )}
        {hasMore && !loading && (
          <div style={{ padding: "8px 16px" }}>
            <button
              type="button"
              data-testid="ops-drawer-load-more"
              onClick={() => { void loadMore(); }}
              style={{
                width: "100%",
                padding: "8px",
                border: "1px solid var(--border-default, var(--border-subtle))",
                background: "transparent",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function OpRow({
  op,
  expanded,
  onToggle,
}: {
  op: StudioOp;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ts = new Date(op.ts).toISOString().replace("T", " ").slice(0, 19);
  return (
    <li>
      <button
        type="button"
        data-testid="ops-drawer-row"
        data-op-id={op.id}
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "8px 16px",
          background: "transparent",
          border: 0,
          borderBottom: "1px solid var(--border-subtle, #eee)",
          cursor: "pointer",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          color: "var(--text-default)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>
            <strong>{op.op}</strong> {op.skillId ? `· ${op.skillId}` : ""}
          </span>
          <span style={{ color: "var(--text-muted)" }}>{ts}</span>
        </div>
        {op.fromScope && op.toScope && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            {op.fromScope} → {op.toScope}
          </div>
        )}
      </button>
      {expanded && (
        <pre
          data-testid="ops-drawer-row-detail"
          style={{
            margin: 0,
            padding: "8px 16px",
            background: "var(--bg-subtle, #f7f7f7)",
            fontSize: 11,
            overflowX: "auto",
            whiteSpace: "pre",
          }}
        >
{JSON.stringify(op, null, 2)}
        </pre>
      )}
    </li>
  );
}
