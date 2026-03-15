import { useCreateSkill, toKebab } from "../hooks/useCreateSkill";
import { ProgressLog } from "./ProgressLog";
import { ErrorCard } from "./ErrorCard";
import { renderMarkdown } from "../utils/renderMarkdown";
import { SkillFileTree } from "./SkillFileTree";

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

interface Props {
  onCreated: (plugin: string, skill: string) => void;
  onCancel: () => void;
}

export function CreateSkillInline({ onCreated, onCancel }: Props) {
  const sk = useCreateSkill({ onCreated });

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
              onClick={() => sk.setMode("manual")}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-200"
              style={{
                background: sk.mode === "manual" ? "var(--surface-4, var(--surface-3))" : "transparent",
                color: sk.mode === "manual" ? "var(--text-primary)" : "var(--text-tertiary)",
                boxShadow: sk.mode === "manual" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                cursor: "pointer",
                border: "none",
              }}
            >
              Manual
            </button>
            <button
              onClick={() => sk.setMode("ai")}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-200"
              style={{
                background: sk.mode === "ai" ? "rgba(168,85,247,0.15)" : "transparent",
                color: sk.mode === "ai" ? "#a855f7" : "var(--text-tertiary)",
                boxShadow: sk.mode === "ai" ? "0 1px 3px rgba(168,85,247,0.15)" : "none",
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
      {sk.layoutLoading && (
        <div className="space-y-3">
          <div className="skeleton h-10 w-full rounded-lg" />
          <div className="skeleton h-10 w-full rounded-lg" />
        </div>
      )}

      {/* ================================================================= */}
      {/* AI-ASSISTED MODE                                                  */}
      {/* ================================================================= */}
      {!sk.layoutLoading && sk.layout && sk.mode === "ai" && (
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
              ref={sk.promptRef}
              value={sk.aiPrompt}
              onChange={(e) => sk.setAiPrompt(e.target.value)}
              placeholder={"e.g., A skill that helps format SQL queries, optimize them for performance, and explain query execution plans.\n\nInclude any specific behaviors, constraints, or output formats you want."}
              rows={5}
              disabled={sk.generating}
              className="w-full px-3 py-2.5 rounded-lg text-[13px] resize-y"
              style={{ ...inputStyle, minHeight: "120px" }}
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

          {/* Progress log during generation */}
          {sk.generating && sk.aiProgress.length > 0 && (
            <ProgressLog entries={sk.aiProgress} isRunning={true} />
          )}

          {/* Error display */}
          {sk.aiError && (
            <div>
              {sk.aiClassifiedError ? (
                <ErrorCard
                  error={sk.aiClassifiedError}
                  onRetry={sk.handleGenerate}
                  onDismiss={sk.clearAiError}
                />
              ) : (
                <div>
                  <div className="px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
                    {sk.aiError}
                  </div>
                  <button
                    onClick={sk.handleGenerate}
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
            {sk.generating ? (
              <button
                onClick={sk.handleCancelGenerate}
                className="px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 flex items-center gap-2"
                style={{ background: "var(--surface-3)", color: "var(--text-secondary)", border: "none", cursor: "pointer" }}
              >
                Cancel Generation
              </button>
            ) : (
              <button
                onClick={sk.handleGenerate}
                disabled={!sk.aiPrompt.trim()}
                className="px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 flex items-center gap-2"
                style={{
                  background: !sk.aiPrompt.trim() ? "var(--surface-3)" : "#a855f7",
                  color: !sk.aiPrompt.trim() ? "var(--text-tertiary)" : "#fff",
                  cursor: !sk.aiPrompt.trim() ? "not-allowed" : "pointer",
                  border: "none",
                }}
              >
                <SparkleIcon size={14} />
                Generate
              </button>
            )}
            <button
              onClick={onCancel}
              className="px-4 py-2.5 rounded-lg text-[13px] font-medium"
              style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}
            >
              Cancel
            </button>
            {!sk.generating && (
              <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                or fill in the form manually
                <button
                  onClick={() => sk.setMode("manual")}
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
      {!sk.layoutLoading && sk.layout && sk.mode === "manual" && (
        <div className="space-y-4 animate-fade-in">
          {/* Location */}
          <div className="glass-card p-4">
            <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Location</h3>
            {sk.creatableLayouts.length > 1 && (
              <div className="mb-3">
                <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>Layout</label>
                <div className="flex gap-2">
                  {sk.creatableLayouts.map((l) => (
                    <button
                      key={l.layout}
                      onClick={() => { sk.setSelectedLayout(l.layout as 1 | 2 | 3); sk.setPlugin(l.existingPlugins[0] || ""); sk.setNewPlugin(""); }}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                      style={{
                        background: sk.selectedLayout === l.layout ? "var(--accent)" : "var(--surface-3)",
                        color: sk.selectedLayout === l.layout ? "#fff" : "var(--text-secondary)",
                        border: `1px solid ${sk.selectedLayout === l.layout ? "var(--accent)" : "var(--border-subtle)"}`,
                        cursor: "pointer",
                      }}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {sk.selectedLayout !== 3 && (
              <div className="mb-3">
                <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>Plugin</label>
                <select
                  value={sk.plugin}
                  onChange={(e) => { sk.setPlugin(e.target.value); sk.setNewPlugin(""); }}
                  className="w-full px-3 py-2 rounded-lg text-[13px]"
                  style={inputStyle}
                >
                  {sk.availablePlugins.map((p) => <option key={p} value={p}>{p}</option>)}
                  <option value="__new__">+ New plugin...</option>
                </select>
                {sk.plugin === "__new__" && (
                  <input type="text" value={sk.newPlugin} onChange={(e) => sk.setNewPlugin(toKebab(e.target.value))} placeholder="my-plugin"
                    className="w-full mt-2 px-3 py-2 rounded-lg text-[13px]"
                    style={inputStyle}
                  />
                )}
              </div>
            )}
            <div className="px-3 py-2 rounded-lg text-[11px] font-mono" style={{ background: "var(--surface-0)", color: "var(--text-tertiary)", border: "1px solid var(--border-subtle)" }}>
              {sk.pathPreview}
            </div>
          </div>

          {/* Plugin recommendation */}
          {sk.showPluginRecommendation && sk.pluginLayoutInfo && sk.selectedLayout === 3 && (
            <div
              className="px-4 py-3 rounded-lg text-[12px] animate-fade-in flex items-center justify-between gap-3"
              style={{
                background: "rgba(59,130,246,0.08)",
                color: "var(--text-secondary)",
                border: "1px solid rgba(59,130,246,0.2)",
              }}
            >
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                  style={{ background: "#3b82f6", color: "#fff", border: "none", cursor: "pointer" }}
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

          {/* Details */}
          <div className="glass-card p-4">
            <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Skill Details</h3>
            <div className="mb-3">
              <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Name <span style={{ color: "var(--red)" }}>*</span></label>
              <input type="text" value={sk.name} onChange={(e) => sk.setName(toKebab(e.target.value, false))} placeholder="my-skill"
                className="w-full px-3 py-2 rounded-lg text-[13px]"
                style={inputStyle}
              />
            </div>
            <div className="mb-3">
              <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Description <span style={{ color: "var(--red)" }}>*</span></label>
              <textarea value={sk.description} onChange={(e) => sk.setDescription(e.target.value)} placeholder="Brief description" rows={3}
                className="w-full px-3 py-2 rounded-lg text-[13px] resize-y"
                style={{ ...inputStyle, minHeight: "72px" }}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Model</label>
                <select value={sk.model} onChange={(e) => sk.setModel(e.target.value)}
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
                <input type="text" value={sk.allowedTools} onChange={(e) => sk.setAllowedTools(e.target.value)} placeholder="Read, Write, Edit..."
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
              <textarea value={sk.body} onChange={(e) => sk.setBody(e.target.value)}
                placeholder={"# /my-skill\n\nYou are an expert at...\n"}
                rows={8}
                className="w-full px-3 py-2 rounded-lg text-[13px] font-mono resize-y"
                style={{ ...inputStyle, minHeight: "150px" }}
              />
            ) : sk.body.trim() ? (
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
                dangerouslySetInnerHTML={{ __html: renderMarkdown(sk.body) }}
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

          {sk.error && (
            <div className="px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
              {sk.error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={sk.handleCreate}
              disabled={sk.creating || !sk.name || !sk.description}
              className="px-5 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150"
              style={{
                background: sk.creating || !sk.name || !sk.description ? "var(--surface-3)" : "var(--accent)",
                color: sk.creating || !sk.name || !sk.description ? "var(--text-tertiary)" : "#fff",
                cursor: sk.creating || !sk.name || !sk.description ? "not-allowed" : "pointer",
                border: "none",
              }}
            >
              {sk.creating ? "Creating..." : "Create Skill"}
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
