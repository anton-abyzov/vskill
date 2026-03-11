import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { ConfigResponse } from "../api";
import type { ProjectLayoutResponse, DetectedLayout, SkillCreatorStatus, GeneratedEval } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toKebab(s: string, trim = true): string {
  let r = s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (trim) r = r.replace(/^-+|-+$/g, "");
  return r;
}

function resolvePathPreview(
  root: string,
  layout: 1 | 2 | 3,
  plugin: string,
  name: string,
): string {
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

export function CreateSkillPage() {
  const navigate = useNavigate();

  // Mode toggle
  const [mode, setMode] = useState<"manual" | "ai">("manual");

  // Layout detection
  const [layout, setLayout] = useState<ProjectLayoutResponse | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(true);

  // Config (providers/models)
  const [config, setConfig] = useState<ConfigResponse | null>(null);

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

  // Submission
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI generation state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiProvider, setAiProvider] = useState("claude-cli");
  const [aiModel, setAiModel] = useState("sonnet");
  const [generating, setGenerating] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Load layout + config on mount
  useEffect(() => {
    api.getProjectLayout()
      .then((l) => {
        setLayout(l);
        setSelectedLayout(l.suggestedLayout);
        const suggested = l.detectedLayouts.find((d) => d.layout === l.suggestedLayout);
        if (suggested?.existingPlugins.length) {
          setPlugin(suggested.existingPlugins[0]);
        }
      })
      .catch(() => {})
      .finally(() => setLayoutLoading(false));

    api.getConfig().then((c) => {
      setConfig(c);
      const hasCli = c.providers.find((p) => p.id === "claude-cli" && p.available);
      if (hasCli) {
        setAiProvider("claude-cli");
        setAiModel("sonnet");
      }
    }).catch(() => {});
  }, []);

  // Auto-focus prompt when switching to AI mode
  useEffect(() => {
    if (mode === "ai") promptRef.current?.focus();
  }, [mode]);

  // Available plugins for selected layout
  const availablePlugins = useMemo(() => {
    if (!layout) return [];
    const layoutEntry = layout.detectedLayouts.find((d) => d.layout === selectedLayout);
    return layoutEntry?.existingPlugins || [];
  }, [layout, selectedLayout]);

  // Effective plugin (dropdown or free text for new)
  const effectivePlugin = plugin === "__new__" ? newPlugin : plugin;

  // Path preview
  const pathPreview = layout
    ? resolvePathPreview(layout.root, selectedLayout, effectivePlugin || "{plugin}", name || "{skill}")
    : "";

  // Creatable layouts (exclude layout 4)
  const creatableLayouts = useMemo(() => {
    if (!layout) return [];
    return layout.detectedLayouts.filter((d): d is DetectedLayout & { layout: 1 | 2 | 3 } => d.layout !== 4);
  }, [layout]);

  // SKILL.md preview
  const skillMdPreview = useMemo(() => {
    const lines: string[] = ["---"];
    if (description) lines.push(`description: "${description.replace(/"/g, '\\"')}"`);
    else lines.push('description: ""');
    if (allowedTools.trim()) lines.push(`allowed-tools: ${allowedTools.trim()}`);
    if (model) lines.push(`model: ${model}`);
    lines.push("---");
    lines.push("");
    if (body.trim()) {
      lines.push(body.trim());
    } else {
      lines.push(`# /${name || "skill-name"}`);
      lines.push("");
      lines.push("You are a helpful assistant.");
    }
    return lines.join("\n");
  }, [name, description, model, allowedTools, body]);

  // Provider info for AI model picker
  const aiProviderInfo = config?.providers.find((p) => p.id === aiProvider && p.available);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleGenerate() {
    setAiError(null);
    setAiReasoning(null);
    if (!aiPrompt.trim()) { setAiError("Describe what your skill should do"); return; }

    setGenerating(true);
    try {
      const result = await api.generateSkill({
        prompt: aiPrompt.trim(),
        provider: aiProvider,
        model: aiModel,
      });
      // Populate form fields with AI output
      setName(result.name);
      setDescription(result.description);
      setModel(result.model);
      setAllowedTools(result.allowedTools);
      setBody(result.body);
      setPendingEvals(result.evals?.length ? result.evals : null);
      setAiReasoning(result.reasoning);
      // Switch to manual mode so user can review/edit
      setMode("manual");
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setGenerating(false);
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
      navigate(`/skills/${result.plugin}/${result.skill}`);
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
    <div className="px-10 py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-[12px] mb-3" style={{ color: "var(--text-tertiary)" }}>
          <Link to="/" className="hover:underline" style={{ color: "var(--text-tertiary)" }}>Skills</Link>
          <span>/</span>
          <span style={{ color: "var(--text-secondary)" }}>New Skill</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
              Create a New Skill
            </h2>
            <p className="text-[13px] mt-1" style={{ color: "var(--text-tertiary)" }}>
              Define your skill's metadata, content, and placement
            </p>
          </div>

          {/* Mode toggle */}
          <div
            className="inline-flex rounded-lg p-1"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
          >
            <button
              onClick={() => setMode("manual")}
              className="px-4 py-2 rounded-md text-[13px] font-medium transition-all duration-200"
              style={{
                background: mode === "manual" ? "var(--surface-4, var(--surface-3))" : "transparent",
                color: mode === "manual" ? "var(--text-primary)" : "var(--text-tertiary)",
                boxShadow: mode === "manual" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              Manual
            </button>
            <button
              onClick={() => setMode("ai")}
              className="px-4 py-2 rounded-md text-[13px] font-medium transition-all duration-200"
              style={{
                background: mode === "ai" ? "rgba(168,85,247,0.15)" : "transparent",
                color: mode === "ai" ? "#a855f7" : "var(--text-tertiary)",
                boxShadow: mode === "ai" ? "0 1px 3px rgba(168,85,247,0.15)" : "none",
              }}
            >
              <span className="flex items-center gap-1.5">
                <SparkleIcon size={14} />
                AI-Assisted
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {layoutLoading && (
        <div className="space-y-3">
          <div className="skeleton h-10 w-full rounded-lg" />
          <div className="skeleton h-10 w-full rounded-lg" />
          <div className="skeleton h-10 w-full rounded-lg" />
        </div>
      )}

      {/* ================================================================= */}
      {/* AI-ASSISTED MODE                                                  */}
      {/* ================================================================= */}
      {!layoutLoading && layout && mode === "ai" && (
        <div className="flex gap-6 animate-fade-in">
          {/* Left: AI prompt panel */}
          <div className="flex-1 min-w-0 space-y-5">
            {/* Describe your skill */}
            <div className="glass-card p-5">
              <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center"
                  style={{ background: "rgba(168,85,247,0.15)" }}
                >
                  <SparkleIcon size={13} color="#a855f7" />
                </div>
                Describe Your Skill
              </h3>
              <textarea
                ref={promptRef}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={"e.g., A skill that helps format SQL queries, optimize them for performance, and explain query execution plans.\n\nInclude any specific behaviors, constraints, or output formats you want."}
                rows={6}
                disabled={generating}
                className="w-full px-3 py-2.5 rounded-lg text-[13px] resize-y"
                style={{
                  ...inputStyle,
                  minHeight: "140px",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
              />
              <p className="text-[11px] mt-2" style={{ color: "var(--text-tertiary)" }}>
                Describe what the skill should do, who it's for, and any specific behaviors.
                The AI will generate the name, description, system prompt, and test cases following the Skill Builder methodology.
                <span className="ml-1" style={{ color: "var(--text-quaternary, var(--text-tertiary))" }}>Cmd+Enter to generate</span>
              </p>
            </div>

            {/* Provider + Model row */}
            <div className="glass-card p-5">
              <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
                Generation Model
              </h3>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>
                    Provider
                  </label>
                  <select
                    value={aiProvider}
                    onChange={(e) => {
                      setAiProvider(e.target.value);
                      const p = config?.providers.find((p) => p.id === e.target.value);
                      if (p?.models[0]) setAiModel(p.models[0].id);
                    }}
                    disabled={generating}
                    className="w-full px-3 py-2 rounded-lg text-[13px]"
                    style={inputStyle}
                  >
                    {config?.providers.filter((p) => p.available).map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>
                    Model
                  </label>
                  <select
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    disabled={generating}
                    className="w-full px-3 py-2 rounded-lg text-[13px]"
                    style={inputStyle}
                  >
                    {aiProviderInfo?.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Error */}
            {aiError && (
              <div className="px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
                {aiError}
              </div>
            )}

            {/* Generate button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleGenerate}
                disabled={generating || !aiPrompt.trim()}
                className="px-6 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 flex items-center gap-2"
                style={{
                  background: generating || !aiPrompt.trim() ? "var(--surface-3)" : "#a855f7",
                  color: generating || !aiPrompt.trim() ? "var(--text-tertiary)" : "#fff",
                  cursor: generating || !aiPrompt.trim() ? "not-allowed" : "pointer",
                  opacity: generating ? 0.8 : 1,
                }}
              >
                {generating ? (
                  <><div className="spinner" style={{ borderTopColor: "#fff", borderColor: "rgba(255,255,255,0.2)", width: 14, height: 14, borderWidth: 1.5 }} /> Generating...</>
                ) : (
                  <><SparkleIcon size={14} /> Generate Skill</>
                )}
              </button>
              <Link
                to="/"
                className="px-4 py-2.5 rounded-lg text-[13px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Cancel
              </Link>
            </div>
          </div>

          {/* Right: Preview */}
          <div className="w-[340px] flex-shrink-0">
            <div className="sticky top-8">
              <div className="glass-card p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-tertiary)" }}>
                  SKILL.md Preview
                </h3>
                <pre
                  className="text-[11px] font-mono leading-relaxed overflow-auto max-h-[500px] p-3 rounded-lg"
                  style={{
                    background: "var(--surface-0)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-subtle)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {skillMdPreview}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MANUAL MODE (+ AI-generated review)                               */}
      {/* ================================================================= */}
      {!layoutLoading && layout && mode === "manual" && (
        <div className="animate-fade-in">
          {/* AI reasoning banner (shown after generation populates the form) */}
          {aiReasoning && (
            <div
              className="mb-5 px-4 py-3 rounded-lg text-[12px] animate-fade-in"
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
                  style={{ color: "var(--text-tertiary)" }}
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

          <div className="flex gap-6">
            {/* Left: Form */}
            <div className="flex-1 min-w-0 space-y-5">
              {/* Location section */}
              <div className="glass-card p-5">
                <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
                  Location
                </h3>

                {/* Layout selector */}
                {creatableLayouts.length > 1 && (
                  <div className="mb-4">
                    <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>
                      Layout
                    </label>
                    <div className="flex gap-2">
                      {creatableLayouts.map((l) => (
                        <button
                          key={l.layout}
                          onClick={() => {
                            setSelectedLayout(l.layout as 1 | 2 | 3);
                            const firstPlugin = l.existingPlugins[0];
                            setPlugin(firstPlugin || "");
                            setNewPlugin("");
                          }}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                          style={{
                            background: selectedLayout === l.layout ? "var(--accent)" : "var(--surface-3)",
                            color: selectedLayout === l.layout ? "#fff" : "var(--text-secondary)",
                            border: `1px solid ${selectedLayout === l.layout ? "var(--accent)" : "var(--border-subtle)"}`,
                          }}
                        >
                          {l.label}
                        </button>
                      ))}
                      {/* Also offer layouts that don't exist yet */}
                      {!creatableLayouts.find((l) => l.layout === 3) && (
                        <button
                          onClick={() => { setSelectedLayout(3); setPlugin(""); }}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                          style={{
                            background: selectedLayout === 3 ? "var(--accent)" : "var(--surface-3)",
                            color: selectedLayout === 3 ? "#fff" : "var(--text-secondary)",
                            border: `1px solid ${selectedLayout === 3 ? "var(--accent)" : "var(--border-subtle)"}`,
                          }}
                        >
                          Root skills/
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Plugin selector (for layout 1 & 2) */}
                {selectedLayout !== 3 && (
                  <div className="mb-4">
                    <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>
                      Plugin
                    </label>
                    <select
                      value={plugin}
                      onChange={(e) => { setPlugin(e.target.value); setNewPlugin(""); }}
                      className="w-full px-3 py-2 rounded-lg text-[13px]"
                      style={inputStyle}
                    >
                      {availablePlugins.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                      <option value="__new__">+ New plugin...</option>
                    </select>
                    {plugin === "__new__" && (
                      <input
                        type="text"
                        value={newPlugin}
                        onChange={(e) => setNewPlugin(toKebab(e.target.value))}
                        placeholder="my-plugin"
                        className="w-full mt-2 px-3 py-2 rounded-lg text-[13px]"
                        style={inputStyle}
                      />
                    )}
                  </div>
                )}

                {/* Path preview */}
                <div className="px-3 py-2 rounded-lg text-[11px] font-mono" style={{
                  background: "var(--surface-0)",
                  color: "var(--text-tertiary)",
                  border: "1px solid var(--border-subtle)",
                }}>
                  {pathPreview}
                </div>
              </div>

              {/* Skill details */}
              <div className="glass-card p-5">
                <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
                  Skill Details
                </h3>

                {/* Name */}
                <div className="mb-4">
                  <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>
                    Name <span style={{ color: "var(--red)" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(toKebab(e.target.value, false))}
                    placeholder="my-skill"
                    className="w-full px-3 py-2 rounded-lg text-[13px]"
                    style={inputStyle}
                  />
                </div>

                {/* Description */}
                <div className="mb-4">
                  <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>
                    Description <span style={{ color: "var(--red)" }}>*</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description — used for auto-activation keywords"
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg text-[13px] resize-none"
                    style={inputStyle}
                  />
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>
                    This text is used by Claude to decide when to activate the skill
                  </p>
                </div>

                {/* Model + Allowed tools (side by side) */}
                <div className="flex gap-4 mb-4">
                  <div className="flex-1">
                    <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>
                      Model
                    </label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-[13px]"
                      style={inputStyle}
                    >
                      <option value="">Any (default)</option>
                      <option value="opus">Opus</option>
                      <option value="sonnet">Sonnet</option>
                      <option value="haiku">Haiku</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>
                      Allowed Tools
                    </label>
                    <input
                      type="text"
                      value={allowedTools}
                      onChange={(e) => setAllowedTools(e.target.value)}
                      placeholder="Read, Write, Edit, Bash, Glob, Grep"
                      className="w-full px-3 py-2 rounded-lg text-[13px]"
                      style={inputStyle}
                    />
                  </div>
                </div>
              </div>

              {/* System prompt body */}
              <div className="glass-card p-5">
                <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
                  System Prompt
                </h3>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={"# /my-skill\n\nYou are an expert at...\n\n## Workflow\n\n1. First, understand the request\n2. Then, implement the solution\n3. Finally, verify the result"}
                  rows={12}
                  className="w-full px-3 py-2 rounded-lg text-[13px] font-mono resize-y"
                  style={{
                    ...inputStyle,
                    minHeight: "200px",
                  }}
                />
              </div>

              {/* Generated test cases preview */}
              {pendingEvals && pendingEvals.length > 0 && (
                <div className="glass-card p-5">
                  <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                    <SparkleIcon size={13} color="#a855f7" />
                    Generated Test Cases
                    <span className="text-[11px] font-normal" style={{ color: "var(--text-tertiary)" }}>
                      ({pendingEvals.length} evals will be saved with the skill)
                    </span>
                  </h3>
                  <div className="space-y-2.5">
                    {pendingEvals.map((ev) => (
                      <div
                        key={ev.id}
                        className="px-3 py-2.5 rounded-lg text-[12px]"
                        style={{ background: "var(--surface-0)", border: "1px solid var(--border-subtle)" }}
                      >
                        <div className="font-medium mb-1" style={{ color: "var(--text-primary)" }}>
                          {ev.name}
                        </div>
                        <div className="text-[11px] mb-1.5" style={{ color: "var(--text-tertiary)" }}>
                          Prompt: {ev.prompt.length > 120 ? ev.prompt.slice(0, 120) + "..." : ev.prompt}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
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

              {/* Error */}
              {error && (
                <div className="px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCreate}
                  disabled={creating || !name || !description}
                  className="px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150"
                  style={{
                    background: creating || !name || !description ? "var(--surface-3)" : "var(--accent)",
                    color: creating || !name || !description ? "var(--text-tertiary)" : "#fff",
                    cursor: creating || !name || !description ? "not-allowed" : "pointer",
                    opacity: creating ? 0.7 : 1,
                  }}
                >
                  {creating ? "Creating..." : "Create Skill"}
                </button>
                <Link
                  to="/"
                  className="px-4 py-2.5 rounded-lg text-[13px] font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Cancel
                </Link>
              </div>
            </div>

            {/* Right: Preview */}
            <div className="w-[340px] flex-shrink-0">
              <div className="sticky top-8">
                <div className="glass-card p-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-tertiary)" }}>
                    SKILL.md Preview
                  </h3>
                  <pre
                    className="text-[11px] font-mono leading-relaxed overflow-auto max-h-[500px] p-3 rounded-lg"
                    style={{
                      background: "var(--surface-0)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-subtle)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {skillMdPreview}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
