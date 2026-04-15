import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api } from "../api";
import { useConfig } from "../ConfigContext";
import type { ProjectLayoutResponse, DetectedLayout, SaveDraftRequest } from "../types";
import type { ProgressEntry } from "../components/ProgressLog";
import type { ClassifiedError } from "../components/ErrorCard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Generate request body builder (extracted for testability)
// ---------------------------------------------------------------------------

export interface GenerateRequestInput {
  prompt: string;
  provider: string;
  model: string;
  targetAgents?: string[];
}

export function buildGenerateRequestBody(input: GenerateRequestInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    provider: input.provider,
    model: input.model,
  };
  if (input.targetAgents && input.targetAgents.length > 0) {
    body.targetAgents = input.targetAgents;
  }
  return body;
}

export function toKebab(s: string, trim = true): string {
  let r = s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (trim) r = r.replace(/^-+|-+$/g, "");
  return r;
}

export function resolvePathPreview(
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
// Hook Options
// ---------------------------------------------------------------------------

export interface UseCreateSkillOptions {
  /** Called after successful skill creation */
  onCreated: (plugin: string, skill: string) => void;
  /** Optional: override AI provider resolution (for page with explicit dropdowns) */
  resolveAiConfigOverride?: () => { provider: string; model: string };
}

// ---------------------------------------------------------------------------
// Hook Return Type
// ---------------------------------------------------------------------------

export interface UseCreateSkillReturn {
  // Mode
  mode: "manual" | "ai";
  setMode: (m: "manual" | "ai") => void;

  // Layout
  layout: ProjectLayoutResponse | null;
  layoutLoading: boolean;
  selectedLayout: 1 | 2 | 3;
  setSelectedLayout: (l: 1 | 2 | 3) => void;
  creatableLayouts: (DetectedLayout & { layout: 1 | 2 | 3 })[];
  availablePlugins: string[];
  pathPreview: string;

  // Plugin
  plugin: string;
  setPlugin: (p: string) => void;
  newPlugin: string;
  setNewPlugin: (p: string) => void;
  effectivePlugin: string;

  // Form fields
  name: string;
  setName: (n: string) => void;
  description: string;
  setDescription: (d: string) => void;
  model: string;
  setModel: (m: string) => void;
  allowedTools: string;
  setAllowedTools: (t: string) => void;
  body: string;
  setBody: (b: string) => void;
  bodyViewMode: "write" | "preview";
  setBodyViewMode: (m: "write" | "preview") => void;

  // AI generation
  aiPrompt: string;
  setAiPrompt: (p: string) => void;
  generating: boolean;
  aiGenerated: boolean;
  aiError: string | null;
  aiClassifiedError: ClassifiedError | null;
  aiProgress: ProgressEntry[];
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
  handleGenerate: () => void;
  handleCancelGenerate: () => void;
  clearAiError: () => void;

  // Target agents
  targetAgents: string[];
  setTargetAgents: (agents: string[]) => void;

  // Draft
  draftSaved: boolean;

  // Plugin recommendation
  showPluginRecommendation: boolean;
  setShowPluginRecommendation: (s: boolean) => void;
  pluginLayoutInfo: { layout: 1 | 2; plugins: string[] } | null;
  applyPluginRecommendation: () => void;

  // Submission
  creating: boolean;
  error: string | null;
  handleCreate: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCreateSkill({ onCreated, resolveAiConfigOverride }: UseCreateSkillOptions): UseCreateSkillReturn {
  // Mode toggle
  const [mode, setMode] = useState<"manual" | "ai">("ai");

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

  // Body preview toggle
  const [bodyViewMode, setBodyViewMode] = useState<"write" | "preview">("write");

  // Target agents
  const [targetAgents, setTargetAgents] = useState<string[]>([]);

  // Submission
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI generation state
  const [aiPrompt, setAiPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiClassifiedError, setAiClassifiedError] = useState<ClassifiedError | null>(null);
  const [aiProgress, setAiProgress] = useState<ProgressEntry[]>([]);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // AI generation metadata (stored for history/persistence)
  const aiMetaRef = useRef<{ prompt: string; provider: string; model: string; reasoning: string } | null>(null);

  // Draft path tracking for cleanup on plugin change
  const draftDirRef = useRef<string | null>(null);

  // Draft persistence
  const [draftSaved, setDraftSaved] = useState(false);

  // Plugin recommendation
  const [showPluginRecommendation, setShowPluginRecommendation] = useState(false);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Load layout on mount
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

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------

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

  const pluginLayoutInfo = useMemo(() => {
    if (!layout) return null;
    const l2 = layout.detectedLayouts.find((d) => d.layout === 2 && d.existingPlugins.length > 0);
    const l1 = layout.detectedLayouts.find((d) => d.layout === 1 && d.existingPlugins.length > 0);
    const best = l2 || l1;
    if (!best) return null;
    return { layout: best.layout as 1 | 2, plugins: best.existingPlugins };
  }, [layout]);

  // Resolve provider/model for generation request
  const resolveAiConfig = useCallback(() => {
    if (resolveAiConfigOverride) return resolveAiConfigOverride();
    if (!config) return { provider: "claude-cli", model: "sonnet" };
    const provider = config.provider || "claude-cli";
    const modelId = config.model || "sonnet";
    return { provider, model: modelId };
  }, [config, resolveAiConfigOverride]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleCancelGenerate = useCallback(() => {
    abortRef.current?.abort();
    setGenerating(false);
  }, []);

  const clearAiError = useCallback(() => {
    setAiError(null);
    setAiClassifiedError(null);
  }, []);

  const handleGenerate = useCallback(async () => {
    setAiError(null);
    setAiClassifiedError(null);
    setAiProgress([]);
    aiMetaRef.current = null;
    if (!aiPrompt.trim()) { setAiError("Describe what your skill should do"); return; }

    setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const { provider, model: aiModel } = resolveAiConfig();

    try {
      const res = await fetch(`/api/skills/generate?sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGenerateRequestBody({
          prompt: aiPrompt.trim(),
          provider,
          model: aiModel,
          targetAgents,
        })),
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
                const meta = {
                  prompt: aiPrompt.trim(),
                  provider: resolveAiConfig().provider,
                  model: resolveAiConfig().model,
                  reasoning: data.reasoning || "",
                };

                setName(data.name);
                setDescription(data.description);
                setModel(data.model || "");
                setAllowedTools(data.allowedTools || "");
                setBody(data.body);
                setAiGenerated(true);
                aiMetaRef.current = meta;
                setMode("manual");

                // Apply suggested plugin from backend
                // Contract: suggestedPlugin: { plugin, layout, confidence, reason } | null
                if (data.suggestedPlugin && typeof data.suggestedPlugin === "object" && data.suggestedPlugin.plugin) {
                  const sp = data.suggestedPlugin as { plugin: string; layout?: 1 | 2; confidence?: string; reason?: string };
                  const allPlugins = layout?.detectedLayouts.flatMap((d) => d.existingPlugins) ?? [];
                  if (allPlugins.includes(sp.plugin)) {
                    setPlugin(sp.plugin);
                    // Use layout from the suggestion if provided, otherwise scan
                    if (sp.layout && (sp.layout === 1 || sp.layout === 2)) {
                      setSelectedLayout(sp.layout);
                    } else {
                      const matchLayout = layout?.detectedLayouts.find(
                        (d) => d.existingPlugins.includes(sp.plugin)
                      );
                      if (matchLayout && (matchLayout.layout === 1 || matchLayout.layout === 2)) {
                        setSelectedLayout(matchLayout.layout);
                      }
                    }
                  } else {
                    // New plugin name — enter "New Plugin" mode
                    setPlugin("__new__");
                    setNewPlugin(sp.plugin);
                  }
                } else if (selectedLayout === 3 && pluginLayoutInfo) {
                  // Fallback: show plugin recommendation if on layout 3
                  setShowPluginRecommendation(true);
                }

                // Auto-save draft to file system (without evals)
                const draftReq: SaveDraftRequest = {
                  name: data.name,
                  plugin: effectivePlugin || "",
                  layout: selectedLayout,
                  description: data.description,
                  model: data.model || undefined,
                  allowedTools: data.allowedTools || undefined,
                  body: data.body,
                  aiMeta: meta,
                };
                api.saveDraft(draftReq)
                  .then((res) => {
                    setDraftSaved(true);
                    if (res?.dir) draftDirRef.current = res.dir;
                  })
                  .catch(() => { /* draft save failure is non-blocking */ });
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
  }, [aiPrompt, resolveAiConfig, selectedLayout, pluginLayoutInfo, effectivePlugin, layout, targetAgents]);

  const handleCreate = useCallback(async () => {
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
        aiMeta: aiMetaRef.current || undefined,
        draftDir: draftDirRef.current || undefined,
      });
      draftDirRef.current = null;
      onCreated(result.plugin, result.skill);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }, [name, description, selectedLayout, effectivePlugin, model, allowedTools, body, onCreated]);

  const applyPluginRecommendation = useCallback(() => {
    if (!pluginLayoutInfo) return;
    setSelectedLayout(pluginLayoutInfo.layout);
    setPlugin(pluginLayoutInfo.plugins[0]);
    setShowPluginRecommendation(false);
  }, [pluginLayoutInfo]);

  return {
    mode, setMode,
    layout, layoutLoading,
    selectedLayout, setSelectedLayout,
    creatableLayouts, availablePlugins, pathPreview,
    plugin, setPlugin, newPlugin, setNewPlugin, effectivePlugin,
    name, setName,
    description, setDescription,
    model, setModel,
    allowedTools, setAllowedTools,
    body, setBody,
    bodyViewMode, setBodyViewMode,
    aiPrompt, setAiPrompt,
    generating, aiGenerated,
    aiError, aiClassifiedError, aiProgress,
    promptRef, handleGenerate, handleCancelGenerate, clearAiError,
    targetAgents, setTargetAgents,
    draftSaved,
    showPluginRecommendation, setShowPluginRecommendation,
    pluginLayoutInfo, applyPluginRecommendation,
    creating, error, handleCreate,
  };
}
