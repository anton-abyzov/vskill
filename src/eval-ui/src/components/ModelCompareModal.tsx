import { useState, useEffect, useRef, useCallback } from "react";
import { useSSE } from "../sse";
import { useConfig } from "../ConfigContext";
import type { ProviderInfo } from "../api";
import type { EvalCase, BenchmarkAssertionResult } from "../types";

interface ModelResult {
  model: string;
  output: string;
  durationMs: number;
  tokens: number | null;
  assertions: BenchmarkAssertionResult[];
  passRate: number;
}

interface Props {
  plugin: string;
  skill: string;
  evalCase: EvalCase;
  onClose: () => void;
}

type CompareState = "idle" | "running_a" | "running_b" | "complete";

export function ModelCompareModal({ plugin, skill, evalCase, onClose }: Props) {
  const { config } = useConfig();
  const [providerA, setProviderA] = useState("claude-cli");
  const [modelA, setModelA] = useState("sonnet");
  const [providerB, setProviderB] = useState("claude-cli");
  const [modelB, setModelB] = useState("opus");
  const [compareState, setCompareState] = useState<CompareState>("idle");
  const [resultA, setResultA] = useState<ModelResult | null>(null);
  const [resultB, setResultB] = useState<ModelResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { events, running, start: sseStart, stop: sseStop } = useSSE();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && compareState !== "running_a" && compareState !== "running_b") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, compareState]);

  // Process SSE events
  useEffect(() => {
    for (const evt of events) {
      if (evt.event === "model_a_start") {
        setCompareState("running_a");
      } else if (evt.event === "model_a_result") {
        setResultA(evt.data as ModelResult);
        setCompareState("running_b");
      } else if (evt.event === "model_b_start") {
        setCompareState("running_b");
      } else if (evt.event === "model_b_result") {
        setResultB(evt.data as ModelResult);
      } else if (evt.event === "done") {
        setCompareState("complete");
      } else if (evt.event === "error") {
        setError((evt.data as { error: string }).error);
        setCompareState("complete");
      }
    }
  }, [events]);

  // Also set complete when SSE finishes
  useEffect(() => {
    if (!running && (compareState === "running_a" || compareState === "running_b")) {
      setCompareState("complete");
    }
  }, [running, compareState]);

  function handleCompare() {
    setResultA(null);
    setResultB(null);
    setError(null);
    setCompareState("running_a");
    sseStart(`/api/skills/${plugin}/${skill}/compare-models`, {
      eval_id: evalCase.id,
      modelA: { provider: providerA, model: modelA },
      modelB: { provider: providerB, model: modelB },
    });
  }

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current && compareState !== "running_a" && compareState !== "running_b") {
      onClose();
    }
  }, [onClose, compareState]);

  function getProviderModels(providerId: string): ProviderInfo | undefined {
    return config?.providers.find((p) => p.id === providerId && p.available);
  }

  const isRunning = compareState === "running_a" || compareState === "running_b";

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-overlay-in"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-4xl animate-modal-in flex flex-col"
        style={{
          background: "var(--surface-1)",
          border: "1px solid var(--border-default)",
          borderRadius: "16px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          maxHeight: "min(90vh, 800px)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(99,131,255,0.15)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 3h5v5" /><path d="M8 21H3v-5" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
              </svg>
            </div>
            <div>
              <h3 className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>Compare Models</h3>
              <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                #{evalCase.id} — {evalCase.name}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isRunning}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-150"
            style={{ color: "var(--text-tertiary)", opacity: isRunning ? 0.3 : 1 }}
            onMouseEnter={(e) => { if (!isRunning) e.currentTarget.style.background = "var(--surface-3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5" style={{ minHeight: 0 }}>
          {/* Model selectors */}
          {compareState === "idle" && (
            <div className="grid grid-cols-2 gap-4 mb-5">
              {/* Model A */}
              <div className="p-4 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
                <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-tertiary)" }}>Model A</div>
                <select
                  className="input-field text-[12px] py-1.5 mb-2 w-full"
                  value={providerA}
                  onChange={(e) => {
                    setProviderA(e.target.value);
                    const p = config?.providers.find((p) => p.id === e.target.value);
                    if (p?.models[0]) setModelA(p.models[0].id);
                  }}
                >
                  {config?.providers.filter((p) => p.available).map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <select
                  className="input-field text-[12px] py-1.5 w-full"
                  value={modelA}
                  onChange={(e) => setModelA(e.target.value)}
                >
                  {getProviderModels(providerA)?.models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* Model B */}
              <div className="p-4 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
                <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-tertiary)" }}>Model B</div>
                <select
                  className="input-field text-[12px] py-1.5 mb-2 w-full"
                  value={providerB}
                  onChange={(e) => {
                    setProviderB(e.target.value);
                    const p = config?.providers.find((p) => p.id === e.target.value);
                    if (p?.models[0]) setModelB(p.models[0].id);
                  }}
                >
                  {config?.providers.filter((p) => p.available).map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <select
                  className="input-field text-[12px] py-1.5 w-full"
                  value={modelB}
                  onChange={(e) => setModelB(e.target.value)}
                >
                  {getProviderModels(providerB)?.models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Progress / Running state */}
          {isRunning && (
            <div className="flex items-center justify-center gap-3 py-8">
              <div className="spinner" style={{ width: 20, height: 20 }} />
              <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
                {compareState === "running_a" ? "Model A running..." : "Model A done, Model B running..."}
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)" }}>
              {error}
            </div>
          )}

          {/* Results side-by-side */}
          {(resultA || resultB) && (
            <div className="grid grid-cols-2 gap-4">
              <ModelResultCard label="Model A" result={resultA} />
              <ModelResultCard label="Model B" result={resultB} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Results are saved to benchmark history
          </span>
          <div className="flex gap-2">
            {compareState === "idle" && (
              <button onClick={handleCompare} className="btn btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Compare
              </button>
            )}
            {compareState === "complete" && (
              <button onClick={onClose} className="btn btn-secondary">Close</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelResultCard({ label, result }: { label: string; result: ModelResult | null }) {
  const [showOutput, setShowOutput] = useState(false);

  if (!result) {
    return (
      <div className="p-4 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-tertiary)" }}>{label}</div>
        <div className="flex items-center justify-center py-6" style={{ color: "var(--text-tertiary)" }}>
          <span className="text-[12px]">Waiting...</span>
        </div>
      </div>
    );
  }

  const passCount = result.assertions.filter((a) => a.pass).length;
  const pct = Math.round(result.passRate * 100);

  return (
    <div className="p-4 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>{label}</div>
        <span
          className="pill"
          style={{
            background: pct >= 80 ? "var(--green-muted)" : pct >= 50 ? "var(--yellow-muted)" : "var(--red-muted)",
            color: pct >= 80 ? "var(--green)" : pct >= 50 ? "var(--yellow)" : "var(--red)",
          }}
        >
          {pct}%
        </span>
      </div>

      {/* Model info */}
      <div className="text-[12px] font-medium mb-2" style={{ color: "var(--text-primary)" }}>{result.model}</div>
      <div className="flex gap-3 text-[11px] mb-3" style={{ color: "var(--text-tertiary)" }}>
        <span>{(result.durationMs / 1000).toFixed(1)}s</span>
        {result.tokens != null && <span>{result.tokens.toLocaleString()} tokens</span>}
        <span>{passCount}/{result.assertions.length} passed</span>
      </div>

      {/* Assertions */}
      <div className="space-y-1.5 mb-3">
        {result.assertions.map((a) => (
          <div
            key={a.id}
            className="flex items-start gap-2 p-2 rounded-lg text-[11px]"
            style={{ background: a.pass ? "var(--green-muted)" : "var(--red-muted)" }}
          >
            <div
              className="w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: a.pass ? "var(--green)" : "var(--red)" }}
            >
              <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                {a.pass ? <polyline points="20 6 9 17 4 12" /> : <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>}
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium" style={{ color: "var(--text-primary)" }}>{a.text}</div>
              <div className="mt-0.5" style={{ color: "var(--text-secondary)" }}>{a.reasoning}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Output toggle */}
      <button
        onClick={() => setShowOutput(!showOutput)}
        className="flex items-center gap-1.5 text-[11px] font-medium transition-colors duration-150"
        style={{ color: "var(--text-tertiary)" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: showOutput ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s ease" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        {showOutput ? "Hide Output" : "Show Output"}
      </button>
      {showOutput && (
        <pre
          className="mt-2 text-[11px] leading-relaxed p-3 rounded-lg max-h-40 overflow-y-auto whitespace-pre-wrap animate-fade-in"
          style={{ background: "var(--surface-0)", color: "var(--text-secondary)", fontFamily: "var(--font-mono, monospace)" }}
        >
          {result.output}
        </pre>
      )}
    </div>
  );
}
