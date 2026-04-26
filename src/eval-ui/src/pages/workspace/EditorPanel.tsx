import { useState, useEffect, useCallback, useRef } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { useConfig } from "../../ConfigContext";
import { parseFrontmatter } from "../../utils/parseFrontmatter";
import { renderMarkdown } from "../../utils/renderMarkdown";
import { computeDiff } from "../../utils/diff";
import type { DiffLine } from "../../utils/diff";
import { SkillImprovePanel } from "../../components/SkillImprovePanel";
import { AiEditBar } from "../../components/AiEditBar";
import { ProgressLog } from "../../components/ProgressLog";
import type { ProgressEntry } from "../../components/ProgressLog";
import { useSkillFiles } from "./useSkillFiles";
import { SkillFileBrowser } from "../../components/SkillFileBrowser";
import { SecondaryFileViewer } from "../../components/SecondaryFileViewer";
import { PublishButton } from "../../components/PublishButton";
import { useGitRemote } from "../../hooks/useGitRemote";

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

function IconWand({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" />
      <path d="M17.8 11.8L19 13" /><path d="M15 9h.01" />
      <path d="M17.8 6.2L19 5" /><path d="M11 6.2L9.7 5" />
      <path d="M3 21l9-9" />
    </svg>
  );
}

function IconSparkle({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" />
    </svg>
  );
}

export function EditorPanel() {
  const { state, dispatch, saveContent, isReadOnly } = useWorkspace();
  const { plugin, skill, skillContent, isDirty, improveTarget, aiEditOpen } = state;
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Regenerate state
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState("");
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenResult, setRegenResult] = useState<string | null>(null);
  const [regenDiff, setRegenDiff] = useState<DiffLine[]>([]);
  const [regenProgress, setRegenProgress] = useState<ProgressEntry[]>([]);
  const [regenError, setRegenError] = useState<string | null>(null);
  const regenAbortRef = useRef<AbortController | null>(null);
  const { config } = useConfig();

  // 0759: probe git state for the Publish button. Hook runs once on mount.
  const gitRemote = useGitRemote();

  const { files, activeFile, secondaryContent, loading: filesLoading, error: filesError, selectFile, refresh: refreshFiles, isSkillMd } = useSkillFiles(plugin ?? "", skill ?? "");
  const [secondaryDirty, setSecondaryDirty] = useState(false);

  const guardedSelectFile = useCallback((path: string) => {
    if (secondaryDirty && !window.confirm("You have unsaved changes. Discard?")) return;
    selectFile(path);
  }, [secondaryDirty, selectFile]);

  useEffect(() => {
    return () => { regenAbortRef.current?.abort(); };
  }, []);

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
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      e.stopPropagation();
      dispatch({ type: aiEditOpen ? "CLOSE_AI_EDIT" : "OPEN_AI_EDIT" });
    }
  }, [isDirty, handleSave, aiEditOpen, dispatch]);

  const handleRegenSubmit = useCallback(async () => {
    if (!regenPrompt.trim()) return;
    // Abort any existing stream
    regenAbortRef.current?.abort();
    const controller = new AbortController();
    regenAbortRef.current = controller;

    setRegenLoading(true);
    setRegenError(null);
    setRegenProgress([]);
    setRegenResult(null);
    setRegenDiff([]);

    try {
      const provider = config?.provider || "claude-cli";
      const model = config?.model || "sonnet";

      const res = await fetch("/api/skills/generate?sse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: regenPrompt, provider, model }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "progress") {
                setRegenProgress((prev) => [...prev, { phase: data.phase, message: data.message, timestamp: Date.now() }]);
              } else if (currentEvent === "done" || currentEvent === "complete") {
                // Build full SKILL.md content from generated fields
                const parts: string[] = ["---"];
                if (data.name) parts.push(`name: ${data.name}`);
                if (data.description) parts.push(`description: "${data.description.replace(/"/g, '\\"')}"`);
                if (data.model) parts.push(`model: ${data.model}`);
                if (data.allowedTools?.trim()) {
                  parts.push(`allowed-tools: ${data.allowedTools.trim()}`);
                }
                parts.push("---", "", data.body || "");
                const generated = parts.join("\n");
                setRegenResult(generated);
                setRegenDiff(computeDiff(skillContent, generated));
                setRegenLoading(false);
              } else if (currentEvent === "error") {
                setRegenError(data.message || data.description || "Generation failed");
                setRegenLoading(false);
              }
            } catch {
              // skip malformed
            }
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setRegenError((err as Error).message);
      }
    } finally {
      setRegenLoading(false);
      regenAbortRef.current = null;
    }
  }, [regenPrompt, config, skillContent]);

  const handleRegenApply = useCallback(() => {
    if (regenResult) {
      dispatch({ type: "SET_CONTENT", content: regenResult });
    }
    setRegenOpen(false);
    setRegenResult(null);
    setRegenDiff([]);
    setRegenPrompt("");
    setRegenProgress([]);
  }, [regenResult, dispatch]);

  const handleRegenDiscard = useCallback(() => {
    setRegenOpen(false);
    setRegenResult(null);
    setRegenDiff([]);
    setRegenPrompt("");
    setRegenProgress([]);
    setRegenError(null);
  }, []);

  const handleRegenToggle = useCallback(() => {
    if (regenOpen) {
      regenAbortRef.current?.abort();
      handleRegenDiscard();
    } else {
      // Close AI Edit if open (mutual exclusion)
      if (aiEditOpen) dispatch({ type: "CLOSE_AI_EDIT" });
      setRegenOpen(true);
    }
  }, [regenOpen, aiEditOpen, dispatch, handleRegenDiscard]);

  const viewModes: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
    { mode: "raw", icon: <IconEditor />, label: "Editor" },
    { mode: "split", icon: <IconSplit />, label: "Split" },
    { mode: "preview", icon: <IconPreview />, label: "Preview" },
  ];

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown} tabIndex={-1}>
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

        {/* Save actions — hidden for installed (read-only) skills and secondary files */}
        {!isSkillMd ? null : isReadOnly ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Read-only
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (aiEditOpen) {
                  dispatch({ type: "CLOSE_AI_EDIT" });
                } else {
                  if (regenOpen) handleRegenDiscard();
                  dispatch({ type: "OPEN_AI_EDIT" });
                }
              }}
              title="Edit with AI (Ctrl+K)"
              className="flex items-center gap-1.5 rounded-md transition-all duration-150"
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: aiEditOpen ? 600 : 400,
                border: "none",
                cursor: "pointer",
                color: aiEditOpen ? "var(--purple)" : "var(--text-tertiary)",
                background: aiEditOpen ? "var(--purple-muted)" : "transparent",
              }}
            >
              <IconWand size={13} />
              <span>AI Edit</span>
            </button>
            <button
              onClick={handleRegenToggle}
              title="Regenerate skill from prompt"
              className="flex items-center gap-1.5 rounded-md transition-all duration-150"
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: regenOpen ? 600 : 400,
                border: "none",
                cursor: "pointer",
                color: regenOpen ? "var(--purple)" : "var(--text-tertiary)",
                background: regenOpen ? "var(--purple-muted)" : "transparent",
              }}
            >
              <IconSparkle size={13} />
              <span>Regenerate</span>
            </button>
            <div style={{ width: 1, height: 16, background: "var(--border-subtle)" }} />
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
            {gitRemote.hasRemote && gitRemote.remoteUrl && (
              <PublishButton remoteUrl={gitRemote.remoteUrl} />
            )}
          </div>
        )}
      </div>

      {/* ── File Browser Strip ──────────────────────────── */}
      {plugin && skill && (
        <SkillFileBrowser
          files={files}
          activeFile={activeFile}
          onSelect={guardedSelectFile}
          onRefresh={refreshFiles}
        />
      )}

      {/* ── Secondary File Viewer (non-SKILL.md files) ──── */}
      {!isSkillMd && (
        <SecondaryFileViewer
          file={secondaryContent}
          loading={filesLoading}
          error={filesError}
          viewMode={viewMode}
          plugin={plugin ?? undefined}
          skill={skill ?? undefined}
          onSaved={() => { selectFile(activeFile); refreshFiles(); }}
          onDirtyChange={setSecondaryDirty}
        />
      )}

      {/* ── Editor Body ─────────────────────────────────── */}
      {isSkillMd && <div
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
              onChange={(e) => { if (!isReadOnly) dispatch({ type: "SET_CONTENT", content: e.target.value }); }}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              readOnly={isReadOnly}
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
                opacity: isReadOnly ? 0.7 : 1,
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
      </div>}

      {/* ── AI Edit Bar ──────────────────────────────── */}
      {isSkillMd && aiEditOpen && (
        <AiEditBar />
      )}

      {/* ── Regenerate Panel ─────────────────────────── */}
      {isSkillMd && regenOpen && (
        <div
          className="animate-fade-in"
          style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
        >
          <div className="px-4 py-3">
            {!regenResult && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <IconSparkle size={14} />
                  <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    Regenerate Skill
                  </span>
                </div>
                <div className="flex gap-2 mb-2">
                  <textarea
                    value={regenPrompt}
                    onChange={(e) => setRegenPrompt(e.target.value)}
                    placeholder="Describe what this skill should do..."
                    rows={2}
                    disabled={regenLoading}
                    className="flex-1 px-3 py-2 rounded-lg text-[12px] resize-none"
                    style={{
                      background: "var(--surface-0)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-subtle)",
                      outline: "none",
                      opacity: regenLoading ? 0.5 : 1,
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && regenPrompt.trim() && !regenLoading) {
                        e.preventDefault();
                        handleRegenSubmit();
                      }
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  {regenLoading ? (
                    <button onClick={() => { regenAbortRef.current?.abort(); setRegenLoading(false); }} className="btn btn-secondary text-[11px]" style={{ padding: "4px 12px" }}>
                      Cancel
                    </button>
                  ) : (
                    <button
                      onClick={handleRegenSubmit}
                      disabled={!regenPrompt.trim()}
                      className="btn btn-primary text-[11px]"
                      style={{ padding: "4px 12px" }}
                    >
                      Generate
                    </button>
                  )}
                  <button onClick={handleRegenDiscard} className="btn btn-ghost text-[11px]" style={{ padding: "4px 8px" }}>
                    Close
                  </button>
                </div>
                {regenLoading && regenProgress.length > 0 && (
                  <div className="mt-2">
                    <ProgressLog entries={regenProgress} isRunning={true} />
                  </div>
                )}
                {regenError && (
                  <div className="mt-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: "var(--red-muted)", color: "var(--red)" }}>
                    {regenError}
                    <button onClick={handleRegenSubmit} className="ml-2 underline" style={{ color: "var(--red)" }}>Retry</button>
                  </div>
                )}
              </>
            )}

            {regenResult && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <IconSparkle size={14} />
                  <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    Regenerated — Review Changes
                  </span>
                </div>
                <div
                  className="rounded-lg overflow-hidden mb-3"
                  style={{ border: "1px solid var(--border-subtle)", maxHeight: "300px", overflowY: "auto" }}
                >
                  {regenDiff.map((line, i) => (
                    <div
                      key={i}
                      className="px-3 py-0.5 text-[11px] font-mono"
                      style={{
                        background:
                          line.type === "added" ? "var(--green-muted)" :
                          line.type === "removed" ? "var(--red-muted)" :
                          "transparent",
                        color:
                          line.type === "added" ? "var(--green)" :
                          line.type === "removed" ? "var(--red)" :
                          "var(--text-secondary)",
                        borderLeft:
                          line.type === "added" ? "3px solid var(--green)" :
                          line.type === "removed" ? "3px solid var(--red)" :
                          "3px solid transparent",
                      }}
                    >
                      <span style={{ userSelect: "none", opacity: 0.5, marginRight: 8 }}>
                        {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                      </span>
                      {line.content}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={handleRegenApply} className="btn btn-primary text-[11px]" style={{ padding: "4px 12px" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    Apply
                  </button>
                  <button onClick={handleRegenDiscard} className="btn btn-secondary text-[11px]" style={{ padding: "4px 12px" }}>
                    Discard
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── AI Improve Panel ──────────────────────────── */}
      {isSkillMd && improveTarget !== null && plugin && skill && (
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
