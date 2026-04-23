// ---------------------------------------------------------------------------
// 0686 — useAgentsResponse: small hook that fetches /api/agents once and
// re-fetches on the `studio:agent-changed` data event. Decoupled from
// useAgentCatalog (0682) because they answer different questions:
//   - useAgentCatalog → "which agent+model do I run LLM calls against?"
//   - useAgentsResponse → "which agent's filesystem surface am I browsing?"
// Both can change independently.
//
// Failure modes:
//   - Network error → returns `null` response + `error` message; App falls
//     back to not mounting the picker so the sidebar still renders.
//   - Empty response → harmless; picker shows its own empty-hint.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AgentsResponse } from "../types";

export interface UseAgentsResponseResult {
  status: "loading" | "ready" | "error";
  response: AgentsResponse | null;
  error: string | null;
  refresh: () => void;
}

export function useAgentsResponse(): UseAgentsResponseResult {
  const [response, setResponse] = useState<AgentsResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getAgents();
      setResponse(data);
      setStatus("ready");
      setError(null);
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh whenever the active agent changes elsewhere in the app.
  useEffect(() => {
    const handler = () => void load();
    window.addEventListener("studio:agent-changed", handler as EventListener);
    return () => window.removeEventListener("studio:agent-changed", handler as EventListener);
  }, [load]);

  return { status, response, error, refresh: () => void load() };
}
