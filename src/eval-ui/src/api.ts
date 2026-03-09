// API client for the eval server
import type { EvalsFile, SkillInfo, BenchmarkResult, HistorySummary } from "./types";

const BASE = "";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: "claude-cli" | "anthropic" | "ollama";
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

  getLatestBenchmark(plugin: string, skill: string): Promise<BenchmarkResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/benchmark/latest`);
  },

  getHistory(plugin: string, skill: string): Promise<HistorySummary[]> {
    return fetchJson(`/api/skills/${plugin}/${skill}/history`);
  },

  getHistoryEntry(plugin: string, skill: string, timestamp: string): Promise<BenchmarkResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/history/${encodeURIComponent(timestamp)}`);
  },
};
