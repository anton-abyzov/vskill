// ---------------------------------------------------------------------------
// useInstallEngine — drives the install-engine flow from the browser.
// Ref: 0734 US-005 (AC-US5-04..AC-US5-06).
//
// State machine:
//   idle → spawning (POST /api/studio/install-engine fires)
//        → streaming (EventSource open, progress events arriving)
//        → success | failure
//
// On success the caller should re-fetch /api/studio/detect-engines so the UI
// reflects the new install.
// ---------------------------------------------------------------------------

import React from "react";
import type { Engine } from "../components/EngineSelector";

export type InstallStatus = "idle" | "spawning" | "streaming" | "success" | "failure";

export interface InstallProgressLine {
  stream: "stdout" | "stderr";
  line: string;
}

export interface InstallEngineState {
  status: InstallStatus;
  /** Last line of stdout, for the live tail UX. */
  liveTail: string;
  /** All progress events accumulated for the failure expandable details. */
  progress: InstallProgressLine[];
  exitCode: number | null;
  stderr: string;
  error: string | null;
}

const INITIAL_STATE: InstallEngineState = {
  status: "idle",
  liveTail: "",
  progress: [],
  exitCode: null,
  stderr: "",
  error: null,
};

export interface UseInstallEngineOpts {
  /** Override for tests — defaults to the global EventSource. */
  eventSourceCtor?: typeof EventSource;
  /** Override for tests — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface UseInstallEngineResult {
  state: InstallEngineState;
  install: (engine: Exclude<Engine, "none">) => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
}

export function useInstallEngine(opts: UseInstallEngineOpts = {}): UseInstallEngineResult {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const ESCtor = opts.eventSourceCtor ?? (globalThis as { EventSource?: typeof EventSource }).EventSource;

  const [state, setState] = React.useState<InstallEngineState>(INITIAL_STATE);
  const lastEngineRef = React.useRef<Exclude<Engine, "none"> | null>(null);
  const sourceRef = React.useRef<EventSource | null>(null);

  React.useEffect(() => {
    return () => {
      sourceRef.current?.close();
    };
  }, []);

  const reset = React.useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    lastEngineRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const install = React.useCallback(
    async (engine: Exclude<Engine, "none">) => {
      if (!ESCtor) {
        setState({ ...INITIAL_STATE, status: "failure", error: "EventSource not available" });
        return;
      }
      lastEngineRef.current = engine;
      setState({ ...INITIAL_STATE, status: "spawning" });

      let jobId: string;
      try {
        const res = await fetchImpl("/api/studio/install-engine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engine }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({} as Record<string, unknown>));
          setState({
            ...INITIAL_STATE,
            status: "failure",
            error:
              (errBody as { error?: string; remediation?: string }).remediation ??
              (errBody as { error?: string }).error ??
              `HTTP ${res.status}`,
          });
          return;
        }
        const data = (await res.json()) as { jobId: string };
        jobId = data.jobId;
      } catch (err) {
        setState({ ...INITIAL_STATE, status: "failure", error: (err as Error).message });
        return;
      }

      const source = new ESCtor(`/api/studio/install-engine/${jobId}/stream`);
      sourceRef.current = source;
      setState((prev) => ({ ...prev, status: "streaming" }));

      source.addEventListener("progress", (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as InstallProgressLine;
          setState((prev) => ({
            ...prev,
            liveTail: data.line.length > 60 ? data.line.slice(0, 60) + "…" : data.line,
            progress: [...prev.progress, data].slice(-200), // cap memory
          }));
        } catch { /* ignore malformed frames */ }
      });

      source.addEventListener("done", (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { success: boolean; exitCode: number; stderr: string };
          source.close();
          sourceRef.current = null;
          setState((prev) => ({
            ...prev,
            status: data.success ? "success" : "failure",
            exitCode: data.exitCode,
            stderr: data.stderr,
            error: data.success ? null : data.stderr || `exit ${data.exitCode}`,
          }));
        } catch {
          source.close();
          sourceRef.current = null;
          setState((prev) => ({ ...prev, status: "failure", error: "malformed done event" }));
        }
      });

      source.addEventListener("error", () => {
        source.close();
        sourceRef.current = null;
        setState((prev) => ({
          ...prev,
          status: prev.status === "streaming" ? "failure" : prev.status,
          error: prev.error ?? "stream error",
        }));
      });
    },
    [ESCtor, fetchImpl],
  );

  const retry = React.useCallback(async () => {
    const engine = lastEngineRef.current;
    if (!engine) return;
    await install(engine);
  }, [install]);

  return { state, install, retry, reset };
}
