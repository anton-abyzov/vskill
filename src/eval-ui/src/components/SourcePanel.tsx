// 0823 T-018 — Read-only "Source" view for any skill (author or installed copy).
//
// Two-pane layout: SourceFileTree (left) + content viewer (right). Default
// selection is SKILL.md. File rendering dispatches by extension:
//   .md                                  -> SkillContentViewer (markdown)
//   text/code/config (text-like)         -> TextFileViewer (monospace <pre>)
//   .png/.jpg/.jpeg/.gif/.webp/.svg      -> ImageFileViewer (<img>)
//   everything else                      -> BinaryFilePlaceholder
//
// Consumes already-existing endpoints:
//   GET /api/skills/:plugin/:skill/files
//   GET /api/skills/:plugin/:skill/file?path=<rel>
import { useEffect, useState } from "react";
import { api } from "../api";
import type { SkillFileContent, SkillFileEntry } from "../types";
import { formatBytes } from "../utils/formatBytes";
import { ProviderChip, type SkillProvider } from "./ProviderChip";
import { SkillContentViewer } from "./SkillContentViewer";
import { SourceFileTree } from "./SourceFileTree";

interface Props {
  plugin: string;
  skill: string;
  /** 0823 F-005 / FR-006: provider chip rendered in the Source tab header so
   *  consumers see provenance even before navigating to the Versions tab.
   *  When omitted, SourcePanel auto-fetches from the /versions envelope. */
  provider?: SkillProvider | null;
}

const TEXT_EXTS = new Set([
  "md", "txt", "json", "yaml", "yml", "toml", "ini", "env",
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "c", "cc", "cpp", "h", "hpp",
  "sh", "bash", "zsh", "fish",
  "html", "css", "scss", "less",
  "xml", "csv", "tsv", "log", "diff", "patch",
  "lock", "gitignore", "dockerfile",
]);
// 0823 F-002: SVG excluded — server refuses raw=1 for SVG (script-injection
// risk). SVGs render as the binary placeholder instead. Re-enable only after
// the server gains a sandboxed-iframe SVG renderer.
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico"]);

function ext(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i + 1).toLowerCase() : "";
}

function classify(path: string): "markdown" | "text" | "image" | "binary" {
  const e = ext(path);
  if (e === "md") return "markdown";
  if (IMAGE_EXTS.has(e)) return "image";
  if (TEXT_EXTS.has(e)) return "text";
  return "binary";
}

function MarkdownViewer({ content }: { content: string }) {
  return (
    <div data-testid="source-md-viewer">
      <SkillContentViewer content={content} />
    </div>
  );
}

function TextFileViewer({ content, path }: { content: string; path: string }) {
  const lines = content.split("\n");
  const truncated = lines.length > 5000;
  const display = truncated ? lines.slice(0, 5000).join("\n") : content;
  return (
    <div
      data-testid="source-text-viewer"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        overflow: "auto",
        maxHeight: "70vh",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          background: "var(--surface-2)",
          borderBottom: "1px solid var(--border-subtle)",
          fontFamily: "var(--font-sans)",
          fontSize: 11,
          color: "var(--text-tertiary)",
        }}
      >
        {path} · {lines.length} {lines.length === 1 ? "line" : "lines"}
        {truncated && " (truncated for display)"}
      </div>
      <pre
        style={{
          margin: 0,
          padding: 12,
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 12,
          lineHeight: 1.5,
          color: "var(--text-primary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {display}
      </pre>
    </div>
  );
}

function ImageFileViewer({ plugin, skill, path }: { plugin: string; skill: string; path: string }) {
  const src = `/api/skills/${plugin}/${skill}/file?path=${encodeURIComponent(path)}&raw=1`;
  return (
    <div
      data-testid="source-image-viewer"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <img
        src={src}
        alt={path}
        style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" }}
      />
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-sans)" }}>
        {path}
      </div>
    </div>
  );
}

function BinaryFilePlaceholder({ path, size }: { path: string; size: number }) {
  return (
    <div
      data-testid="source-binary-placeholder"
      style={{
        background: "var(--surface-1)",
        border: "1px dashed var(--border-default)",
        borderRadius: 8,
        padding: 24,
        textAlign: "center",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
        Binary file — {formatBytes(size)}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{path}</div>
    </div>
  );
}

export function SourcePanel({ plugin, skill, provider: providerProp }: Props) {
  const [files, setFiles] = useState<SkillFileEntry[]>([]);
  const [activePath, setActivePath] = useState<string>("SKILL.md");
  const [content, setContent] = useState<SkillFileContent | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [autoProvider, setAutoProvider] = useState<SkillProvider | null>(null);
  const provider = providerProp ?? autoProvider;

  // 0823 F-005: when no provider is passed in, auto-fetch from the /versions
  // envelope so the header chip reflects origin-resolver classification.
  useEffect(() => {
    if (providerProp !== undefined) return;
    let cancelled = false;
    api
      .getSkillVersionsEnvelope(plugin, skill)
      .then((env) => {
        if (cancelled) return;
        setAutoProvider((env.provider ?? null) as SkillProvider | null);
      })
      .catch(() => { /* chip just stays hidden */ });
    return () => {
      cancelled = true;
    };
  }, [plugin, skill, providerProp]);

  // Fetch file list once on mount / per-skill change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getSkillFiles(plugin, skill)
      .then((res) => {
        if (cancelled) return;
        setFiles(res.files);
        // Default selection: SKILL.md if present, else first file.
        const hasSkillMd = res.files.some((f) => f.path === "SKILL.md");
        const next = hasSkillMd
          ? "SKILL.md"
          : res.files.find((f) => f.type === "file")?.path ?? "";
        setActivePath(next);
        // 0823 F-009: if the skill dir is genuinely empty, the second effect
        // never fires (`if (!activePath) return`) and loading would stay true
        // forever. Clear it here so the empty-state UI gets a chance to show.
        if (!next) setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [plugin, skill]);

  // Fetch content whenever the active path changes.
  useEffect(() => {
    if (!activePath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getSkillFile(plugin, skill, activePath)
      .then((res) => {
        if (cancelled) return;
        setContent(res);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [plugin, skill, activePath]);

  const renderContent = () => {
    if (error) {
      return (
        <div
          data-testid="source-error"
          style={{
            padding: 16,
            color: "var(--danger, #c00)",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
          }}
        >
          Failed to load: {error}
        </div>
      );
    }
    if (loading || !content) {
      return (
        <div
          data-testid="source-loading"
          style={{
            padding: 16,
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
          }}
        >
          Loading…
        </div>
      );
    }
    const kind = classify(activePath);
    if (kind === "markdown") {
      return <MarkdownViewer content={content.content ?? ""} />;
    }
    if (kind === "text" && !content.binary) {
      return <TextFileViewer content={content.content ?? ""} path={activePath} />;
    }
    if (kind === "image") {
      return <ImageFileViewer plugin={plugin} skill={skill} path={activePath} />;
    }
    return <BinaryFilePlaceholder path={activePath} size={content.size} />;
  };

  return (
    <div
      data-testid="source-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 400,
        gap: 12,
      }}
    >
      {provider && (
        <div
          data-testid="source-panel-header"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingLeft: 4,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-sans)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Provider:
          </span>
          <ProviderChip provider={provider} />
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          gap: 16,
          flex: 1,
          minHeight: 0,
        }}
      >
        <aside
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            overflow: "auto",
            maxHeight: "75vh",
          }}
        >
          <SourceFileTree files={files} activePath={activePath} onSelect={setActivePath} />
        </aside>
        <main style={{ minWidth: 0 }}>{renderContent()}</main>
      </div>
    </div>
  );
}
