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
  pricing?: { prompt: number; completion: number };
  billingMode: "per-token" | "subscription" | "free";
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
    models: Array<{ id: string; label: string }>;
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
  "openrouter": "api-key",
  "cursor": "cli-install",
  "codex-cli": "cli-install",
  "gemini-cli": "cli-install",
  "copilot": "cli-install",
  "zed": "cli-install",
  "ollama": "start-service",
  "lm-studio": "start-service",
};

const BILLING_BY_AGENT: Record<string, ModelEntry["billingMode"]> = {
  "claude-cli": "subscription",
  "anthropic": "per-token",
  "openrouter": "per-token",
  "cursor": "subscription",
  "codex-cli": "subscription",
  "gemini-cli": "subscription",
  "copilot": "subscription",
  "zed": "subscription",
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
  };
}

function displayNameFor(id: string, fallback: string): string {
  const map: Record<string, string> = {
    "claude-cli": "Claude Code",
    "anthropic": "Anthropic API",
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
  focusAgent: (agentId: string) => void;
  refresh: () => void;
  activeAgentId: string | null;
  activeModelId: string | null;
  setActive: (agentId: string, modelId: string) => Promise<void>;
}

export function useAgentCatalog(opts?: { onStaleCatalog?: (agentId: string, ageMs: number) => void }): UseAgentCatalogResult {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const focusedRef = useRef<string | null>(null);
  const openRouterFetchedAtRef = useRef<number>(0);

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
      if (!resp.ok) return;
      const data = (await resp.json()) as OpenRouterModelsResponse;
      openRouterFetchedAtRef.current = now;
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
      if (data.stale && opts?.onStaleCatalog) {
        opts.onStaleCatalog("openrouter", (data.ageSec ?? 0) * 1000);
      }
    } catch {
      // Silent — the UI handles missing catalog as "add key" CTA.
    }
  }, [opts]);

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
    }
  }, []);

  return {
    status,
    catalog,
    error,
    focusAgent,
    refresh,
    activeAgentId: catalog?.activeAgent ?? null,
    activeModelId: catalog?.activeModel ?? null,
    setActive,
  };
}
