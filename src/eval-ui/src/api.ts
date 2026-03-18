// API client for the eval server
import type { EvalsFile, SkillInfo, BenchmarkResult, HistorySummary, HistoryFilter, HistoryCompareResult, CaseHistoryEntry, ImproveResult, SmartEditResult, DependenciesResponse, StatsResult, ProjectLayoutResponse, CreateSkillRequest, CreateSkillResponse, SaveDraftRequest, SaveDraftResponse, SkillCreatorStatus, GenerateSkillResponse, SkillFileEntry, SkillFileContent, SweepResult, CredentialStatus, OpenRouterModel } from "./types";

const BASE = "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || `HTTP ${res.status}`, res.status);
  }
  return res.json();
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: "claude-cli" | "anthropic" | "ollama" | "openrouter" | "gemini-cli" | "codex-cli";
  label: string;
  available: boolean;
  models: ModelOption[];
}

export interface ConfigResponse {
  provider: string | null;
  model: string;
  providers: ProviderInfo[];
  projectName: string | null;
  root: string;
  error?: string;
}

export const api = {
  getConfig(): Promise<ConfigResponse> {
    return fetchJson("/api/config");
  },

  setConfig(provider: string, model?: string): Promise<ConfigResponse> {
    return fetchJson("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model }),
    });
  },

  getSkills(): Promise<SkillInfo[]> {
    return fetchJson("/api/skills");
  },

  getSkillDetail(plugin: string, skill: string): Promise<{ plugin: string; skill: string; skillContent: string }> {
    return fetchJson(`/api/skills/${plugin}/${skill}`);
  },

  getEvals(plugin: string, skill: string): Promise<EvalsFile> {
    return fetchJson(`/api/skills/${plugin}/${skill}/evals`);
  },

  saveEvals(plugin: string, skill: string, data: EvalsFile): Promise<EvalsFile> {
    return fetchJson(`/api/skills/${plugin}/${skill}/evals`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  generateEvals(plugin: string, skill: string): Promise<EvalsFile> {
    return fetchJson(`/api/skills/${plugin}/${skill}/generate-evals`, {
      method: "POST",
    });
  },

  async getLatestBenchmark(plugin: string, skill: string): Promise<BenchmarkResult | null> {
    const res = await fetch(`${BASE}/api/skills/${plugin}/${skill}/benchmark/latest`);
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(body.error || `HTTP ${res.status}`, res.status);
    }
    return res.json();
  },

  getHistory(plugin: string, skill: string, filters?: HistoryFilter): Promise<HistorySummary[]> {
    const params = new URLSearchParams();
    if (filters?.model) params.set("model", filters.model);
    if (filters?.type) params.set("type", filters.type);
    if (filters?.from) params.set("from", filters.from);
    if (filters?.to) params.set("to", filters.to);
    const qs = params.toString();
    return fetchJson(`/api/skills/${plugin}/${skill}/history${qs ? "?" + qs : ""}`);
  },

  getHistoryEntry(plugin: string, skill: string, timestamp: string): Promise<BenchmarkResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/history/${encodeURIComponent(timestamp)}`);
  },

  compareRuns(plugin: string, skill: string, a: string, b: string): Promise<HistoryCompareResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/history-compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  },

  getCaseHistory(plugin: string, skill: string, evalId: number, model?: string): Promise<CaseHistoryEntry[]> {
    const params = new URLSearchParams();
    if (model) params.set("model", model);
    const qs = params.toString();
    return fetchJson(`/api/skills/${plugin}/${skill}/history/case/${evalId}${qs ? "?" + qs : ""}`);
  },

  deleteHistoryEntry(plugin: string, skill: string, timestamp: string): Promise<{ ok: boolean }> {
    return fetchJson(`/api/skills/${plugin}/${skill}/history/${encodeURIComponent(timestamp)}`, {
      method: "DELETE",
    });
  },

  deleteSkill(plugin: string, skill: string): Promise<{ ok: boolean }> {
    return fetchJson(`/api/skills/${plugin}/${skill}`, { method: "DELETE" });
  },

  improveSkill(plugin: string, skill: string, opts: { provider?: string; model?: string; eval_id?: number; notes?: string }): Promise<ImproveResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/improve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
  },

  instructEdit(plugin: string, skill: string, opts: { instruction: string; content: string; evals?: EvalsFile; provider?: string; model?: string }): Promise<SmartEditResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/improve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "instruct", ...opts }),
    });
  },

  applyImprovement(plugin: string, skill: string, content: string): Promise<{ ok: boolean }> {
    return fetchJson(`/api/skills/${plugin}/${skill}/apply-improvement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  },

  getStats(plugin: string, skill: string): Promise<StatsResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/stats`);
  },

  getDependencies(plugin: string, skill: string): Promise<DependenciesResponse> {
    return fetchJson(`/api/skills/${plugin}/${skill}/dependencies`);
  },

  getProjectLayout(): Promise<ProjectLayoutResponse> {
    return fetchJson("/api/project-layout");
  },

  createSkill(data: CreateSkillRequest): Promise<CreateSkillResponse> {
    return fetchJson("/api/skills/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  saveDraft(data: SaveDraftRequest): Promise<SaveDraftResponse> {
    return fetchJson("/api/skills/save-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  getSkillCreatorStatus(): Promise<SkillCreatorStatus> {
    return fetchJson("/api/skill-creator-status");
  },

  generateSkill(opts: { prompt: string; provider?: string; model?: string }): Promise<GenerateSkillResponse> {
    return fetchJson("/api/skills/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
  },

  getSkillFiles(plugin: string, skill: string): Promise<{ files: SkillFileEntry[] }> {
    return fetchJson(`/api/skills/${plugin}/${skill}/files`);
  },

  getSkillFile(plugin: string, skill: string, path: string): Promise<SkillFileContent> {
    return fetchJson(`/api/skills/${plugin}/${skill}/file?path=${encodeURIComponent(path)}`);
  },

  saveSkillFile(plugin: string, skill: string, path: string, content: string): Promise<{ ok: boolean; path: string; size: number }> {
    return fetchJson(`/api/skills/${plugin}/${skill}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
  },

  // ---------------------------------------------------------------------------
  // Leaderboard / Sweep (T-055)
  // ---------------------------------------------------------------------------

  getLeaderboard(plugin: string, skill: string): Promise<{ entries: SweepResult[] }> {
    return fetchJson(`/api/skills/${plugin}/${skill}/leaderboard`);
  },

  getLeaderboardEntry(plugin: string, skill: string, timestamp: string): Promise<SweepResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/leaderboard/${encodeURIComponent(timestamp)}`);
  },

  startSweep(plugin: string, skill: string, body: { models: string[]; judge: string; runs?: number; concurrency?: number }): EventSource {
    const url = `${BASE}/api/skills/${plugin}/${skill}/sweep`;
    const es = new EventSource(url);
    // POST-based SSE: use fetch instead and return an EventSource-like object
    // The backend expects POST, so we use fetch with ReadableStream
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    return es;
  },

  // ---------------------------------------------------------------------------
  // Credentials (T-055)
  // ---------------------------------------------------------------------------

  getCredentials(plugin: string, skill: string): Promise<{ credentials: CredentialStatus[] }> {
    return fetchJson(`/api/credentials/${plugin}/${skill}`);
  },

  setCredential(plugin: string, skill: string, name: string, value: string): Promise<{ ok: boolean; credential: CredentialStatus }> {
    return fetchJson(`/api/credentials/${plugin}/${skill}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, value }),
    });
  },

  getParams(plugin: string, skill: string): Promise<{ params: Array<{ name: string; maskedValue: string; value?: string; status: string }> }> {
    return fetchJson(`/api/credentials/${plugin}/${skill}/params`);
  },

  getParamsRevealed(plugin: string, skill: string, key?: string): Promise<{ params: Array<{ name: string; maskedValue: string; value?: string; status: string }> }> {
    const qs = key ? `reveal=true&key=${encodeURIComponent(key)}` : "reveal=true";
    return fetchJson(`/api/credentials/${plugin}/${skill}/params?${qs}`);
  },

  // ---------------------------------------------------------------------------
  // OpenRouter models (T-055)
  // ---------------------------------------------------------------------------

  searchModels(): Promise<{ models: OpenRouterModel[] }> {
    return fetchJson("/api/openrouter/models");
  },
};
