import { useState } from "react";
import { parseFrontmatter } from "../utils/parseFrontmatter";

interface Props {
  content: string;
  defaultExpanded?: boolean;
}

export function SkillContentViewer({ content, defaultExpanded = true }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { metadata, body } = parseFrontmatter(content);

  if (!content.trim()) return null;

  const hasMetadata = Object.keys(metadata).length > 0;
  const allowedTools = metadata["allowed-tools"];
  const toolsList = Array.isArray(allowedTools) ? allowedTools : typeof allowedTools === "string" ? [allowedTools] : [];

  // Fields to show as metadata cards (exclude allowed-tools, shown separately)
  const metaFields = Object.entries(metadata).filter(
    ([key]) => key !== "allowed-tools",
  );

  return (
    <div
      className="mb-5 rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors duration-150"
        style={{ background: "var(--surface-2)" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "var(--accent-muted)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <div>
            <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
              SKILL.md
            </span>
            <span className="text-[11px] ml-2" style={{ color: "var(--text-tertiary)" }}>
              Skill Definition
            </span>
          </div>
        </div>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s ease" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Content */}
      {expanded && (
        <div className="px-5 py-4 animate-fade-in">
          {/* Metadata cards */}
          {hasMetadata && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              {metaFields.map(([key, value]) => {
                const display = Array.isArray(value)
                  ? value.join(", ")
                  : typeof value === "object"
                    ? Object.entries(value).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" | ")
                    : value;
                return (
                  <div
                    key={key}
                    className="px-3 py-2.5 rounded-lg"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-tertiary)" }}>
                      {key}
                    </div>
                    <div className="text-[12px]" style={{ color: "var(--text-primary)" }}>
                      {display}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Allowed tools as pills */}
          {toolsList.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>
                Allowed Tools
              </div>
              <div className="flex flex-wrap gap-1.5">
                {toolsList.map((tool) => (
                  <span
                    key={tool}
                    className="px-2 py-1 rounded-md text-[11px] font-mono"
                    style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Body content */}
          {body && (
            <pre
              className="text-[12px] leading-relaxed p-4 rounded-lg overflow-x-auto"
              style={{
                background: "var(--surface-0)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-subtle)",
                maxHeight: "400px",
                overflowY: "auto",
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {body}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
