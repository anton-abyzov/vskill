import { useState, useMemo, useRef, useCallback } from "react";
import { parseUnifiedDiff } from "../utils/parseUnifiedDiff";

interface ChangelogViewerProps {
  contentDiff: string;
  fromLabel: string;
  toLabel: string;
  diffSummary?: string;
  maxHeight?: number;
  collapsible?: boolean;
  renderContext?: "modal" | "inline";
  onRetry?: () => void;
}

export function ChangelogViewer({
  contentDiff,
  fromLabel,
  toLabel,
  diffSummary,
  maxHeight = 480,
  collapsible = false,
  renderContext = "inline",
  onRetry,
}: ChangelogViewerProps) {
  const [collapsed, setCollapsed] = useState(collapsible);
  const [viewMode, setViewMode] = useState<"unified" | "side-by-side">("unified");
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => parseUnifiedDiff(contentDiff), [contentDiff]);

  const stats = useMemo(() => {
    const added = lines.filter((l) => l.type === "add").length;
    const removed = lines.filter((l) => l.type === "remove").length;
    return { added, removed };
  }, [lines]);

  const numberedLines = useMemo(() => {
    let origLine = 0;
    let newLine = 0;
    return lines
      .filter((l) => l.type !== "header")
      .map((line) => {
        if (line.type === "remove") {
          origLine++;
          return { ...line, origNum: origLine, newNum: null as number | null };
        } else if (line.type === "add") {
          newLine++;
          return { ...line, origNum: null as number | null, newNum: newLine };
        } else {
          origLine++;
          newLine++;
          return { ...line, origNum: origLine, newNum: newLine };
        }
      });
  }, [lines]);

  // Side-by-side: split into left (removes + context) and right (adds + context)
  const sideBySide = useMemo(() => {
    const left: typeof numberedLines = [];
    const right: typeof numberedLines = [];
    for (const line of numberedLines) {
      if (line.type === "remove") {
        left.push(line);
      } else if (line.type === "add") {
        right.push(line);
      } else {
        // Pad shorter side to keep alignment
        while (left.length < right.length) left.push({ type: "context", content: "", origNum: null, newNum: null });
        while (right.length < left.length) right.push({ type: "context", content: "", origNum: null, newNum: null });
        left.push(line);
        right.push(line);
      }
    }
    while (left.length < right.length) left.push({ type: "context", content: "", origNum: null, newNum: null });
    while (right.length < left.length) right.push({ type: "context", content: "", origNum: null, newNum: null });
    return { left, right };
  }, [numberedLines]);

  const handleScroll = useCallback((source: "left" | "right") => {
    const from = source === "left" ? leftRef.current : rightRef.current;
    const to = source === "left" ? rightRef.current : leftRef.current;
    if (from && to) {
      to.scrollTop = from.scrollTop;
    }
  }, []);

  // Error / empty state
  if (!contentDiff || lines.length === 0) {
    return (
      <div
        className="rounded-lg p-6 text-center"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
      >
        <div className="text-[13px] mb-2" style={{ color: "var(--text-tertiary)" }}>
          Unable to load diff. Try again.
        </div>
        {onRetry && (
          <button onClick={onRetry} className="btn btn-secondary text-[12px]">
            Retry
          </button>
        )}
      </div>
    );
  }

  const wrapper = renderContext === "modal"
    ? "fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    : "";

  const inner = (
    <div
      className="rounded-xl overflow-hidden animate-fade-in"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-3">
          <div className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {fromLabel} → {toLabel}
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span style={{ color: "var(--green)" }}>+{stats.added}</span>
            <span style={{ color: "var(--red)" }}>-{stats.removed}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(viewMode === "unified" ? "side-by-side" : "unified")}
            className="btn btn-ghost text-[11px]"
          >
            {viewMode === "unified" ? "Side-by-side" : "Unified"}
          </button>
          {collapsible && (
            <button onClick={() => setCollapsed(!collapsed)} className="btn btn-ghost text-[11px]">
              {collapsed ? "Expand" : "Collapse"}
            </button>
          )}
        </div>
      </div>

      {/* Diff summary */}
      {diffSummary && (
        <div
          className="mx-4 mt-3 px-4 py-2 rounded-lg text-[12px]"
          style={{
            background: "var(--accent-muted)",
            color: "var(--text-secondary)",
          }}
        >
          {diffSummary}
        </div>
      )}

      {/* Diff body */}
      {!collapsed && (
        viewMode === "unified" ? (
          <div
            className="mx-4 my-4 rounded-lg overflow-hidden"
            style={{ border: "1px solid var(--border-subtle)", maxHeight, overflowY: "auto" }}
          >
            <table className="w-full" style={{ borderCollapse: "collapse", fontFamily: "var(--font-mono, monospace)" }}>
              <tbody>
                {numberedLines.map((line, i) => (
                  <tr
                    key={i}
                    style={{
                      background:
                        line.type === "add" ? "rgba(34,197,94,0.08)" :
                        line.type === "remove" ? "rgba(239,68,68,0.08)" :
                        "transparent",
                    }}
                  >
                    <td
                      className="text-right select-none px-2"
                      style={{
                        width: 40, fontSize: 10,
                        color: line.type === "remove" ? "rgba(239,68,68,0.5)" : "var(--text-tertiary)",
                        opacity: line.origNum ? 0.6 : 0.2,
                        borderRight: "1px solid var(--border-subtle)",
                      }}
                    >
                      {line.origNum ?? ""}
                    </td>
                    <td
                      className="text-right select-none px-2"
                      style={{
                        width: 40, fontSize: 10,
                        color: line.type === "add" ? "rgba(34,197,94,0.5)" : "var(--text-tertiary)",
                        opacity: line.newNum ? 0.6 : 0.2,
                        borderRight: "1px solid var(--border-subtle)",
                      }}
                    >
                      {line.newNum ?? ""}
                    </td>
                    <td
                      className="select-none text-center"
                      style={{
                        width: 20, fontSize: 11, fontWeight: 700,
                        color: line.type === "add" ? "var(--green)" : line.type === "remove" ? "var(--red)" : "transparent",
                        borderRight: line.type === "add" ? "2px solid var(--green)" : line.type === "remove" ? "2px solid var(--red)" : "2px solid transparent",
                      }}
                    >
                      {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                    </td>
                    <td
                      className="px-3 py-px whitespace-pre-wrap"
                      style={{
                        fontSize: 11, lineHeight: 1.6,
                        color: line.type === "add" ? "var(--green)" : line.type === "remove" ? "var(--red)" : "var(--text-secondary)",
                      }}
                    >
                      {line.content || "\u200B"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Side-by-side view */
          <div className="mx-4 my-4 grid grid-cols-2 gap-0 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-subtle)" }}>
            <div ref={leftRef} style={{ maxHeight, overflowY: "auto", borderRight: "1px solid var(--border-subtle)" }} onScroll={() => handleScroll("left")}>
              <table className="w-full" style={{ borderCollapse: "collapse", fontFamily: "var(--font-mono, monospace)" }}>
                <tbody>
                  {sideBySide.left.map((line, i) => (
                    <tr key={i} style={{ background: line.type === "remove" ? "rgba(239,68,68,0.08)" : "transparent" }}>
                      <td className="text-right select-none px-2" style={{ width: 35, fontSize: 10, color: "var(--text-tertiary)", opacity: 0.6, borderRight: "1px solid var(--border-subtle)" }}>
                        {line.origNum ?? ""}
                      </td>
                      <td className="px-3 py-px whitespace-pre-wrap" style={{ fontSize: 11, lineHeight: 1.6, color: line.type === "remove" ? "var(--red)" : "var(--text-secondary)" }}>
                        {line.content || "\u200B"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div ref={rightRef} style={{ maxHeight, overflowY: "auto" }} onScroll={() => handleScroll("right")}>
              <table className="w-full" style={{ borderCollapse: "collapse", fontFamily: "var(--font-mono, monospace)" }}>
                <tbody>
                  {sideBySide.right.map((line, i) => (
                    <tr key={i} style={{ background: line.type === "add" ? "rgba(34,197,94,0.08)" : "transparent" }}>
                      <td className="text-right select-none px-2" style={{ width: 35, fontSize: 10, color: "var(--text-tertiary)", opacity: 0.6, borderRight: "1px solid var(--border-subtle)" }}>
                        {line.newNum ?? ""}
                      </td>
                      <td className="px-3 py-px whitespace-pre-wrap" style={{ fontSize: 11, lineHeight: 1.6, color: line.type === "add" ? "var(--green)" : "var(--text-secondary)" }}>
                        {line.content || "\u200B"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );

  if (renderContext === "modal") {
    return <div className={wrapper}><div style={{ width: "80%", maxWidth: 900 }}>{inner}</div></div>;
  }

  return inner;
}
