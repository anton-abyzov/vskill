import { useState, useCallback, useRef } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { parseFrontmatter } from "../../utils/parseFrontmatter";
import { renderMarkdown } from "../../utils/renderMarkdown";
import { SkillImprovePanel } from "../../components/SkillImprovePanel";

type ViewMode = "split" | "raw" | "preview";

/* ------------------------------------------------------------------ */
/* Icon components — compact SVGs for the view toggle                 */
/* ------------------------------------------------------------------ */
function IconEditor({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function IconSplit({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  );
}

function IconPreview({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EditorPanel() {
  const { state, dispatch, saveContent } = useWorkspace();
  const { plugin, skill, skillContent, isDirty, improveTarget } = state;
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { metadata, body } = parseFrontmatter(skillContent);
  const rawAllowed = metadata["allowed-tools"];
  const allowedTools: string[] = Array.isArray(rawAllowed)
    ? rawAllowed
    : typeof rawAllowed === "string" ? [rawAllowed] : [];

  // Separate metadata into structured groups
  const name = metadata["name"] as string | undefined;
  const description = metadata["description"] as string | undefined;
  const nestedMeta = metadata["metadata"];
  const metadataObj = (typeof nestedMeta === "object" && !Array.isArray(nestedMeta))
    ? nestedMeta as Record<string, string | string[]>
    : null;

  // Version: top-level or nested under metadata
  const version = (metadata["version"] as string | undefined)
    || (metadataObj?.["version"] as string | undefined);

  // Tags: top-level, nested under metadata, or comma-separated string
  const rawTags = metadata["tags"] || metadataObj?.["tags"];
  const tagList = Array.isArray(rawTags)
    ? rawTags
    : typeof rawTags === "string"
      ? rawTags.split(",").map(t => t.trim()).filter(Boolean)
      : [];

  // Remaining fields that aren't handled specially
  const specialKeys = new Set(["name", "description", "metadata", "allowed-tools", "version", "tags"]);
  const extraFields = Object.entries(metadata).filter(([k]) => !specialKeys.has(k));

  const handleSave = useCallback(async () => {
    setSaving(true);
    await saveContent();
    setSaving(false);
  }, [saveContent]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      e.stopPropagation();
      if (isDirty) handleSave();
    }
  }, [isDirty, handleSave]);

  const viewModes: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
    { mode: "raw", icon: <IconEditor />, label: "Editor" },
    { mode: "split", icon: <IconSplit />, label: "Split" },
    { mode: "preview", icon: <IconPreview />, label: "Preview" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ─────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
      >
        {/* Segmented view toggle */}
        <div
          className="flex items-center"
          style={{
            background: "var(--surface-2)",
            borderRadius: 8,
            padding: 2,
            gap: 1,
          }}
        >
          {viewModes.map(({ mode, icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              title={label}
              className="flex items-center gap-1.5 rounded-md transition-all duration-150"
              style={{
                padding: "5px 10px",
                background: viewMode === mode ? "var(--surface-4)" : "transparent",
                color: viewMode === mode ? "var(--text-primary)" : "var(--text-tertiary)",
                fontSize: 11,
                fontWeight: viewMode === mode ? 600 : 400,
                border: "none",
                cursor: "pointer",
              }}
            >
              {icon}
              <span style={{ letterSpacing: "0.01em" }}>{label}</span>
            </button>
          ))}
        </div>

        {/* Save actions */}
        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              onClick={() => dispatch({ type: "SET_CONTENT", content: state.savedContent })}
              className="btn btn-ghost text-[11px]"
              style={{ padding: "4px 8px" }}
            >
              Discard
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="btn btn-primary text-[11px]"
            style={{ padding: "5px 14px" }}
          >
            {saving ? <><span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Saving...</> : "Save"}
          </button>
        </div>
      </div>

      {/* ── Editor Body ─────────────────────────────────── */}
      <div
        className="flex-1 overflow-hidden"
        style={{
          display: "grid",
          gridTemplateColumns:
            viewMode === "raw" ? "1fr" :
            viewMode === "preview" ? "1fr" :
            "1fr 1fr",
        }}
      >
        {/* ── Raw Editor Pane ──────────────────────────── */}
        {viewMode !== "preview" && (
          <div
            className="flex flex-col overflow-hidden"
            style={{
              borderRight: viewMode === "split" ? "1px solid var(--border-subtle)" : "none",
            }}
          >
            <textarea
              ref={textareaRef}
              value={skillContent}
              onChange={(e) => dispatch({ type: "SET_CONTENT", content: e.target.value })}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              className="flex-1 w-full resize-none outline-none"
              style={{
                background: "var(--surface-0)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
                fontSize: 12.5,
                lineHeight: 1.7,
                tabSize: 2,
                border: "none",
                padding: "16px 20px",
              }}
            />
          </div>
        )}

        {/* ── Preview Pane ─────────────────────────────── */}
        {viewMode !== "raw" && (
          <div
            className="overflow-auto"
            style={{ background: "var(--surface-0)" }}
          >
            <div className="animate-fade-in" style={{ padding: "20px 24px", maxWidth: 720 }}>
              {/* ─ Compact Metadata Header ───────────── */}
              {(name || version || description) && (
                <div style={{ marginBottom: 20 }}>
                  {/* Name + version inline */}
                  <div className="flex items-baseline gap-3" style={{ marginBottom: 8 }}>
                    {name && (
                      <h2
                        style={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: "var(--text-primary)",
                          letterSpacing: "-0.02em",
                          lineHeight: 1.2,
                          margin: 0,
                        }}
                      >
                        {name}
                      </h2>
                    )}
                    {version && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: "var(--accent)",
                          background: "var(--accent-muted)",
                          padding: "2px 7px",
                          borderRadius: 4,
                          letterSpacing: "0.03em",
                          fontFamily: "var(--font-mono, ui-monospace, monospace)",
                        }}
                      >
                        v{version}
                      </span>
                    )}
                  </div>

                  {/* Description as lead text with left accent */}
                  {description && (
                    <p
                      style={{
                        fontSize: 12.5,
                        lineHeight: 1.65,
                        color: "var(--text-secondary)",
                        margin: 0,
                        paddingLeft: 12,
                        borderLeft: "2px solid var(--accent)",
                        maxWidth: 600,
                      }}
                    >
                      {description}
                    </p>
                  )}
                </div>
              )}

              {/* ─ Tags ─────────────────────────────── */}
              {tagList.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5" style={{ marginBottom: 16 }}>
                  {tagList.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: "var(--text-tertiary)",
                        background: "var(--surface-2)",
                        padding: "3px 8px",
                        borderRadius: 4,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* ─ Allowed Tools ─────────────────────── */}
              {allowedTools.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "var(--text-tertiary)",
                        marginRight: 4,
                      }}
                    >
                      Tools
                    </span>
                    {allowedTools.map((tool) => (
                      <span
                        key={tool}
                        style={{
                          fontSize: 10.5,
                          fontFamily: "var(--font-mono, ui-monospace, monospace)",
                          color: "var(--accent)",
                          background: "var(--accent-muted)",
                          padding: "2px 7px",
                          borderRadius: 4,
                        }}
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ─ Extra Metadata (compact rows) ────── */}
              {extraFields.length > 0 && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: "8px 0",
                    borderTop: "1px solid var(--border-subtle)",
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  {extraFields.map(([key, value], i) => {
                    const display = Array.isArray(value)
                      ? value.join(", ")
                      : typeof value === "object"
                        ? Object.entries(value).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" | ")
                        : value;
                    return (
                      <div
                        key={key}
                        className="flex items-baseline gap-3"
                        style={{
                          padding: "4px 0",
                          borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "var(--text-tertiary)",
                            minWidth: 80,
                            flexShrink: 0,
                          }}
                        >
                          {key}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          {display}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ─ Divider between metadata and body ── */}
              {(name || description || tagList.length > 0 || allowedTools.length > 0 || extraFields.length > 0) && body && (
                <div
                  style={{
                    height: 1,
                    background: "linear-gradient(90deg, var(--accent) 0%, var(--border-subtle) 40%, transparent 100%)",
                    marginBottom: 20,
                    opacity: 0.5,
                  }}
                />
              )}

              {/* ─ Body (rendered markdown) ───────────── */}
              {body && (
                <div
                  className="text-[13px] leading-relaxed overflow-x-auto"
                  style={{
                    color: "var(--text-secondary)",
                    wordBreak: "break-word",
                  }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── AI Improve Panel ──────────────────────────── */}
      {improveTarget !== null && plugin && skill && (
        <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <SkillImprovePanel
            plugin={plugin}
            skill={skill}
            skillContent={skillContent}
            onApplied={(newContent) => {
              dispatch({ type: "SET_CONTENT", content: newContent });
              dispatch({ type: "CONTENT_SAVED" });
              dispatch({ type: "CLOSE_IMPROVE" });
            }}
          />
        </div>
      )}
    </div>
  );
}
