// ---------------------------------------------------------------------------
// SecondaryFileViewer — read-only viewer for non-SKILL.md files
// ---------------------------------------------------------------------------

import { useState } from "react";
import type { SkillFileContent } from "../types";
import { renderMarkdown } from "../utils/renderMarkdown";

type ViewMode = "raw" | "split" | "preview";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function getFileType(path: string): "json" | "md" | "other" {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "md";
  return "other";
}

interface RawPaneProps {
  content: string;
}

function RawPane({ content }: RawPaneProps) {
  return (
    <textarea
      readOnly
      value={content}
      style={{
        flex: 1,
        width: "100%",
        resize: "none",
        background: "var(--surface-1)",
        color: "var(--text-primary)",
        border: "none",
        outline: "none",
        padding: "12px 16px",
        fontSize: 12,
        fontFamily: "var(--font-mono, monospace)",
        lineHeight: 1.6,
      }}
    />
  );
}

interface PreviewPaneProps {
  content: string;
  fileType: "json" | "md" | "other";
}

function PreviewPane({ content, fileType }: PreviewPaneProps) {
  if (fileType === "json") {
    const formatted = formatJson(content);
    return (
      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: "12px 16px",
          overflow: "auto",
          background: "var(--surface-0)",
          color: "var(--text-primary)",
          fontSize: 12,
          fontFamily: "var(--font-mono, monospace)",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {formatted}
      </pre>
    );
  }

  if (fileType === "md") {
    return (
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "16px 20px",
          background: "var(--surface-0)",
          color: "var(--text-primary)",
          fontSize: 13,
          lineHeight: 1.6,
        }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    );
  }

  return (
    <pre
      style={{
        flex: 1,
        margin: 0,
        padding: "12px 16px",
        overflow: "auto",
        background: "var(--surface-0)",
        color: "var(--text-primary)",
        fontSize: 12,
        fontFamily: "var(--font-mono, monospace)",
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {content}
    </pre>
  );
}

interface SecondaryFileViewerProps {
  file: SkillFileContent | null;
  loading: boolean;
  error: string | null;
  viewMode: ViewMode;
}

export function SecondaryFileViewer({ file, loading, error, viewMode }: SecondaryFileViewerProps) {
  const [localViewMode, setLocalViewMode] = useState<ViewMode>(viewMode);

  // Sync prop changes (e.g. user toggles in EditorPanel toolbar)
  const effectiveMode = viewMode !== localViewMode ? viewMode : localViewMode;

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            padding: "16px 20px",
            maxWidth: 400,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600, marginBottom: 6 }}>Unable to open file</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{error}</div>
        </div>
      </div>
    );
  }

  if (!file) {
    return null;
  }

  if (file.binary) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
        Binary file ({formatBytes(file.size)}) — cannot be displayed
      </div>
    );
  }

  const content = file.content ?? "";
  const fileType = getFileType(file.path);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Truncation warning */}
      {file.truncated && (
        <div
          style={{
            padding: "4px 12px",
            background: "var(--warning-muted, #fef3c7)",
            borderBottom: "1px solid var(--border-subtle)",
            fontSize: 11,
            color: "var(--warning-text, #92400e)",
          }}
        >
          File truncated at {formatBytes(512 * 1024)} — {formatBytes(file.size)} total
        </div>
      )}

      {/* View mode toolbar (only for json/md) */}
      {fileType !== "other" && (
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "4px 8px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--surface-0)",
          }}
        >
          {(["raw", "split", "preview"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setLocalViewMode(mode)}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                background: effectiveMode === mode ? "var(--accent-muted)" : "none",
                color: effectiveMode === mode ? "var(--accent)" : "var(--text-tertiary)",
                border: "none",
                borderRadius: 3,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {mode}
            </button>
          ))}
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--text-tertiary)",
              display: "flex",
              alignItems: "center",
            }}
          >
            {formatBytes(file.size)} · read-only
          </span>
        </div>
      )}

      {/* Content area */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {effectiveMode === "split" && fileType !== "other" ? (
          <>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border-subtle)" }}>
              <RawPane content={content} />
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
              <PreviewPane content={content} fileType={fileType} />
            </div>
          </>
        ) : effectiveMode === "preview" && fileType !== "other" ? (
          <PreviewPane content={content} fileType={fileType} />
        ) : (
          <RawPane content={content} />
        )}
      </div>
    </div>
  );
}
