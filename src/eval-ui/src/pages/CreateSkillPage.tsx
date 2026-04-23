import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCreateSkill, toKebab } from "../hooks/useCreateSkill";
import { useConfig } from "../ConfigContext";
import { ProgressLog } from "../components/ProgressLog";
import { ErrorCard } from "../components/ErrorCard";
import { renderMarkdown } from "../utils/renderMarkdown";
import { SkillFileTree } from "../components/SkillFileTree";
import { AgentSelector } from "../components/AgentSelector";
import type { InstalledAgentEntry } from "../components/AgentSelector";
import {
  readStudioPreferences,
  writeStudioPreference,
} from "../hooks/useStudioPreferences";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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
  const { config } = useConfig();

  // ---------------------------------------------------------------------------
  // 0678 — Source-model picker state
  //
  // The Create page renders an explicit Provider+Model dropdown. The selection
  // is persisted to STUDIO_PREFS_KEY under `skillGenModel` so it sticks across
  // reloads AND tabs (via the `storage` event). Defaults are { claude-cli,
  // sonnet } exactly when no persisted selection exists — matching the
  // server-side legacy default for back-compat.
  //
  // TODO(0678): extract <ProviderModelPicker> — shared with ComparisonPage
  // (see ADR-0678-02 — deferred until both usage sites stabilize).
  // ---------------------------------------------------------------------------
  const [aiProvider, setAiProvider] = useState("claude-cli");
  const [aiModel, setAiModel] = useState("sonnet");
  const [usingPersistedSelection, setUsingPersistedSelection] = useState(false);
  const [revertedToast, setRevertedToast] = useState<{ provider: string; model: string } | null>(null);
  // Track whether we have hydrated the picker from config yet — the first
  // pass is purely a hydration effect and must not write back to storage.
  const hydratedRef = useRef(false);

  // Installed agents list (loaded from API)
  const [installedAgents, setInstalledAgents] = useState<InstalledAgentEntry[]>([]);

  // Load installed agents from API
  useEffect(() => {
    fetch("/api/agents/installed")
      .then((r) => r.json())
      .then((data) => {
        if (data.agents) setInstalledAgents(data.agents);
      })
      .catch(() => {});
  }, []);

  // Hydrate provider/model from persisted preferences the moment config is
  // available. If the persisted provider is no longer detected (or the model
  // it pinned is gone) we revert to the default pair and raise a toast — the
  // persisted value is not cleared (it becomes usable again when the provider
  // returns; see plan.md §5).
  useEffect(() => {
    if (!config) return;
    const availableProviders = config.providers.filter((p) => p.available);
    const persisted = readStudioPreferences().skillGenModel;

    // If no providers are available at all, leave defaults — the picker will
    // render disabled (AC-US1-04).
    if (availableProviders.length === 0) {
      hydratedRef.current = true;
      return;
    }

    if (
      persisted &&
      typeof persisted === "object" &&
      typeof persisted.provider === "string" &&
      typeof persisted.model === "string"
    ) {
      const match = availableProviders.find((p) => p.id === persisted.provider);
      const modelOk = match?.models.some((m) => m.id === persisted.model);
      if (match && modelOk) {
        setAiProvider(persisted.provider);
        setAiModel(persisted.model);
        setUsingPersistedSelection(true);
        hydratedRef.current = true;
        return;
      }
      // Persisted selection references a provider/model not currently
      // detected → fall back to default + one-time toast (AC-US1-05).
      setRevertedToast({ provider: persisted.provider, model: persisted.model });
    }

    // Default path: prefer claude-cli/sonnet when available; otherwise pick the
    // first available provider's first model id.
    const cli = availableProviders.find((p) => p.id === "claude-cli");
    if (cli) {
      setAiProvider("claude-cli");
      setAiModel("sonnet");
    } else {
      const first = availableProviders[0];
      setAiProvider(first.id);
      setAiModel(first.models[0]?.id ?? "");
    }
    setUsingPersistedSelection(false);
    hydratedRef.current = true;
  }, [config]);

  // Cross-tab propagation (AC-US3-02): when another tab writes skillGenModel,
  // re-hydrate this tab's picker.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && !e.key.includes("vskill.studio.prefs")) return;
      const prefs = readStudioPreferences();
      const next = prefs.skillGenModel;
      if (
        next &&
        typeof next === "object" &&
        typeof next.provider === "string" &&
        typeof next.model === "string"
      ) {
        setAiProvider(next.provider);
        setAiModel(next.model);
        setUsingPersistedSelection(true);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Persist selection changes — but only AFTER the initial hydration pass, so
  // a mount with no prior preference doesn't spuriously write the default
  // values and cause the "Default" caption to disappear on reload.
  const writePersistedSelection = useCallback((provider: string, model: string) => {
    writeStudioPreference("skillGenModel", { provider, model });
    setUsingPersistedSelection(true);
  }, []);

  const resolveAiConfigOverride = useCallback(() => {
    return { provider: aiProvider, model: aiModel };
  }, [aiProvider, aiModel]);

  const sk = useCreateSkill({
    onCreated: (plugin, skill) => navigate(`/skills/${plugin}/${skill}`),
    resolveAiConfigOverride,
  });

  // Provider info for AI model picker
  const aiProviderInfo = config?.providers.find((p) => p.id === aiProvider && p.available);

  // SKILL.md preview (page-specific sidebar feature)
  const skillMdPreview = useMemo(() => {
    const lines: string[] = ["---"];
    if (sk.description) lines.push(`description: "${sk.description.replace(/"/g, '\\"')}"`);
    else lines.push('description: ""');
    if (sk.allowedTools.trim()) lines.push(`allowed-tools: ${sk.allowedTools.trim()}`);
    if (sk.model) lines.push(`model: ${sk.model}`);
    if (sk.targetAgents.length > 0) lines.push(`target-agents: ${sk.targetAgents.join(", ")}`);
    lines.push("---");
    lines.push("");
    if (sk.body.trim()) {
      lines.push(sk.body.trim());
    } else {
      lines.push(`# /${sk.name || "skill-name"}`);
      lines.push("");
      lines.push("You are a helpful assistant.");
    }
    return lines.join("\n");
  }, [sk.name, sk.description, sk.model, sk.allowedTools, sk.body]);

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
              onClick={() => sk.setMode("ai")}
              className="px-4 py-2 rounded-md text-[13px] font-medium transition-all duration-200"
              style={{
                background: sk.mode === "ai" ? "var(--purple-muted)" : "transparent",
                color: sk.mode === "ai" ? "var(--purple)" : "var(--text-tertiary)",
                // eslint-disable-next-line vskill/no-raw-color -- intentional: toggle elevation shadow is alpha-only
                boxShadow: sk.mode === "ai" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              <span className="flex items-center gap-1.5">
                <SparkleIcon size={14} />
                AI-Assisted
              </span>
            </button>
            <button
              onClick={() => sk.setMode("manual")}
              className="px-4 py-2 rounded-md text-[13px] font-medium transition-all duration-200"
              style={{
                background: sk.mode === "manual" ? "var(--surface-4, var(--surface-3))" : "transparent",
                color: sk.mode === "manual" ? "var(--text-primary)" : "var(--text-tertiary)",
                // eslint-disable-next-line vskill/no-raw-color -- intentional: toggle elevation shadow is alpha-only
                boxShadow: sk.mode === "manual" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              Manual
            </button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {sk.layoutLoading && (
        <div className="space-y-3">
          <div className="skeleton h-10 w-full rounded-lg" />
          <div className="skeleton h-10 w-full rounded-lg" />
          <div className="skeleton h-10 w-full rounded-lg" />
        </div>
      )}

      {/* ================================================================= */}
      {/* AI-ASSISTED MODE                                                  */}
      {/* ================================================================= */}
      {!sk.layoutLoading && sk.layout && sk.mode === "ai" && (
        <div className="flex gap-6 animate-fade-in">
          {/* Left: AI prompt panel */}
          <div className="flex-1 min-w-0 space-y-5">
            {/* Describe your skill */}
            <div className="glass-card p-5">
              <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center"
                  style={{ background: "var(--purple-muted)" }}
                >
                  <SparkleIcon size={13} color="var(--purple)" />
                </div>
                Describe Your Skill
              </h3>
              <textarea
                ref={sk.promptRef}
                value={sk.aiPrompt}
                onChange={(e) => sk.setAiPrompt(e.target.value)}
                placeholder={"e.g., A skill that helps format SQL queries, optimize them for performance, and explain query execution plans.\n\nInclude any specific behaviors, constraints, or output formats you want."}
                rows={6}
                disabled={sk.generating}
                className="w-full px-3 py-2.5 rounded-lg text-[13px] resize-y"
                style={{
                  ...inputStyle,
                  minHeight: "140px",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    sk.handleGenerate();
                  }
                }}
              />
              <p className="text-[11px] mt-2" style={{ color: "var(--text-quaternary, var(--text-tertiary))" }}>
                Cmd+Enter to generate
              </p>
            </div>

            {/* Provider + Model row — 0678 source-model picker */}
            <div className="glass-card p-5">
              <h3 className="text-[13px] font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                <span>Source Model</span>
                {!usingPersistedSelection && aiProvider === "claude-cli" && aiModel === "sonnet" && (
                  <span
                    className="text-[10px] font-normal uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ color: "var(--text-tertiary)", background: "var(--surface-2)" }}
                  >
                    Default
                  </span>
                )}
              </h3>

              {/* AC-US1-05 — one-time non-modal toast when the persisted
                  selection references an unavailable provider/model. */}
              {revertedToast && (
                <div
                  role="status"
                  className="mb-3 px-3 py-2 rounded-lg text-[12px] flex items-center justify-between gap-3"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <span>
                    Previous selection <code>{revertedToast.provider}/{revertedToast.model}</code> unavailable — reverted to default.
                  </span>
                  <button
                    onClick={() => setRevertedToast(null)}
                    className="text-[11px]"
                    style={{ color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer" }}
                    aria-label="Dismiss notice"
                  >
                    ✕
                  </button>
                </div>
              )}

              <div
                className="flex gap-4"
                title={
                  !aiProviderInfo
                    ? "Install a provider (Ollama / LM Studio / OpenRouter) or run `claude login` to enable model selection."
                    : undefined
                }
              >
                <div className="flex-1">
                  <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>
                    Provider
                  </label>
                  <select
                    value={aiProvider}
                    onChange={(e) => {
                      const nextProvider = e.target.value;
                      setAiProvider(nextProvider);
                      const p = config?.providers.find((p) => p.id === nextProvider);
                      const nextModel = p?.models[0]?.id ?? aiModel;
                      if (p?.models[0]) setAiModel(nextModel);
                      writePersistedSelection(nextProvider, nextModel);
                    }}
                    disabled={sk.generating || !aiProviderInfo}
                    title={
                      !aiProviderInfo
                        ? "Install a provider (Ollama / LM Studio / OpenRouter) or run `claude login` to enable model selection."
                        : undefined
                    }
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
                    onChange={(e) => {
                      const nextModel = e.target.value;
                      setAiModel(nextModel);
                      writePersistedSelection(aiProvider, nextModel);
                    }}
                    disabled={sk.generating || !aiProviderInfo}
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

            {/* Target Agents (optional) */}
            {installedAgents.length > 0 && (
              <div className="glass-card p-5">
                <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
                  Target Agents
                  <span className="text-[11px] font-normal ml-2" style={{ color: "var(--text-tertiary)" }}>
                    (optional — leave empty for Claude Code default)
                  </span>
                </h3>
                <AgentSelector
                  agents={installedAgents}
                  selectedIds={sk.targetAgents}
                  onChange={sk.setTargetAgents}
                />
              </div>
            )}

            {/* Progress log during generation */}
            {sk.generating && sk.aiProgress.length > 0 && (
              <div>
                <ProgressLog entries={sk.aiProgress} isRunning={true} />
              </div>
            )}

            {/* Error */}
            {sk.aiError && (
              <div>
                {sk.aiClassifiedError ? (
                  <ErrorCard
                    error={sk.aiClassifiedError}
                    onRetry={sk.handleGenerate}
                    onDismiss={sk.clearAiError}
                  />
                ) : (
                  <div className="px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid var(--red-muted)" }}>
                    {sk.aiError}
                  </div>
                )}
              </div>
            )}

            {/* Generate button */}
            <div className="flex items-center gap-3">
              {sk.generating ? (
                <button
                  onClick={sk.handleCancelGenerate}
                  className="px-6 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 flex items-center gap-2"
                  style={{ background: "var(--surface-3)", color: "var(--text-secondary)" }}
                >
                  Cancel Generation
                </button>
              ) : (
                <button
                  onClick={sk.handleGenerate}
                  disabled={!sk.aiPrompt.trim()}
                  className="px-6 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 flex items-center gap-2"
                  style={{
                    background: !sk.aiPrompt.trim() ? "var(--surface-3)" : "var(--purple)",
                    color: !sk.aiPrompt.trim() ? "var(--text-tertiary)" : "var(--color-paper)",
                    cursor: !sk.aiPrompt.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  <SparkleIcon size={14} /> Generate Skill
                </button>
              )}
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
      {!sk.layoutLoading && sk.layout && sk.mode === "manual" && (
        <div className="animate-fade-in">
          <div className="flex gap-6">
            {/* Left: Form */}
            <div className="flex-1 min-w-0 space-y-5">
              {/* Location section */}
              <div className="glass-card p-5">
                <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
                  Location
                </h3>

                {/* Layout selector */}
                {sk.creatableLayouts.length > 1 && (
                  <div className="mb-4">
                    <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>
                      Layout
                    </label>
                    <div className="flex gap-2">
                      {sk.creatableLayouts.map((l) => (
                        <button
                          key={l.layout}
                          onClick={() => {
                            sk.setSelectedLayout(l.layout as 1 | 2 | 3);
                            const firstPlugin = l.existingPlugins[0];
                            sk.setPlugin(firstPlugin || "");
                            sk.setNewPlugin("");
                          }}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                          style={{
                            background: sk.selectedLayout === l.layout ? "var(--accent)" : "var(--surface-3)",
                            color: sk.selectedLayout === l.layout ? "var(--color-paper)" : "var(--text-secondary)",
                            border: `1px solid ${sk.selectedLayout === l.layout ? "var(--accent)" : "var(--border-subtle)"}`,
                          }}
                        >
                          {l.label}
                        </button>
                      ))}
                      {/* Also offer layouts that don't exist yet */}
                      {!sk.creatableLayouts.find((l) => l.layout === 3) && (
                        <button
                          onClick={() => { sk.setSelectedLayout(3); sk.setPlugin(""); }}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                          style={{
                            background: sk.selectedLayout === 3 ? "var(--accent)" : "var(--surface-3)",
                            color: sk.selectedLayout === 3 ? "var(--color-paper)" : "var(--text-secondary)",
                            border: `1px solid ${sk.selectedLayout === 3 ? "var(--accent)" : "var(--border-subtle)"}`,
                          }}
                        >
                          Root skills/
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Plugin selector (for layout 1 & 2) */}
                {sk.selectedLayout !== 3 && (
                  <div className="mb-4">
                    <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>
                      Plugin
                    </label>
                    <select
                      value={sk.plugin}
                      onChange={(e) => { sk.setPlugin(e.target.value); sk.setNewPlugin(""); }}
                      className="w-full px-3 py-2 rounded-lg text-[13px]"
                      style={inputStyle}
                    >
                      {sk.availablePlugins.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                      <option value="__new__">+ New plugin...</option>
                    </select>
                    {sk.plugin === "__new__" && (
                      <input
                        type="text"
                        value={sk.newPlugin}
                        onChange={(e) => sk.setNewPlugin(toKebab(e.target.value))}
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
                  {sk.pathPreview}
                </div>
              </div>

              {/* Plugin recommendation */}
              {sk.showPluginRecommendation && sk.pluginLayoutInfo && sk.selectedLayout === 3 && (
                <div
                  className="px-4 py-3 rounded-lg text-[12px] animate-fade-in flex items-center justify-between gap-3"
                  style={{
                    background: "var(--accent-muted)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--accent-muted)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <span>
                      Plugins detected (<strong>{sk.pluginLayoutInfo.plugins.slice(0, 3).join(", ")}</strong>).
                      Add this skill to a plugin for better organization.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={sk.applyPluginRecommendation}
                      className="px-3 py-1 rounded-md text-[11px] font-medium"
                      style={{ background: "var(--accent)", color: "var(--color-paper)", border: "none", cursor: "pointer" }}
                    >
                      Use plugin
                    </button>
                    <button
                      onClick={() => sk.setShowPluginRecommendation(false)}
                      className="w-5 h-5 rounded flex items-center justify-center"
                      style={{ color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer" }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

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
                    value={sk.name}
                    onChange={(e) => sk.setName(toKebab(e.target.value, false))}
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
                    value={sk.description}
                    onChange={(e) => sk.setDescription(e.target.value)}
                    placeholder="Brief description — used for auto-activation keywords"
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg text-[13px] resize-y"
                    style={{ ...inputStyle, minHeight: "72px" }}
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
                      value={sk.model}
                      onChange={(e) => sk.setModel(e.target.value)}
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
                      value={sk.allowedTools}
                      onChange={(e) => sk.setAllowedTools(e.target.value)}
                      placeholder="Read, Write, Edit, Bash, Glob, Grep"
                      className="w-full px-3 py-2 rounded-lg text-[13px]"
                      style={inputStyle}
                    />
                  </div>
                </div>
              </div>

              {/* SKILL.md body */}
              <div className="glass-card p-5">
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
                        onClick={() => sk.setBodyViewMode(m)}
                        className="flex items-center gap-1 rounded-md transition-all duration-150"
                        style={{
                          padding: "4px 10px",
                          background: sk.bodyViewMode === m ? "var(--surface-4)" : "transparent",
                          color: sk.bodyViewMode === m ? "var(--text-primary)" : "var(--text-tertiary)",
                          fontSize: 11, fontWeight: sk.bodyViewMode === m ? 600 : 400,
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
                {sk.bodyViewMode === "write" ? (
                  <textarea
                    value={sk.body}
                    onChange={(e) => sk.setBody(e.target.value)}
                    placeholder={"# /my-skill\n\nYou are an expert at...\n\n## Workflow\n\n1. First, understand the request\n2. Then, implement the solution\n3. Finally, verify the result"}
                    rows={12}
                    className="w-full px-3 py-2 rounded-lg text-[13px] font-mono resize-y"
                    style={{ ...inputStyle, minHeight: "200px" }}
                  />
                ) : sk.body.trim() ? (
                  <div
                    className="text-[13px] leading-relaxed overflow-x-auto rounded-lg px-4 py-3"
                    style={{
                      background: "var(--surface-0)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-subtle)",
                      minHeight: "200px",
                      maxHeight: "400px",
                      overflowY: "auto",
                    }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(sk.body) }}
                  />
                ) : (
                  <div
                    className="text-[13px] leading-relaxed overflow-x-auto rounded-lg px-4 py-3"
                    style={{
                      background: "var(--surface-0)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-subtle)",
                      minHeight: "200px",
                      maxHeight: "400px",
                      overflowY: "auto",
                    }}
                  >
                    <span style={{ color: "var(--text-tertiary)" }}>Start writing to see preview</span>
                  </div>
                )}
              </div>

              {/* Skill folder structure visualization */}
              <SkillFileTree
                skillName={sk.name || "{skill}"}
                hasEvals={false}
                isDraft={sk.draftSaved}
              />

              {/* Error */}
              {sk.error && (
                <div className="px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid var(--red-muted)" }}>
                  {sk.error}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={sk.handleCreate}
                  disabled={sk.creating || !sk.name || !sk.description}
                  className="px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150"
                  style={{
                    background: sk.creating || !sk.name || !sk.description ? "var(--surface-3)" : "var(--accent)",
                    color: sk.creating || !sk.name || !sk.description ? "var(--text-tertiary)" : "var(--color-paper)",
                    cursor: sk.creating || !sk.name || !sk.description ? "not-allowed" : "pointer",
                    opacity: sk.creating ? 0.7 : 1,
                  }}
                >
                  {sk.creating ? "Creating..." : "Create Skill"}
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
