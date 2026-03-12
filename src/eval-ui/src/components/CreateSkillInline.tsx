import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api } from "../api";
import { useConfig } from "../ConfigContext";
import type { ProjectLayoutResponse, DetectedLayout, GeneratedEval } from "../types";
import { ProgressLog } from "./ProgressLog";
import type { ProgressEntry } from "./ProgressLog";
import { ErrorCard } from "./ErrorCard";
import type { ClassifiedError } from "./ErrorCard";
import { renderMarkdown } from "../utils/renderMarkdown";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toKebab(s: string, trim = true): string {
  let r = s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (trim) r = r.replace(/^-+|-+$/g, "");
  return r;
}

function resolvePathPreview(root: string, layout: 1 | 2 | 3, plugin: string, name: string): string {
  const short = root.split("/").slice(-2).join("/");
  const prefix = `.../${short}`;
  switch (layout) {
    case 1: return `${prefix}/${plugin}/skills/${name || "{skill}"}/SKILL.md`;
    case 2: return `${prefix}/plugins/${plugin}/skills/${name || "{skill}"}/SKILL.md`;
    case 3: return `${prefix}/skills/${name || "{skill}"}/SKILL.md`;
  }
}

const inputStyle = {
  background: "var(--surface-3)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-subtle)",
};

// ---------------------------------------------------------------------------
// Sparkle icon for AI mode
// ---------------------------------------------------------------------------

function SparkleIcon({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  onCreated: (plugin: string, skill: string) => void;
  onCancel: () => void;
}

export function CreateSkillInline({ onCreated, onCancel }: Props) {
  // Mode toggle
  const [mode, setMode] = useState<"manual" | "ai">("manual");

  // Layout detection
  const [layout, setLayout] = useState<ProjectLayoutResponse | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(true);

  // Config (providers/models) — shared via context
  const { config } = useConfig();

  // Form state
  const [name, setName] = useState("");
  const [selectedLayout, setSelectedLayout] = useState<1 | 2 | 3>(3);
  const [plugin, setPlugin] = useState("");
  const [newPlugin, setNewPlugin] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [body, setBody] = useState("");
  const [pendingEvals, setPendingEvals] = useState<GeneratedEval[] | null>(null);

  // Body preview toggle
  const [bodyViewMode, setBodyViewMode] = useState<"write" | "preview">("write");

  // Submission
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI generation state
  const [aiPrompt, setAiPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiClassifiedError, setAiClassifiedError] = useState<ClassifiedError | null>(null);
  const [aiProgress, setAiProgress] = useState<ProgressEntry[]>([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load layout + config on mount
  useEffect(() => {
    api.getProjectLayout()
      .then((l) => {
        setLayout(l);
        setSelectedLayout(l.suggestedLayout);
        const suggested = l.detectedLayouts.find((d) => d.layout === l.suggestedLayout);
        if (suggested?.existingPlugins.length) setPlugin(suggested.existingPlugins[0]);
      })
      .catch(() => {})
      .finally(() => setLayoutLoading(false));

  }, []);

  // Auto-focus prompt when switching to AI mode
  useEffect(() => {
    if (mode === "ai") promptRef.current?.focus();
  }, [mode]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Computed values
  const availablePlugins = useMemo(() => {
    if (!layout) return [];
    return layout.detectedLayouts.find((d) => d.layout === selectedLayout)?.existingPlugins || [];
  }, [layout, selectedLayout]);

  const effectivePlugin = plugin === "__new__" ? newPlugin : plugin;

  const pathPreview = layout
    ? resolvePathPreview(layout.root, selectedLayout, effectivePlugin || "{plugin}", name || "{skill}")
    : "";

  const creatableLayouts = useMemo(() => {
    if (!layout) return [];
    return layout.detectedLayouts.filter((d): d is DetectedLayout & { layout: 1 | 2 | 3 } => d.layout !== 4);
  }, [layout]);

  // Current model label for the generate button
  const currentModelLabel = useMemo(() => {
    if (!config) return null;
    for (const provider of config.providers) {
      for (const m of provider.models) {
        const isActive = provider.id === config.provider &&
          (provider.id === "claude-cli" ? config.model === `claude-${m.id}` : config.model === m.id);
        if (isActive) return m.label;
      }
    }
    return config.model || null;
  }, [config]);

  // Resolve provider/model for generation request
  const resolveAiConfig = useCallback(() => {
    if (!config) return { provider: "claude-cli", model: "sonnet" };
    const provider = config.provider || "claude-cli";
    // Extract model ID from config.model (e.g. "claude-sonnet" -> "sonnet")
    let modelId = config.model || "sonnet";
    if (provider === "claude-cli" && modelId.startsWith("claude-")) {
      modelId = modelId.replace("claude-", "");
    }
    return { provider, model: modelId };
  }, [config]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleCancelGenerate = useCallback(() => {
    abortRef.current?.abort();
    setGenerating(false);
  }, []);

  async function handleGenerate() {
    setAiError(null);
    setAiClassifiedError(null);
    setAiReasoning(null);
    setAiProgress([]);
    if (!aiPrompt.trim()) { setAiError("Describe what your skill should do"); return; }

    setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const { provider, model: aiModel } = resolveAiConfig();

    try {
      const res = await fetch(`/api/skills/generate?sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt.trim(), provider, model: aiModel }),
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
                setAiProgress((prev) => [...prev, { phase: data.phase, message: data.message, timestamp: Date.now() }]);
              } else if (currentEvent === "done" || currentEvent === "complete") {
                setName(data.name);
                setDescription(data.description);
                setModel(data.model || "");
                setAllowedTools(data.allowedTools || "");
                setBody(data.body);
                setPendingEvals(data.evals?.length ? data.evals : null);
                setAiReasoning(data.reasoning);
                setMode("manual");
              } else if (currentEvent === "error") {
                setAiError(data.message || data.description || "Unknown error");
                if (data.category) setAiClassifiedError(data as ClassifiedError);
              }
            } catch {
              // skip malformed data
            }
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setAiError((err as Error).message);
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }

  async function handleCreate() {
    setError(null);
    if (!name.trim()) { setError("Skill name is required"); return; }
    if (!description.trim()) { setError("Description is required"); return; }
    if (selectedLayout !== 3 && !effectivePlugin.trim()) { setError("Plugin name is required"); return; }

    setCreating(true);
    try {
      const result = await api.createSkill({
        name: toKebab(name),
        plugin: effectivePlugin || "",
        layout: selectedLayout,
        description,
        model: model || undefined,
        allowedTools: allowedTools || undefined,
        body,
        evals: pendingEvals || undefined,
      });
      onCreated(result.plugin, result.skill);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="px-8 py-6 max-w-4xl animate-fade-in overflow-auto h-full">
      {/* Header with mode toggle */}
      <div className="mb-5">
        <h2 className="text-[20px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Create a New Skill
        </h2>
        <div className="flex items-center justify-between mt-2">
          <div
            className="inline-flex rounded-lg p-0.5"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
          >
            <button
              onClick={() => setMode("manual")}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-200"
              style={{
                background: mode === "manual" ? "var(--surface-4, var(--surface-3))" : "transparent",
                color: mode === "manual" ? "var(--text-primary)" : "var(--text-tertiary)",
                boxShadow: mode === "manual" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                cursor: "pointer",
                border: "none",
              }}
            >
              Manual
            </button>
            <button
              onClick={() => setMode("ai")}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-200"
              style={{
                background: mode === "ai" ? "rgba(168,85,247,0.15)" : "transparent",
                color: mode === "ai" ? "#a855f7" : "var(--text-tertiary)",
                boxShadow: mode === "ai" ? "0 1px 3px rgba(168,85,247,0.15)" : "none",
                cursor: "pointer",
                border: "none",
              }}
            >
              <span className="flex items-center gap-1.5">
                <SparkleIcon size={12} />
                AI-Assisted
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Loading skeleton */}
      {layoutLoading && (
        <div className="space-y-3">
          <div className="skeleton h-10 w-full rounded-lg" />
          <div className="skeleton h-10 w-full rounded-lg" />
        </div>
      )}

      {/* ================================================================= */}
      {/* AI-ASSISTED MODE                                                  */}
      {/* ================================================================= */}
      {!layoutLoading && layout && mode === "ai" && (
        <div className="space-y-4 animate-fade-in">
          {/* Describe your skill */}
          <div className="glass-card p-4">
            <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <div
                className="w-5 h-5 rounded-md flex items-center justify-center"
                style={{ background: "rgba(168,85,247,0.15)" }}
              >
                <SparkleIcon size={11} color="#a855f7" />
              </div>
              Describe Your Skill
            </h3>
            <textarea
              ref={promptRef}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder={"e.g., A skill that helps format SQL queries, optimize them for performance, and explain query execution plans.\n\nInclude any specific behaviors, constraints, or output formats you want."}
              rows={5}
              disabled={generating}
              className="w-full px-3 py-2.5 rounded-lg text-[13px] resize-y"
              style={{ ...inputStyle, minHeight: "120px" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
            <p className="text-[11px] mt-2" style={{ color: "var(--text-tertiary)" }}>
              Describe what the skill should do. The AI will generate the name, description, system prompt, and test cases.
              <span className="ml-1" style={{ color: "var(--text-quaternary, var(--text-tertiary))" }}>Cmd+Enter to generate</span>
            </p>
          </div>

          {/* Progress log during generation */}
          {generating && aiProgress.length > 0 && (
            <ProgressLog entries={aiProgress} isRunning={true} />
          )}

          {/* Error display */}
          {aiError && (
            <div>
              {aiClassifiedError ? (
                <ErrorCard
                  error={aiClassifiedError}
                  onRetry={handleGenerate}
                  onDismiss={() => { setAiError(null); setAiClassifiedError(null); }}
                />
              ) : (
                <div>
                  <div className="px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
                    {aiError}
                  </div>
                  <button
                    onClick={handleGenerate}
                    className="mt-2 text-[12px] font-medium"
                    style={{ color: "#a855f7", background: "none", border: "none", cursor: "pointer" }}
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Generate / Cancel buttons */}
          <div className="flex items-center gap-3">
            {generating ? (
              <button
                onClick={handleCancelGenerate}
                className="px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 flex items-center gap-2"
                style={{ background: "var(--surface-3)", color: "var(--text-secondary)", border: "none", cursor: "pointer" }}
              >
                Cancel Generation
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={!aiPrompt.trim()}
                className="px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 flex items-center gap-2"
                style={{
                  background: !aiPrompt.trim() ? "var(--surface-3)" : "#a855f7",
                  color: !aiPrompt.trim() ? "var(--text-tertiary)" : "#fff",
                  cursor: !aiPrompt.trim() ? "not-allowed" : "pointer",
                  border: "none",
                }}
              >
                <SparkleIcon size={14} />
                {currentModelLabel ? `Generate with ${currentModelLabel}` : "Generate Skill"}
              </button>
            )}
            <button
              onClick={onCancel}
              className="px-4 py-2.5 rounded-lg text-[13px] font-medium"
              style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}
            >
              Cancel
            </button>
            {!generating && (
              <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                or fill in the form manually
                <button
                  onClick={() => setMode("manual")}
                  className="ml-1 font-medium"
                  style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}
                >
                  below
                </button>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MANUAL MODE                                                       */}
      {/* ================================================================= */}
      {!layoutLoading && layout && mode === "manual" && (
        <div className="space-y-4 animate-fade-in">
          {/* AI reasoning banner (shown after generation populates the form) */}
          {aiReasoning && (
            <div
              className="px-4 py-3 rounded-lg text-[12px] animate-fade-in"
              style={{
                background: "rgba(168,85,247,0.08)",
                color: "var(--text-secondary)",
                border: "1px solid rgba(168,85,247,0.2)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: "rgba(168,85,247,0.15)" }}
                  >
                    <SparkleIcon size={11} color="#a855f7" />
                  </div>
                  <div>
                    <span className="font-semibold" style={{ color: "#a855f7" }}>AI Generated</span>
                    <span className="mx-1.5" style={{ color: "var(--text-tertiary)" }}>&mdash;</span>
                    <span>{aiReasoning}</span>
                    {pendingEvals && pendingEvals.length > 0 && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: "rgba(168,85,247,0.12)", color: "#a855f7" }}>
                        +{pendingEvals.length} test cases
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setAiReasoning(null); setPendingEvals(null); }}
                  className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors duration-150"
                  style={{ color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Location */}
          <div className="glass-card p-4">
            <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Location</h3>
            {creatableLayouts.length > 1 && (
              <div className="mb-3">
                <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>Layout</label>
                <div className="flex gap-2">
                  {creatableLayouts.map((l) => (
                    <button
                      key={l.layout}
                      onClick={() => { setSelectedLayout(l.layout as 1 | 2 | 3); setPlugin(l.existingPlugins[0] || ""); setNewPlugin(""); }}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                      style={{
                        background: selectedLayout === l.layout ? "var(--accent)" : "var(--surface-3)",
                        color: selectedLayout === l.layout ? "#fff" : "var(--text-secondary)",
                        border: `1px solid ${selectedLayout === l.layout ? "var(--accent)" : "var(--border-subtle)"}`,
                        cursor: "pointer",
                      }}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {selectedLayout !== 3 && (
              <div className="mb-3">
                <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>Plugin</label>
                <select
                  value={plugin}
                  onChange={(e) => { setPlugin(e.target.value); setNewPlugin(""); }}
                  className="w-full px-3 py-2 rounded-lg text-[13px]"
                  style={inputStyle}
                >
                  {availablePlugins.map((p) => <option key={p} value={p}>{p}</option>)}
                  <option value="__new__">+ New plugin...</option>
                </select>
                {plugin === "__new__" && (
                  <input type="text" value={newPlugin} onChange={(e) => setNewPlugin(toKebab(e.target.value))} placeholder="my-plugin"
                    className="w-full mt-2 px-3 py-2 rounded-lg text-[13px]"
                    style={inputStyle}
                  />
                )}
              </div>
            )}
            <div className="px-3 py-2 rounded-lg text-[11px] font-mono" style={{ background: "var(--surface-0)", color: "var(--text-tertiary)", border: "1px solid var(--border-subtle)" }}>
              {pathPreview}
            </div>
          </div>

          {/* Details */}
          <div className="glass-card p-4">
            <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Skill Details</h3>
            <div className="mb-3">
              <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Name <span style={{ color: "var(--red)" }}>*</span></label>
              <input type="text" value={name} onChange={(e) => setName(toKebab(e.target.value, false))} placeholder="my-skill"
                className="w-full px-3 py-2 rounded-lg text-[13px]"
                style={inputStyle}
              />
            </div>
            <div className="mb-3">
              <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Description <span style={{ color: "var(--red)" }}>*</span></label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" rows={3}
                className="w-full px-3 py-2 rounded-lg text-[13px] resize-y"
                style={{ ...inputStyle, minHeight: "72px" }}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Model</label>
                <select value={model} onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-[13px]"
                  style={inputStyle}
                >
                  <option value="">Any</option>
                  <option value="opus">Opus</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="haiku">Haiku</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Allowed Tools</label>
                <input type="text" value={allowedTools} onChange={(e) => setAllowedTools(e.target.value)} placeholder="Read, Write, Edit..."
                  className="w-full px-3 py-2 rounded-lg text-[13px]"
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          {/* SKILL.md body */}
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
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
                  <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>SKILL.md</span>
                  <span className="text-[11px] ml-2" style={{ color: "var(--text-tertiary)" }}>Skill Definition</span>
                </div>
              </div>
              {/* Write / Preview toggle */}
              <div
                className="flex items-center"
                style={{ background: "var(--surface-2)", borderRadius: 8, padding: 2, gap: 1 }}
              >
                {(["write", "preview"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setBodyViewMode(m)}
                    className="flex items-center gap-1 rounded-md transition-all duration-150"
                    style={{
                      padding: "4px 10px",
                      background: bodyViewMode === m ? "var(--surface-4)" : "transparent",
                      color: bodyViewMode === m ? "var(--text-primary)" : "var(--text-tertiary)",
                      fontSize: 11, fontWeight: bodyViewMode === m ? 600 : 400,
                      border: "none", cursor: "pointer",
                    }}
                  >
                    {m === "write" ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                    <span>{m === "write" ? "Write" : "Preview"}</span>
                  </button>
                ))}
              </div>
            </div>
            {bodyViewMode === "write" ? (
              <textarea value={body} onChange={(e) => setBody(e.target.value)}
                placeholder={"# /my-skill\n\nYou are an expert at...\n"}
                rows={8}
                className="w-full px-3 py-2 rounded-lg text-[13px] font-mono resize-y"
                style={{ ...inputStyle, minHeight: "150px" }}
              />
            ) : (
              <div
                className="text-[13px] leading-relaxed overflow-x-auto rounded-lg px-4 py-3"
                style={{
                  background: "var(--surface-0)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-subtle)",
                  minHeight: "150px",
                  maxHeight: "400px",
                  overflowY: "auto",
                }}
                dangerouslySetInnerHTML={body.trim() ? { __html: renderMarkdown(body) } : undefined}
              >
                {!body.trim() && (
                  <span style={{ color: "var(--text-tertiary)" }}>Start writing to see preview</span>
                )}
              </div>
            )}
          </div>

          {/* Generated test cases preview */}
          {pendingEvals && pendingEvals.length > 0 && (
            <div className="glass-card p-4">
              <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                <SparkleIcon size={13} color="#a855f7" />
                Generated Test Cases
                <span className="text-[11px] font-normal" style={{ color: "var(--text-tertiary)" }}>
                  ({pendingEvals.length} evals will be saved with the skill)
                </span>
              </h3>
              <div className="space-y-2">
                {pendingEvals.map((ev) => (
                  <div
                    key={ev.id}
                    className="px-3 py-2 rounded-lg text-[12px]"
                    style={{ background: "var(--surface-0)", border: "1px solid var(--border-subtle)" }}
                  >
                    <div className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>
                      {ev.name}
                    </div>
                    <div className="text-[11px] mb-1" style={{ color: "var(--text-tertiary)" }}>
                      Prompt: {ev.prompt.length > 120 ? ev.prompt.slice(0, 120) + "..." : ev.prompt}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {ev.assertions.map((a) => (
                        <span
                          key={a.id}
                          className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{ background: "rgba(168,85,247,0.1)", color: "#a855f7" }}
                        >
                          {a.text.length > 50 ? a.text.slice(0, 50) + "..." : a.text}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleCreate}
              disabled={creating || !name || !description}
              className="px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150"
              style={{
                background: creating || !name || !description ? "var(--surface-3)" : "var(--accent)",
                color: creating || !name || !description ? "var(--text-tertiary)" : "#fff",
                cursor: creating || !name || !description ? "not-allowed" : "pointer",
                border: "none",
              }}
            >
              {creating ? "Creating..." : "Create Skill"}
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2.5 rounded-lg text-[13px] font-medium"
              style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
