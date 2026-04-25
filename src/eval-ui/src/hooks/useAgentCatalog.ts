// ---------------------------------------------------------------------------
// useAgentCatalog — single source of truth for the Studio picker catalog.
//
// Merges (1) /api/config (agents + hardcoded model lists + detection block),
// (2) /api/openrouter/models (300+ priced models, lazy-fetched on focus),
// (3) live probes of Ollama/LM Studio from /api/config.
//
// Types are locally defined — the api.ts / types.ts surface is treated as
// read-only for 0682.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

export type CtaType = "api-key" | "cli-install" | "start-service" | null;

export interface ModelEntry {
  id: string;
  displayName: string;
  contextWindow?: number;
  /** USD per 1M tokens (canonical wire unit — see 0701 for Anthropic, 0710 for OpenRouter). */
  pricing?: { prompt: number; completion: number };
  billingMode: "per-token" | "subscription" | "free"; // voice-allow — internal billing-mode enum, not user-facing copy
  /** Concrete model the alias resolves to (e.g. `sonnet` → `claude-sonnet-4-6`). */
  resolvedId?: string;
}

export interface AgentEntry {
  id: string;
  displayName: string;
  caption?: string;
  wrapperFolder: string | null;
  wrapperFolderPresent: boolean;
  binaryAvailable: boolean;
  endpointReachable: boolean | null;
  available: boolean;
  ctaType: CtaType;
  models: ModelEntry[];
  catalogAgeMs?: number;
  cacheStale?: boolean;
  // 0701 — Present on the claude-cli entry when ~/.claude/settings.json has a
  // `model` field. The Studio picker surfaces this under the generic alias so
  // the user can tell which concrete model will actually serve the session.
  resolvedModel?: string | null;
}

export interface AgentCatalog {
  agents: AgentEntry[];
  activeAgent: string | null;
  activeModel: string | null;
}

export type CatalogStatus = "loading" | "ready" | "error";

interface ServerConfigResponse {
  provider: string | null;
  model: string;
  providers: Array<{
    id: string;
    label: string;
    available: boolean;
    // 0701 — resolvedModel populated on the claude-cli provider only.
    resolvedModel?: string | null;
    models: Array<{
      id: string;
      label: string;
      // 0701 — pricing populated on per-token providers (anthropic, openrouter).
      pricing?: { prompt: number; completion: number };
      // Concrete dated/canonical Anthropic ID this alias resolves to (claude-cli only).
      resolvedId?: string;
    }>;
  }>;
  detection?: {
    wrapperFolders: Record<string, boolean>;
    binaries: Record<string, boolean>;
  };
}

interface OpenRouterModelsResponse {
  models: Array<{
    id: string;
    name: string;
    contextWindow?: number;
    pricing?: { prompt: number; completion: number };
  }>;
  ageSec?: number;
  stale?: boolean;
}

// Agent ordering — Claude Code first, then agentic editors, then non-agentic.
// Below-divider providers: Ollama + LM Studio.
const AGENT_ORDER = [
  "claude-cli",
  "anthropic",
  "openai",
  "openrouter",
  "cursor",
  "codex-cli",
  "gemini-cli",
  "copilot",
  "zed",
  "ollama",
  "lm-studio",
] as const;

const WRAPPER_FOLDER_BY_AGENT: Record<string, string | null> = {
  "claude-cli": ".claude",
  "cursor": ".cursor",
  "codex-cli": ".codex",
  "gemini-cli": ".gemini",
  "copilot": ".github",
  "zed": ".zed",
};

const BINARY_BY_AGENT: Record<string, string | null> = {
  "claude-cli": "claude",
  "cursor": "cursor",
  "codex-cli": "codex",
  "gemini-cli": "gemini",
};

const CTA_BY_AGENT: Record<string, CtaType> = {
  "claude-cli": "cli-install",
  "anthropic": "api-key",
  "openai": "api-key",
  "openrouter": "api-key",
  "cursor": "cli-install",
  "codex-cli": "cli-install",
  "gemini-cli": "cli-install",
  "copilot": "cli-install",
  "zed": "cli-install",
  "ollama": "start-service",
  "lm-studio": "start-service",
};

// voice-allow — values in this map are internal billing-mode enum constants
// (matched against ModelEntry["billingMode"] type), not user-facing copy.
// AC-US5-01 / F-003: programmer-side enum keys are exempt from the voice
// lint; only user-rendered strings are subject to the Anthropic April 2026
// ToS reframe.
const BILLING_BY_AGENT: Record<string, ModelEntry["billingMode"]> = {
  "claude-cli": "subscription", // voice-allow
  "anthropic": "per-token",
  "openai": "per-token",
  "openrouter": "per-token",
  "cursor": "subscription", // voice-allow
  "codex-cli": "subscription", // voice-allow
  "gemini-cli": "subscription", // voice-allow
  "copilot": "subscription", // voice-allow
  "zed": "subscription", // voice-allow
  "ollama": "free",
  "lm-studio": "free",
};

function toAgentEntry(
  raw: ServerConfigResponse["providers"][number],
  detection: ServerConfigResponse["detection"],
): AgentEntry {
  const wrapperFolder = WRAPPER_FOLDER_BY_AGENT[raw.id] ?? null;
  const binaryName = BINARY_BY_AGENT[raw.id] ?? null;
  const wrapperFolderPresent = wrapperFolder
    ? Boolean(detection?.wrapperFolders?.[wrapperFolder])
    : false;
  const binaryAvailable = binaryName
    ? Boolean(detection?.binaries?.[binaryName])
    : true; // API providers have no binary requirement
  const models: ModelEntry[] = raw.models.map((m) => ({
    id: m.id,
    displayName: m.label,
    billingMode: BILLING_BY_AGENT[raw.id] ?? "per-token",
    // 0701 — forward server-provided pricing (anthropic's static map) so
    // ModelList.formatMetadata renders real $ amounts instead of $0.00.
    ...(m.pricing ? { pricing: m.pricing } : {}),
    ...(m.resolvedId ? { resolvedId: m.resolvedId } : {}),
  }));
  return {
    id: raw.id,
    displayName: displayNameFor(raw.id, raw.label),
    wrapperFolder,
    wrapperFolderPresent,
    binaryAvailable,
    endpointReachable: raw.id === "ollama" || raw.id === "lm-studio" ? raw.available : null,
    available: raw.available,
    ctaType: raw.available ? null : CTA_BY_AGENT[raw.id] ?? null,
    models,
    // 0701 — resolvedModel is only meaningful for claude-cli; pass through
    // whatever the server sent (string | null | undefined).
    resolvedModel: raw.resolvedModel ?? null,
  };
}

function displayNameFor(id: string, fallback: string): string {
  const map: Record<string, string> = {
    "claude-cli": "Claude Code",
    "anthropic": "Anthropic API",
    "openai": "OpenAI API",
    "openrouter": "OpenRouter",
    "cursor": "Cursor",
    "codex-cli": "Codex CLI",
    "gemini-cli": "Gemini CLI",
    "copilot": "GitHub Copilot",
    "zed": "Zed",
    "ollama": "Ollama",
    "lm-studio": "LM Studio",
  };
  return map[id] ?? fallback;
}

function orderAgents(agents: AgentEntry[]): AgentEntry[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const ordered: AgentEntry[] = [];
  for (const id of AGENT_ORDER) {
    const a = byId.get(id);
    if (a) ordered.push(a);
  }
  // Append any unknown agents at the tail (e.g., future providers).
  for (const a of agents) {
    if (!AGENT_ORDER.includes(a.id as typeof AGENT_ORDER[number])) ordered.push(a);
  }
  return ordered;
}

export interface UseAgentCatalogResult {
  status: CatalogStatus;
  catalog: AgentCatalog | null;
  error: string | null;
  // 0682 CR-0682-M3 — non-null when /api/openrouter/models hydration failed
  // for a non-key reason (5xx, network drop). ModelList can render an inline
  // retry hint instead of showing an empty list with no explanation.
  openRouterError: string | null;
  focusAgent: (agentId: string) => void;
  refresh: () => void;
  activeAgentId: string | null;
  activeModelId: string | null;
  setActive: (agentId: string, modelId: string) => Promise<void>;
}

export function useAgentCatalog(opts?: {
  onStaleCatalog?: (agentId: string, ageMs: number) => void;
  // 0682 CR-002 — Surfaces non-OK POST /api/config responses (e.g. 4xx for
  // missing API key) so the UI can render a toast. Pre-fix, setActive()
  // silently dropped errors and the popover closed with no signal.
  onSetActiveError?: (message: string) => void;
}): UseAgentCatalogResult {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  // 0682 CR-0682-M3 — Surfaces hydrate-fetch failures via the catalog state
  // so ModelList can render an inline retry CTA. Pre-fix the empty catch
  // swallowed network errors with no signal whatsoever.
  const [openRouterError, setOpenRouterError] = useState<string | null>(null);
  const focusedRef = useRef<string | null>(null);
  const openRouterFetchedAtRef = useRef<number>(0);
  // 0682 CR-0682-M2 — Stable refs for the opts callbacks. Consumers pass
  // `opts` as an inline object literal each render; depending on `opts`
  // directly inside useCallback would churn function identities and force
  // every consumer that closes over them (e.g. AgentModelPicker keydown
  // effect) to re-subscribe each render. Refs decouple identity from value.
  const onStaleRef = useRef(opts?.onStaleCatalog);
  const onSetActiveErrorRef = useRef(opts?.onSetActiveError);
  useEffect(() => {
    onStaleRef.current = opts?.onStaleCatalog;
    onSetActiveErrorRef.current = opts?.onSetActiveError;
  }, [opts?.onStaleCatalog, opts?.onSetActiveError]);

  const loadBase = useCallback(async () => {
    try {
      const resp = await fetch("/api/config");
      if (!resp.ok) throw new Error(`/api/config returned ${resp.status}`);
      const data = (await resp.json()) as ServerConfigResponse;
      const agents = orderAgents(
        (data.providers || []).map((p) => toAgentEntry(p, data.detection)),
      );
      setCatalog({
        agents,
        activeAgent: data.provider ?? null,
        activeModel: data.model ?? null,
      });
      setStatus("ready");
      setError(null);
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const hydrateOpenRouter = useCallback(async () => {
    const now = Date.now();
    // Client SWR: 5-minute stale window.
    if (now - openRouterFetchedAtRef.current < 5 * 60_000) return;
    try {
      const resp = await fetch("/api/openrouter/models");
      if (!resp.ok) {
        // 0682 CR-0682-M3 — 400 (no key) is an expected silent state because
        // the agent.available CTA covers it. 5xx + other 4xx are real
        // failures that previously vanished into the empty catch — surface
        // them via openRouterError so ModelList can render a retry hint.
        if (resp.status !== 400) {
          setOpenRouterError(`OpenRouter catalog fetch failed (${resp.status})`);
        }
        return;
      }
      const data = (await resp.json()) as OpenRouterModelsResponse;
      openRouterFetchedAtRef.current = now;
      setOpenRouterError(null);
      setCatalog((prev) => {
        if (!prev) return prev;
        const next = prev.agents.map((a) => {
          if (a.id !== "openrouter") return a;
          const models: ModelEntry[] = data.models.map((m) => ({
            id: m.id,
            displayName: m.name,
            contextWindow: m.contextWindow,
            pricing: m.pricing,
            billingMode: "per-token",
          }));
          const entry: AgentEntry = {
            ...a,
            models,
            catalogAgeMs: data.ageSec ? data.ageSec * 1000 : 0,
            cacheStale: Boolean(data.stale),
          };
          return entry;
        });
        return { ...prev, agents: next };
      });
      // 0682 CR-003 — AC-US3-03: surface staleness whenever ageSec > 600
      // (10 min), regardless of whether the server flagged stale=true.
      // Pre-fix the toast only fired on upstream-failure-served-from-cache;
      // an in-cache hit older than 10 min would silently slip past the AC.
      const ageSec = data.ageSec ?? 0;
      const isStale = data.stale === true || ageSec > 600;
      if (isStale) onStaleRef.current?.("openrouter", ageSec * 1000);
    } catch (e) {
      // 0682 CR-0682-M3 — Surface network/throw errors instead of swallowing.
      setOpenRouterError(`OpenRouter catalog unreachable: ${(e as Error).message}`);
    }
  }, []);

  const focusAgent = useCallback((agentId: string) => {
    focusedRef.current = agentId;
    if (agentId === "openrouter") void hydrateOpenRouter();
  }, [hydrateOpenRouter]);

  const refresh = useCallback(() => {
    openRouterFetchedAtRef.current = 0;
    void loadBase();
  }, [loadBase]);

  const setActive = useCallback(async (agentId: string, modelId: string) => {
    const resp = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: agentId, model: modelId }),
    });
    if (resp.ok) {
      setCatalog((prev) => prev ? { ...prev, activeAgent: agentId, activeModel: modelId } : prev);
      return;
    }
    // 0682 CR-002 — Surface non-OK responses through onSetActiveError so the
    // picker can toast. Pre-fix the popover closed with no user-visible
    // signal that the selection was rejected.
    // 0682 CR-0682-M2 — Use the stable ref so this callback's identity stays
    // constant even when consumers pass `opts` as an inline literal.
    let message = `Failed to set ${agentId} (${resp.status})`;
    try {
      const body = await resp.json();
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      /* keep generic message */
    }
    onSetActiveErrorRef.current?.(message);
  }, []);

  return {
    status,
    catalog,
    error,
    openRouterError,
    focusAgent,
    refresh,
    activeAgentId: catalog?.activeAgent ?? null,
    activeModelId: catalog?.activeModel ?? null,
    setActive,
  };
}
