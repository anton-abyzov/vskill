import { useCallback, useEffect, useRef } from "react";
import { useToast } from "../components/ToastProvider";
import type { CredentialProvider } from "./useCredentialStorage";

// ---------------------------------------------------------------------------
// 0702 T-042: useApiKeyErrorToast.
//
// Hook that listens for `studio:api-key-error` CustomEvents (dispatched by
// sse.ts when the server returns a 401 with `{ error: "invalid_api_key",
// provider }`) and surfaces an error toast pointing at SettingsModal.
//
// Also exposes a `report({provider})` method so non-SSE call sites can trigger
// the same toast without round-tripping through a DOM event.
//
// Clicking the toast's "Open Settings" action dispatches a
// `studio:open-settings` CustomEvent with `{provider}` — the App Shell
// listens and opens SettingsModal with `initialProvider` pre-focused.
//
// Dedupe: if the same provider reports twice within DEDUPE_MS, the second
// report is swallowed. Different providers get their own toasts.
// ---------------------------------------------------------------------------

const DEDUPE_MS = 3000;

const PROVIDER_LABELS: Record<CredentialProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

export interface ApiKeyErrorPayload {
  provider: CredentialProvider;
}

export interface UseApiKeyErrorToastResult {
  report: (payload: ApiKeyErrorPayload) => void;
}

function isCredentialProvider(v: unknown): v is CredentialProvider {
  return v === "anthropic" || v === "openai" || v === "openrouter";
}

export function useApiKeyErrorToast(): UseApiKeyErrorToastResult {
  const { toast } = useToast();
  const lastShownAtRef = useRef<Map<CredentialProvider, number>>(new Map());

  const report = useCallback(
    (payload: ApiKeyErrorPayload) => {
      if (!isCredentialProvider(payload.provider)) return;
      const now = Date.now();
      const prev = lastShownAtRef.current.get(payload.provider) ?? 0;
      if (now - prev < DEDUPE_MS) return;
      lastShownAtRef.current.set(payload.provider, now);

      const label = PROVIDER_LABELS[payload.provider];
      toast({
        message: `${label} API key invalid or missing. Open Settings →`,
        severity: "error",
        action: {
          label: "Open Settings",
          onInvoke: () => {
            if (typeof window === "undefined") return;
            window.dispatchEvent(
              new CustomEvent("studio:open-settings", {
                detail: { provider: payload.provider },
              }),
            );
          },
        },
      });
    },
    [toast],
  );

  useEffect(() => {
    function onEvent(e: Event) {
      const detail = (e as CustomEvent).detail as { provider?: unknown } | undefined;
      if (!detail || !isCredentialProvider(detail.provider)) return;
      report({ provider: detail.provider });
    }
    window.addEventListener("studio:api-key-error", onEvent);
    return () => window.removeEventListener("studio:api-key-error", onEvent);
  }, [report]);

  return { report };
}
