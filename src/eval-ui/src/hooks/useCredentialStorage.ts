// ---------------------------------------------------------------------------
// useCredentialStorage — client-side key save/remove/list wrapper.
//
// All methods POST/GET/DELETE against /api/settings/keys. Keys are never
// stored in browser localStorage by this hook — the server is SSoT. The
// hook returns metadata only, never the raw key.
//
// 0702: Storage-mode selection removed. Keys persist server-side to
// `~/.vskill/keys.env`. Save signature no longer accepts a storage-mode
// parameter — there is a single storage path.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";

export type CredentialProvider = "anthropic" | "openai" | "openrouter";

export interface CredentialStatus {
  stored: boolean;
  updatedAt: string | null;
}

export interface CredentialStorageState {
  anthropic: CredentialStatus;
  openai: CredentialStatus;
  openrouter: CredentialStatus;
}

export interface UseCredentialStorageResult {
  state: CredentialStorageState | null;
  loading: boolean;
  error: string | null;
  save: (provider: CredentialProvider, key: string) => Promise<{ ok: boolean; warning?: string }>;
  remove: (provider: CredentialProvider) => Promise<void>;
  refresh: () => Promise<void>;
}

const INITIAL: CredentialStorageState = {
  anthropic: { stored: false, updatedAt: null },
  openai: { stored: false, updatedAt: null },
  openrouter: { stored: false, updatedAt: null },
};

export function useCredentialStorage(): UseCredentialStorageResult {
  const [state, setState] = useState<CredentialStorageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/settings/keys");
      if (!resp.ok) throw new Error(`GET /api/settings/keys returned ${resp.status}`);
      const data = (await resp.json()) as Partial<CredentialStorageState>;
      setState({ ...INITIAL, ...data });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setState(INITIAL);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (provider: CredentialProvider, key: string) => {
    const resp = await fetch("/api/settings/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, key }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(body.error || `POST /api/settings/keys returned ${resp.status}`);
    }
    const data = (await resp.json()) as { ok: boolean; warning?: string };
    await refresh();
    return data;
  }, [refresh]);

  const remove = useCallback(async (provider: CredentialProvider) => {
    const resp = await fetch(`/api/settings/keys/${provider}`, { method: "DELETE" });
    if (!resp.ok) {
      throw new Error(`DELETE /api/settings/keys/${provider} returned ${resp.status}`);
    }
    await refresh();
  }, [refresh]);

  return { state, loading, error, save, remove, refresh };
}
