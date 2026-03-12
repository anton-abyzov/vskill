import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api";
import type { ConfigResponse, ProviderInfo } from "../api";
import { computeDiff } from "../utils/diff";
import type { DiffLine } from "../utils/diff";
import { ProgressLog } from "./ProgressLog";
import type { ProgressEntry } from "./ProgressLog";
import { ErrorCard } from "./ErrorCard";
import type { ClassifiedError } from "./ErrorCard";

interface Props {
  plugin: string;
  skill: string;
  skillContent: string;
  onApplied: (newContent: string) => void;
}

type PanelState = "closed" | "open" | "loading" | "diff_shown";

export function SkillImprovePanel({ plugin, skill, skillContent, onApplied }: Props) {
  const [state, setState] = useState<PanelState>("closed");
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("claude-cli");
  const [selectedModel, setSelectedModel] = useState<string>("opus");
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [improved, setImproved] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [classifiedError, setClassifiedError] = useState<ClassifiedError | null>(null);
  const [progress, setProgress] = useState<ProgressEntry[]>([]);
  const [applying, setApplying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api.getConfig().then((c) => {
      setConfig(c);
      // Default to opus for improvements
      const hasCli = c.providers.find((p) => p.id === "claude-cli" && p.available);
      if (hasCli) {
        setSelectedProvider("claude-cli");
        setSelectedModel("opus");
      }
    }).catch(() => {});
  }, []);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  function getAvailableModels(): ProviderInfo | undefined {
    return config?.providers.find((p) => p.id === selectedProvider && p.available);
  }

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setState("open");
  }, []);

  async function handleImprove() {
    setState("loading");
    setError(null);
    setClassifiedError(null);
    setProgress([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(plugin)}/${encodeURIComponent(skill)}/improve?sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedProvider, model: selectedModel }),
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
                setProgress((prev) => [...prev, { phase: data.phase, message: data.message, timestamp: Date.now() }]);
              } else if (currentEvent === "done" || currentEvent === "complete") {
                setImproved(data.improved);
                setReasoning(data.reasoning || "");
                setDiffLines(computeDiff(data.original || skillContent, data.improved));
                setState("diff_shown");
              } else if (currentEvent === "error") {
                setError(data.message || data.description || "Unknown error");
                if (data.category) {
                  setClassifiedError(data as ClassifiedError);
                }
                setState("open");
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
        setError((err as Error).message);
        setState("open");
      }
    } finally {
      abortRef.current = null;
    }
  }

  async function handleApply() {
    setApplying(true);
    try {
      await api.applyImprovement(plugin, skill, improved);
      onApplied(improved);
      setState("closed");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  function handleDiscard() {
    setState("closed");
    setDiffLines([]);
    setImproved("");
    setReasoning("");
    setError(null);
  }

  if (state === "closed") {
    return (
      <button
        onClick={() => setState("open")}
        className="btn btn-secondary mb-5"
        disabled={!skillContent}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
        </svg>
        Improve Skill
      </button>
    );
  }

  const provider = getAvailableModels();

  return (
    <div
      className="mb-5 rounded-xl overflow-hidden animate-fade-in"
      style={{ border: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5"
        style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(168,85,247,0.15)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            AI Skill Improvement
          </span>
        </div>
        <button
          onClick={handleDiscard}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150"
          style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="px-5 py-4">
        {/* Model picker */}
        {(state === "open" || state === "loading") && (<>
          <div className="flex items-end gap-3 mb-4">
            <div className="flex-1">
              <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-tertiary)" }}>Provider</label>
              <select
                className="input-field text-[12px] py-1.5"
                value={selectedProvider}
                onChange={(e) => {
                  setSelectedProvider(e.target.value);
                  const p = config?.providers.find((p) => p.id === e.target.value);
                  if (p?.models[0]) setSelectedModel(p.models[0].id);
                }}
                disabled={state === "loading"}
              >
                {config?.providers.filter((p) => p.available).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-tertiary)" }}>Model</label>
              <select
                className="input-field text-[12px] py-1.5"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={state === "loading"}
              >
                {provider?.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            {state === "loading" ? (
              <button
                onClick={handleCancel}
                className="btn btn-secondary flex-shrink-0"
              >
                Cancel
              </button>
            ) : (
              <button
                onClick={handleImprove}
                className="btn btn-primary flex-shrink-0"
              >
                Improve
              </button>
            )}
          </div>

          {/* Progress log during generation */}
          {state === "loading" && progress.length > 0 && (
            <div className="mt-3">
              <ProgressLog entries={progress} isRunning={true} />
            </div>
          )}
        </>)}

        {/* Error */}
        {error && (
          <div className="mb-4">
            {classifiedError ? (
              <ErrorCard
                error={classifiedError}
                onRetry={handleImprove}
                onDismiss={() => { setError(null); setClassifiedError(null); }}
              />
            ) : (
              <div className="px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)" }}>
                {error}
              </div>
            )}
          </div>
        )}

        {/* Diff view */}
        {state === "diff_shown" && (
          <>
            {/* Reasoning */}
            {reasoning && (
              <div className="mb-4 px-4 py-3 rounded-lg text-[12px]" style={{ background: "rgba(168,85,247,0.08)", color: "var(--text-secondary)", border: "1px solid rgba(168,85,247,0.2)" }}>
                <span className="font-semibold" style={{ color: "#a855f7" }}>AI Reasoning: </span>
                {reasoning}
              </div>
            )}

            {/* Diff lines */}
            <div
              className="rounded-lg overflow-hidden mb-4"
              style={{ border: "1px solid var(--border-subtle)", maxHeight: "400px", overflowY: "auto" }}
            >
              {diffLines.map((line, i) => (
                <div
                  key={i}
                  className="px-3 py-0.5 text-[11px] font-mono"
                  style={{
                    background:
                      line.type === "added" ? "rgba(34,197,94,0.1)" :
                      line.type === "removed" ? "rgba(239,68,68,0.1)" :
                      "transparent",
                    color:
                      line.type === "added" ? "var(--green)" :
                      line.type === "removed" ? "var(--red)" :
                      "var(--text-secondary)",
                    borderLeft:
                      line.type === "added" ? "3px solid var(--green)" :
                      line.type === "removed" ? "3px solid var(--red)" :
                      "3px solid transparent",
                  }}
                >
                  <span style={{ userSelect: "none", opacity: 0.5, marginRight: 8 }}>
                    {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                  </span>
                  {line.content}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleApply}
                disabled={applying}
                className="btn btn-primary"
              >
                {applying ? (
                  <><div className="spinner" style={{ width: 12, height: 12 }} /> Applying...</>
                ) : (
                  <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> Apply</>
                )}
              </button>
              <button onClick={handleDiscard} className="btn btn-secondary">
                Discard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
