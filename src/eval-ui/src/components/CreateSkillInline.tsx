import { useState, useEffect, useMemo } from "react";
import { api } from "../api";
import type { ConfigResponse } from "../api";
import type { ProjectLayoutResponse, DetectedLayout, SkillCreatorStatus } from "../types";

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

interface Props {
  onCreated: (plugin: string, skill: string) => void;
  onCancel: () => void;
}

export function CreateSkillInline({ onCreated, onCancel }: Props) {
  const [layout, setLayout] = useState<ProjectLayoutResponse | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [creatorStatus, setCreatorStatus] = useState<SkillCreatorStatus | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);

  const [name, setName] = useState("");
  const [selectedLayout, setSelectedLayout] = useState<1 | 2 | 3>(3);
  const [plugin, setPlugin] = useState("");
  const [newPlugin, setNewPlugin] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [body, setBody] = useState("");

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    api.getConfig().then(setConfig).catch(() => {});
    api.getSkillCreatorStatus().then(setCreatorStatus).catch(() => {});
  }, []);

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
      onCreated(result.plugin, result.skill);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="px-8 py-6 max-w-4xl animate-fade-in overflow-auto h-full">
      <div className="mb-5">
        <h2 className="text-[20px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Create a New Skill
        </h2>
        <p className="text-[13px] mt-1" style={{ color: "var(--text-tertiary)" }}>
          Define your skill's metadata, content, and placement
        </p>
      </div>

      {showCreatorBanner && (
        <div
          className="mb-5 px-4 py-3 rounded-lg text-[13px]"
          style={{
            background: creatorStatus!.installed ? "var(--accent-muted)" : "var(--surface-2)",
            border: creatorStatus!.installed ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        >
          {creatorStatus!.installed ? (
            <span>
              <span className="font-medium">AI-Assisted Authoring Available</span>
              <span className="ml-1" style={{ color: "var(--text-secondary)" }}>
                — Run <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: "var(--surface-3)" }}>/skill-creator</code> in Claude Code for guided creation.
              </span>
            </span>
          ) : (
            <span style={{ color: "var(--text-secondary)" }}>
              Tip: Install the Skill Creator — <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: "var(--surface-3)" }}>{creatorStatus!.installCommand}</code>
            </span>
          )}
        </div>
      )}

      {layoutLoading ? (
        <div className="space-y-3">
          <div className="skeleton h-10 w-full rounded-lg" />
          <div className="skeleton h-10 w-full rounded-lg" />
        </div>
      ) : layout ? (
        <div className="space-y-4">
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
                  style={{ background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
                >
                  {availablePlugins.map((p) => <option key={p} value={p}>{p}</option>)}
                  <option value="__new__">+ New plugin...</option>
                </select>
                {plugin === "__new__" && (
                  <input type="text" value={newPlugin} onChange={(e) => setNewPlugin(toKebab(e.target.value))} placeholder="my-plugin"
                    className="w-full mt-2 px-3 py-2 rounded-lg text-[13px]"
                    style={{ background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
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
                style={{ background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
              />
            </div>
            <div className="mb-3">
              <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Description <span style={{ color: "var(--red)" }}>*</span></label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" rows={2}
                className="w-full px-3 py-2 rounded-lg text-[13px] resize-none"
                style={{ background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Model</label>
                <select value={model} onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-[13px]"
                  style={{ background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
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
                  style={{ background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
                />
              </div>
            </div>
          </div>

          {/* System prompt */}
          <div className="glass-card p-4">
            <h3 className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>System Prompt</h3>
            <textarea value={body} onChange={(e) => setBody(e.target.value)}
              placeholder={"# /my-skill\n\nYou are an expert at...\n"}
              rows={8}
              className="w-full px-3 py-2 rounded-lg text-[13px] font-mono resize-y"
              style={{ background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)", minHeight: "150px" }}
            />
          </div>

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
      ) : null}
    </div>
  );
}
