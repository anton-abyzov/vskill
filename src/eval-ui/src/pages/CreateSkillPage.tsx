import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { ConfigResponse } from "../api";
import type { ProjectLayoutResponse, DetectedLayout, SkillCreatorStatus } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toKebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateSkillPage() {
  const navigate = useNavigate();

  // Layout detection
  const [layout, setLayout] = useState<ProjectLayoutResponse | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(true);

  // Skill-creator status
  const [creatorStatus, setCreatorStatus] = useState<SkillCreatorStatus | null>(null);
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

  // Submission
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load layout + config + creator status on mount
  useEffect(() => {
    api.getProjectLayout()
      .then((l) => {
        setLayout(l);
        setSelectedLayout(l.suggestedLayout);
        // Pre-select first plugin from suggested layout
        const suggested = l.detectedLayouts.find((d) => d.layout === l.suggestedLayout);
        if (suggested?.existingPlugins.length) {
          setPlugin(suggested.existingPlugins[0]);
        }
      })
      .catch(() => {})
      .finally(() => setLayoutLoading(false));

    api.getConfig().then(setConfig).catch(() => {});
    api.getSkillCreatorStatus().then(setCreatorStatus).catch(() => {});
  }, []);

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

  // Show skill-creator banner only when using Claude
  const showCreatorBanner = config?.provider === "claude-cli" && creatorStatus !== null;

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
      });
      navigate(`/skills/${result.plugin}/${result.skill}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="px-10 py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-[12px] mb-3" style={{ color: "var(--text-tertiary)" }}>
          <Link to="/" className="hover:underline" style={{ color: "var(--text-tertiary)" }}>Skills</Link>
          <span>/</span>
          <span style={{ color: "var(--text-secondary)" }}>New Skill</span>
        </div>
        <h2 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Create a New Skill
        </h2>
        <p className="text-[13px] mt-1" style={{ color: "var(--text-tertiary)" }}>
          Define your skill's metadata, content, and placement
        </p>
      </div>

      {/* Skill-creator banner */}
      {showCreatorBanner && (
        <div
          className="mb-6 px-4 py-3 rounded-lg text-[13px]"
          style={{
            background: creatorStatus!.installed ? "var(--accent-muted)" : "var(--surface-2)",
            border: creatorStatus!.installed ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        >
          {creatorStatus!.installed ? (
            <div className="flex items-start gap-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
              </svg>
              <div>
                <span className="font-medium">AI-Assisted Authoring Available</span>
                <span className="ml-1" style={{ color: "var(--text-secondary)" }}>
                  — Run <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: "var(--surface-3)" }}>/skill-creator</code> in
                  Claude Code for guided skill creation with the full methodology.
                  This form creates the basic structure.
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <div>
                <span style={{ color: "var(--text-secondary)" }}>
                  Tip: Install the Skill Creator for AI-assisted authoring —{" "}
                </span>
                <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: "var(--surface-3)" }}>
                  {creatorStatus!.installCommand}
                </code>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {layoutLoading && (
        <div className="space-y-3">
          <div className="skeleton h-10 w-full rounded-lg" />
          <div className="skeleton h-10 w-full rounded-lg" />
          <div className="skeleton h-10 w-full rounded-lg" />
        </div>
      )}

      {/* Main content: form + preview */}
      {!layoutLoading && layout && (
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
                    style={{
                      background: "var(--surface-3)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-subtle)",
                    }}
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
                      style={{
                        background: "var(--surface-3)",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border-subtle)",
                      }}
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
                  onChange={(e) => setName(toKebab(e.target.value))}
                  placeholder="my-skill"
                  className="w-full px-3 py-2 rounded-lg text-[13px]"
                  style={{
                    background: "var(--surface-3)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-subtle)",
                  }}
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
                  style={{
                    background: "var(--surface-3)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-subtle)",
                  }}
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
                    style={{
                      background: "var(--surface-3)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-subtle)",
                    }}
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
                    style={{
                      background: "var(--surface-3)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-subtle)",
                    }}
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
                  background: "var(--surface-3)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-subtle)",
                  minHeight: "200px",
                }}
              />
            </div>

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
      )}
    </div>
  );
}
