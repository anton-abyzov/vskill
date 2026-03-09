import { useState, useCallback, useEffect, useRef } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { parseFrontmatter } from "../../utils/parseFrontmatter";
import { SkillImprovePanel } from "../../components/SkillImprovePanel";

type ViewMode = "split" | "raw" | "preview";

export function EditorPanel() {
  const { state, dispatch, saveContent } = useWorkspace();
  const { plugin, skill, skillContent, isDirty, improveTarget } = state;
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { metadata, body } = parseFrontmatter(skillContent);
  const allowedTools = Array.isArray(metadata["allowed-tools"])
    ? metadata["allowed-tools"]
    : metadata["allowed-tools"] ? [metadata["allowed-tools"]] : [];
  const metaFields = Object.entries(metadata).filter(([k]) => k !== "allowed-tools");

  const handleSave = useCallback(async () => {
    setSaving(true);
    await saveContent();
    setSaving(false);
  }, [saveContent]);

  // Ctrl+S in textarea
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      e.stopPropagation();
      if (isDirty) handleSave();
    }
  }, [isDirty, handleSave]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
      >
        {/* View mode toggles */}
        <div className="flex items-center gap-1">
          {(["raw", "split", "preview"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150"
              style={{
                background: viewMode === mode ? "var(--accent-muted)" : "transparent",
                color: viewMode === mode ? "var(--accent)" : "var(--text-tertiary)",
              }}
            >
              {mode === "raw" ? "Raw" : mode === "split" ? "Side-by-Side" : "Preview"}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              onClick={() => dispatch({ type: "SET_CONTENT", content: state.savedContent })}
              className="btn btn-ghost text-[12px]"
            >
              Discard
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="btn btn-primary text-[12px]"
          >
            {saving ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Saving...</> : "Save"}
          </button>
        </div>
      </div>

      {/* Editor body */}
      <div
        className="flex-1 overflow-hidden"
        style={{
          display: "grid",
          gridTemplateColumns: viewMode === "raw" ? "1fr" : viewMode === "preview" ? "1fr" : "1fr 1fr",
        }}
      >
        {/* Raw editor */}
        {viewMode !== "preview" && (
          <div className="flex flex-col overflow-hidden" style={{ borderRight: viewMode === "split" ? "1px solid var(--border-subtle)" : "none" }}>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)", background: "var(--surface-2)", borderBottom: "1px solid var(--border-subtle)" }}>
              SKILL.md
            </div>
            <textarea
              ref={textareaRef}
              value={skillContent}
              onChange={(e) => dispatch({ type: "SET_CONTENT", content: e.target.value })}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              className="flex-1 w-full resize-none outline-none p-4"
              style={{
                background: "var(--surface-0)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                fontSize: 13,
                lineHeight: 1.6,
                tabSize: 2,
                border: "none",
              }}
            />
          </div>
        )}

        {/* Preview */}
        {viewMode !== "raw" && (
          <div className="overflow-auto">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)", background: "var(--surface-2)", borderBottom: "1px solid var(--border-subtle)" }}>
              Preview
            </div>
            <div className="p-4 animate-fade-in">
              {/* Frontmatter cards */}
              {metaFields.length > 0 && (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {metaFields.map(([key, value]) => (
                    <div
                      key={key}
                      className="px-3 py-2.5 rounded-lg"
                      style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-tertiary)" }}>
                        {key}
                      </div>
                      <div className="text-[12px]" style={{ color: "var(--text-primary)" }}>
                        {Array.isArray(value) ? value.join(", ") : value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Allowed tools pills */}
              {allowedTools.length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>
                    Allowed Tools
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allowedTools.map((tool) => (
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

              {/* Body */}
              {body && (
                <pre
                  className="text-[12px] leading-relaxed p-4 rounded-lg overflow-x-auto"
                  style={{
                    background: "var(--surface-1)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-subtle)",
                    maxHeight: "calc(100vh - 200px)",
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
          </div>
        )}
      </div>

      {/* AI Improve panel — shown when improveTarget is set */}
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
