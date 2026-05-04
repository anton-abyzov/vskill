import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api, ApiError } from "../api";
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

// ---------------------------------------------------------------------------
// 0703 follow-up: placement-pinning decision helper.
//
// The AI backend returns `data.name` and `data.suggestedPlugin`. When the
// user has already specified a skill name / plugin destination (via URL
// prefill from the CreateSkillModal, or by typing in the form before
// clicking Generate), those explicit choices MUST win over the AI's
// suggestion. Otherwise skill `test-plugin-skill` + plugin `test-plugin`
// silently becomes `task-skill-announcer` in some pre-existing plugin
// like `frontend` — exactly the "it landed in the wrong place" bug users
// reported.
//
// Pure function so it is trivial to unit-test without driving the SSE
// stream end-to-end.
// ---------------------------------------------------------------------------
export interface PinningInput {
  userName: string;
  userPlugin: string;     // selected plugin id ("" | "__new__" | <name>)
  userNewPlugin: string;  // typed new plugin name
  aiName: string | undefined;
  aiSuggestedPlugin: { plugin: string; layout?: 1 | 2 } | null | undefined;
  /**
   * When set to 3, the user explicitly chose Standalone in the modal — the AI
   * must NEVER reroute the skill into a plugin even if it returns a
   * `suggestedPlugin`. layout 1/2 do not block on their own; user-pinning
   * (userPlugin / userNewPlugin) handles those cases.
   */
  forceLayout?: 1 | 2 | 3;
}

export interface PinningDecision {
  applyName: string | null;                          // null → keep user's
  applySuggestedPlugin: boolean;                     // false → keep user's
  suggestedPluginValue: { plugin: string; layout?: 1 | 2 } | null;
}

export function decideGenerationPinning(input: PinningInput): PinningDecision {
  const userPinnedName = input.userName.trim().length > 0;
  const userPinnedPlugin =
    input.userPlugin.trim().length > 0 || input.userNewPlugin.trim().length > 0;
  // Standalone is sticky — once the user picks a root `skills/` placement on
  // the modal step, no AI suggestion may pull the skill into a plugin.
  const standaloneLocked = input.forceLayout === 3;

  return {
    applyName: userPinnedName ? null : input.aiName ?? null,
    applySuggestedPlugin:
      !standaloneLocked && !userPinnedPlugin && !!input.aiSuggestedPlugin?.plugin,
    suggestedPluginValue:
      standaloneLocked || userPinnedPlugin ? null : (input.aiSuggestedPlugin ?? null),
  };
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
  /**
   * Pin the skill placement to a specific layout regardless of project
   * detection. Used when the user arrives from the CreateSkillModal having
   * already chosen a destination — e.g. `mode=standalone` must produce a
   * root `skills/` placement (layout 3) and never quietly default to the
   * project's first existing plugin once layout detection resolves.
   */
  forceLayout?: 1 | 2 | 3;
  /**
   * 0786 AC-US1-01 / AC-US1-04: invoked at the start of handleCreate (before
   * `api.createSkill`) so any pending-delete for the same skill name is
   * flushed against the server first. This avoids a 409
   * `skill-already-exists` race when the user deletes a skill and
   * immediately re-creates one with the same name within the 10s Undo
   * window. Optional — when omitted (legacy / unit tests), handleCreate
   * proceeds directly to api.createSkill.
   */
  flushPendingForSkillName?: (skillName: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook Return Type
// ---------------------------------------------------------------------------

/** 0734: authoring engine selection for the create-skill form. */
export type CreateSkillEngineUi = "vskill" | "anthropic-skill-creator" | "none";

/** 0734: detect-engines API response shape (mirror of types.ts DetectEnginesResponse). */
export interface EngineDetectionState {
  vskillSkillBuilder: boolean;
  anthropicSkillCreator: boolean;
  vskillVersion: string | null;
  anthropicPath: string | null;
}

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

  // 0734: engine selection + version
  engineDetection: EngineDetectionState | null;
  refreshEngineDetection: () => Promise<void>;
  engine: CreateSkillEngineUi;
  setEngine: (e: CreateSkillEngineUi) => void;
  version: string;
  setVersion: (v: string) => void;
  versionValid: boolean;
  setVersionValid: (valid: boolean) => void;

  // Submission
  creating: boolean;
  error: string | null;
  /** 0772 US-004: neutral info message (e.g. "Skill already existed — opened
   *  it"). Distinct from `error` so consuming components can render a calmer
   *  affordance instead of the red error styling. */
  info: string | null;
  handleCreate: () => void;

  /**
   * True when the user arrived from the modal with mode=standalone — the
   * layout/plugin pickers must be locked to prevent accidental rerouting
   * into a plugin. The page renders a clear "Standalone skill" lock indicator
   * instead of the layout selector when this is true.
   */
  standaloneLocked: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCreateSkill({ onCreated, resolveAiConfigOverride, forceLayout, flushPendingForSkillName }: UseCreateSkillOptions): UseCreateSkillReturn {
  // Mode toggle
  const [mode, setMode] = useState<"manual" | "ai">("ai");

  // Layout detection
  const [layout, setLayout] = useState<ProjectLayoutResponse | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(true);

  // Config (providers/models) — shared via context
  const { config } = useConfig();

  // Form state
  const [name, setName] = useState("");
  const [selectedLayout, setSelectedLayout] = useState<1 | 2 | 3>(forceLayout ?? 3);
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
  // 0772 US-004: neutral info channel for recoverable cases (409, etc).
  const [info, setInfo] = useState<string | null>(null);

  // 0734: engine selection + version
  const [engineDetection, setEngineDetection] = useState<EngineDetectionState | null>(null);
  const [engine, setEngine] = useState<CreateSkillEngineUi>("vskill");
  const [version, setVersion] = useState<string>("1.0.0");
  const [versionValid, setVersionValid] = useState<boolean>(true);

  const refreshEngineDetection = useCallback(async () => {
    try {
      const result = await api.detectEngines();
      setEngineDetection(result);
      // Apply default precedence on first load (don't override user's explicit pick).
      setEngine((prev) => {
        if (prev !== "vskill") return prev; // user has interacted, keep their choice
        if (result.vskillSkillBuilder) return "vskill";
        if (result.anthropicSkillCreator) return "anthropic-skill-creator";
        return "none";
      });
    } catch {
      // Fail-soft: leave detection null; UI shows "all options" with no install hints.
      setEngineDetection({
        vskillSkillBuilder: false,
        anthropicSkillCreator: false,
        vskillVersion: null,
        anthropicPath: null,
      });
    }
  }, []);

  useEffect(() => {
    void refreshEngineDetection();
  }, [refreshEngineDetection]);

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
  // 0711: AI metadata now records BOTH the alias the user picked AND the
  // resolved concrete model ID (when the server returns one). Storing the
  // resolved ID lets future regenerations on a different model produce a
  // diff instead of looking identical at the alias level.
  const aiMetaRef = useRef<{
    prompt: string;
    provider: string;
    /** Whatever alias / id the user requested (e.g. "opus", "claude-opus-4-7"). */
    model: string;
    /** Catalog-resolved canonical id when the server confirms it; null otherwise. */
    resolvedModelId?: string | null;
    /** Catalog snapshot date the resolution was based on. */
    snapshotDate?: string | null;
    reasoning: string;
  } | null>(null);
  // 0711: server-side `provenance` SSE event lands here so the next `done`
  // event can fold it into aiMeta. Reset on every new generate run.
  const provenanceRef = useRef<{ resolvedModelId: string | null; snapshotDate: string | null } | null>(null);

  // Draft path tracking for cleanup on plugin change
  const draftDirRef = useRef<string | null>(null);

  // Draft persistence
  const [draftSaved, setDraftSaved] = useState(false);

  // Plugin recommendation
  const [showPluginRecommendation, setShowPluginRecommendation] = useState(false);

  // 0703 follow-up: track user-pinned placement (name / plugin / newPlugin)
  // via refs so handleGenerate can read the CURRENT values without stale
  // closure. When the user arrives with explicit URL params (or has typed a
  // name / picked a plugin before clicking Generate), the AI must not
  // silently overwrite their choice.
  const nameRef = useRef(name);
  const pluginRef = useRef(plugin);
  const newPluginRef = useRef(newPlugin);
  useEffect(() => { nameRef.current = name; }, [name]);
  useEffect(() => { pluginRef.current = plugin; }, [plugin]);
  useEffect(() => { newPluginRef.current = newPlugin; }, [newPlugin]);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Load layout on mount. When `forceLayout` is set the caller has already
  // committed to a destination (e.g. modal-chain "Standalone skill") — we
  // still want the detection result available for the path preview, but we
  // must not stomp on the user's pinned layout or auto-pick a plugin.
  useEffect(() => {
    api.getProjectLayout()
      .then((l) => {
        setLayout(l);
        if (forceLayout) return;
        setSelectedLayout(l.suggestedLayout);
        const suggested = l.detectedLayouts.find((d) => d.layout === l.suggestedLayout);
        if (suggested?.existingPlugins.length) setPlugin(suggested.existingPlugins[0]);
      })
      .catch(() => {})
      .finally(() => setLayoutLoading(false));
  }, [forceLayout]);

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
    provenanceRef.current = null;
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
              } else if (currentEvent === "provenance") {
                // 0711: server-side resolved model + snapshot date. Stash on
                // a ref so the next `done` event includes it in aiMeta. We
                // don't surface it in the UI directly — it's audit metadata.
                provenanceRef.current = {
                  resolvedModelId: typeof data.resolvedModelId === "string" ? data.resolvedModelId : null,
                  snapshotDate: typeof data.snapshotDate === "string" ? data.snapshotDate : null,
                };
              } else if (currentEvent === "done" || currentEvent === "complete") {
                // 0711: aiMeta records the resolved concrete ID + the
                // catalog snapshot date that produced it (captured from the
                // separate `provenance` SSE event the server emits before
                // `done`). Saving both the alias the user picked and the
                // ID it resolved to lets future regenerations on a newer
                // model produce a meaningful diff.
                const meta = {
                  prompt: aiPrompt.trim(),
                  provider: resolveAiConfig().provider,
                  model: resolveAiConfig().model,
                  resolvedModelId: provenanceRef.current?.resolvedModelId ?? null,
                  snapshotDate: provenanceRef.current?.snapshotDate ?? null,
                  reasoning: data.reasoning || "",
                };

                // 0703 follow-up: respect user-pinned placement via the
                // pure `decideGenerationPinning` helper (see tests for the
                // full decision matrix). If the user arrived with a skill
                // name / plugin in the URL, those values win over the AI's.
                const pinning = decideGenerationPinning({
                  userName: nameRef.current,
                  userPlugin: pluginRef.current,
                  userNewPlugin: newPluginRef.current,
                  aiName: data.name,
                  aiSuggestedPlugin: data.suggestedPlugin && data.suggestedPlugin.plugin
                    ? { plugin: data.suggestedPlugin.plugin, layout: data.suggestedPlugin.layout }
                    : null,
                  forceLayout,
                });

                if (pinning.applyName !== null) setName(pinning.applyName);
                setDescription(data.description);
                setModel(data.model || "");
                setAllowedTools(data.allowedTools || "");
                setBody(data.body);
                setAiGenerated(true);
                aiMetaRef.current = meta;
                setMode("manual");

                // Apply suggested plugin from backend — ONLY when the user
                // has not already pinned a destination (the helper answers
                // that in `applySuggestedPlugin`). When `forceLayout === 3`
                // the user explicitly chose Standalone in the modal, so even
                // the AI's suggestion must not pull the skill into a plugin.
                if (forceLayout === 3) {
                  // Standalone is sticky — keep layout 3 and clear any plugin.
                  setSelectedLayout(3);
                  setPlugin("");
                  setNewPlugin("");
                } else if (pinning.applySuggestedPlugin && pinning.suggestedPluginValue) {
                  const sp = pinning.suggestedPluginValue;
                  const allPlugins = layout?.detectedLayouts.flatMap((d) => d.existingPlugins) ?? [];
                  if (allPlugins.includes(sp.plugin)) {
                    setPlugin(sp.plugin);
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
                } else if (
                  !pinning.applySuggestedPlugin &&
                  pluginRef.current.trim().length === 0 &&
                  newPluginRef.current.trim().length === 0 &&
                  selectedLayout === 3 &&
                  pluginLayoutInfo
                ) {
                  // Fallback: show plugin recommendation if user is on
                  // layout 3 AND has no pinned plugin AND no suggestion arrived.
                  // Standalone-mode-locked sessions (forceLayout === 3) never
                  // reach this branch because the preceding `if (forceLayout === 3)`
                  // path matches first, so the user-explicit "Standalone" choice
                  // from the modal stays sticky and the nudge banner stays hidden.
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
  }, [aiPrompt, resolveAiConfig, selectedLayout, pluginLayoutInfo, effectivePlugin, layout, targetAgents, forceLayout]);

  const handleCreate = useCallback(async () => {
    setError(null);
    setInfo(null);
    if (!name.trim()) { setError("Skill name is required"); return; }
    if (!description.trim()) { setError("Description is required"); return; }
    if (selectedLayout !== 3 && !effectivePlugin.trim()) { setError("Plugin name is required"); return; }

    if (!versionValid) { setError("Version is not valid semver"); return; }

    setCreating(true);
    try {
      // 0786 AC-US1-01 / AC-US1-04: flush any pending-delete for the same
      // skill name BEFORE calling api.createSkill, so the previous folder
      // is gone server-side by the time existsSync runs. Without this, a
      // delete-then-immediate-create flow within the 10s Undo window hits
      // the server while the prior folder still exists and surfaces a
      // misleading 409 skill-already-exists error.
      if (flushPendingForSkillName) {
        try {
          await flushPendingForSkillName(toKebab(name));
        } catch (flushErr) {
          // 0786 review F-002: distinguish flush-failed from create-failed so the
          // user knows the previous delete is the root cause, not the new create.
          // We surface a tailored error and bail without attempting api.createSkill —
          // the prior folder is still on disk and a create would 409 anyway.
          setError(
            `Could not finalize previous delete of ${toKebab(name)}: ${(flushErr as Error).message}. Cancel the pending delete and try again.`,
          );
          setCreating(false);
          return;
        }
      }
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
        version: version.trim() || undefined,
        engine,
      });
      draftDirRef.current = null;
      onCreated(result.plugin, result.skill);
    } catch (err) {
      // 0772 US-004: a 409 from /api/skills/create with the structured
      // `skill-already-exists` payload means the file already exists on disk
      // (typical cause: the previous create succeeded but the UI failed to
      // navigate, the user clicked again). Treat as a successful navigation
      // to the existing skill, with a neutral info note.
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.details?.code === "skill-already-exists"
      ) {
        const conflictPlugin = typeof err.details.plugin === "string" ? err.details.plugin : "";
        const conflictSkill = typeof err.details.skill === "string" ? err.details.skill : toKebab(name);
        setInfo("Skill already existed — opened it.");
        draftDirRef.current = null;
        onCreated(conflictPlugin, conflictSkill);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setCreating(false);
    }
  }, [name, description, selectedLayout, effectivePlugin, model, allowedTools, body, version, versionValid, engine, onCreated, flushPendingForSkillName]);

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
    creating, error, info, handleCreate,
    // 0734: engine + version + detection state
    engineDetection, refreshEngineDetection,
    engine, setEngine,
    version, setVersion,
    versionValid, setVersionValid,
    standaloneLocked: forceLayout === 3,
  };
}
