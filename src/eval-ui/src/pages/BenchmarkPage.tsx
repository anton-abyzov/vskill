import { useState, useEffect, useRef } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { useSSE } from "../sse";
import { api } from "../api";
import { useConfig } from "../ConfigContext";
import { GroupedBarChart } from "../components/GroupedBarChart";
import { ProgressLog } from "../components/ProgressLog";
import type { ProgressEntry } from "../components/ProgressLog";
import type { EvalsFile, BenchmarkResult, CaseHistoryEntry } from "../types";

interface AssertionEvent {
  eval_id: number;
  assertion_id: string;
  text: string;
  pass: boolean;
  reasoning: string;
}

interface CaseCompleteEvent {
  eval_id: number;
  eval_name?: string;
  status: string;
  pass_rate?: number;
  error_message?: string;
  durationMs?: number;
  tokens?: number | null;
}

interface OutputReadyEvent {
  eval_id: number;
  output: string;
  durationMs?: number;
  tokens?: number | null;
}

interface CaseData {
  name?: string;
  output?: string;
  assertions: AssertionEvent[];
  status?: string;
  passRate?: number;
  errorMessage?: string;
  durationMs?: number;
  tokens?: number | null;
}

export function BenchmarkPage() {
  const { plugin, skill } = useParams<{ plugin: string; skill: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { events, running, done, error, start } = useSSE();
  const { config: globalConfig } = useConfig();
  const [expandedOutputs, setExpandedOutputs] = useState<Set<number>>(new Set());
  const model = globalConfig?.model ?? null;
  const [evalCases, setEvalCases] = useState<EvalsFile | null>(null);
  const [runScope, setRunScope] = useState<"all" | number | null>(null);
  const [previousBenchmark, setPreviousBenchmark] = useState<BenchmarkResult | null>(null);
  const [isBaselineMode, setIsBaselineMode] = useState(false);
  const [expandedCaseHistory, setExpandedCaseHistory] = useState<number | null>(null);
  const [caseHistoryData, setCaseHistoryData] = useState<CaseHistoryEntry[]>([]);
  const [caseHistoryModelFilter, setCaseHistoryModelFilter] = useState<string>("");
  const [caseHistoryLoading, setCaseHistoryLoading] = useState(false);
  const autostartedRef = useRef(false);

  useEffect(() => {
    if (plugin && skill) {
      api.getEvals(plugin, skill).then(setEvalCases).catch(() => {});
      api.getLatestBenchmark(plugin, skill).then(setPreviousBenchmark).catch(() => {});
    }
  }, [plugin, skill]);

  // Autostart support
  useEffect(() => {
    if (autostartedRef.current) return;
    if (!plugin || !skill) return;
    const autostart = searchParams.get("autostart");
    const mode = searchParams.get("mode");
    if (autostart === "true") {
      autostartedRef.current = true;
      if (mode === "baseline") {
        handleStartBaseline();
      } else {
        handleStartBenchmark();
      }
    }
  }, [plugin, skill, searchParams]);

  function handleStartBenchmark(evalIds?: number[]) {
    setExpandedOutputs(new Set());
    setIsBaselineMode(false);
    setRunScope(evalIds?.length === 1 ? evalIds[0] : "all");
    const body = evalIds ? { eval_ids: evalIds } : undefined;
    start(`/api/skills/${plugin}/${skill}/benchmark`, body);
  }

  function handleStartBaseline() {
    setExpandedOutputs(new Set());
    setIsBaselineMode(true);
    setRunScope("all");
    start(`/api/skills/${plugin}/${skill}/baseline`);
  }

  function toggleCaseHistory(evalId: number) {
    if (expandedCaseHistory === evalId) {
      setExpandedCaseHistory(null);
      setCaseHistoryData([]);
      setCaseHistoryModelFilter("");
      return;
    }
    setExpandedCaseHistory(evalId);
    setCaseHistoryModelFilter("");
    loadCaseHistory(evalId);
  }

  function loadCaseHistory(evalId: number, modelFilter?: string) {
    if (!plugin || !skill) return;
    setCaseHistoryLoading(true);
    api.getCaseHistory(plugin, skill, evalId, modelFilter || undefined)
      .then(setCaseHistoryData)
      .catch(() => setCaseHistoryData([]))
      .finally(() => setCaseHistoryLoading(false));
  }

  function toggleExpand(evalId: number) {
    setExpandedOutputs((prev) => {
      const next = new Set(prev);
      next.has(evalId) ? next.delete(evalId) : next.add(evalId);
      return next;
    });
  }

  // Process events into results + progress log
  const currentResults = new Map<number, CaseData>();
  const progressEntries: ProgressEntry[] = [];
  for (const evt of events) {
    if (evt.event === "progress") {
      const d = evt.data as { eval_id: number; phase: string; message: string; current?: number; total?: number };
      progressEntries.push({
        timestamp: Date.now(),
        evalId: d.eval_id,
        phase: d.phase,
        message: d.message,
        current: d.current,
        total: d.total,
      });
    }
    if (evt.event === "case_start") {
      const d = evt.data as { eval_id: number; eval_name?: string };
      if (!currentResults.has(d.eval_id)) {
        currentResults.set(d.eval_id, { name: d.eval_name, assertions: [] });
      }
    }
    if (evt.event === "output_ready") {
      const d = evt.data as OutputReadyEvent;
      const existing = currentResults.get(d.eval_id) || { assertions: [] };
      existing.output = d.output;
      if (d.durationMs != null) existing.durationMs = d.durationMs;
      if (d.tokens != null) existing.tokens = d.tokens;
      currentResults.set(d.eval_id, existing);
    }
    if (evt.event === "assertion_result") {
      const d = evt.data as AssertionEvent;
      const existing = currentResults.get(d.eval_id) || { assertions: [] };
      if (!existing.assertions.find((a) => a.assertion_id === d.assertion_id)) {
        existing.assertions.push(d);
        currentResults.set(d.eval_id, existing);
      }
    }
    if (evt.event === "case_complete") {
      const d = evt.data as CaseCompleteEvent;
      const existing = currentResults.get(d.eval_id) || { assertions: [] };
      existing.status = d.status;
      existing.passRate = d.pass_rate;
      existing.errorMessage = d.error_message || undefined;
      currentResults.set(d.eval_id, existing);
    }
  }

  const doneEvent = events.find((e) => e.event === "done");
  const doneData = doneEvent?.data as { overall_pass_rate?: number } | undefined;
  const overallPct = doneData?.overall_pass_rate !== undefined ? Math.round(doneData.overall_pass_rate * 100) : null;

  return (
    <div className="px-10 py-8 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5 text-[13px]">
        <Link to={`/skills/${plugin}/${skill}`} className="transition-colors duration-150" style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
        >
          {skill}
        </Link>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{isBaselineMode ? "Baseline (no skill)" : "Benchmark"}</span>
      </div>

      <div className="mb-3">
        <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          Runs your skill against each eval case. An LLM judge grades every assertion against the actual output.
        </p>
      </div>

      {/* Run buttons */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => handleStartBenchmark()}
          disabled={running}
          className="btn btn-primary"
          title="Run all eval cases with your skill and grade assertions"
        >
          {running && runScope === "all" && !isBaselineMode ? (
            <><div className="spinner" style={{ borderTopColor: "#fff", borderColor: "rgba(255,255,255,0.2)", width: 14, height: 14 }} /> Running All...</>
          ) : (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg> Run All ({evalCases?.evals.length ?? 0} cases)</>
          )}
        </button>
        <button
          onClick={() => handleStartBaseline()}
          disabled={running}
          className="btn btn-ghost"
          style={{ color: "#f97316", border: "1px solid rgba(249,115,22,0.4)" }}
          title="Run all eval cases without your skill to measure raw LLM capability"
        >
          {running && isBaselineMode ? (
            <><div className="spinner" style={{ borderTopColor: "#f97316", borderColor: "rgba(249,115,22,0.2)", width: 14, height: 14 }} /> Running Baseline...</>
          ) : (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg> Run Baseline</>
          )}
        </button>
        <button
          onClick={() => navigate(`/skills/${plugin}/${skill}/compare`)}
          className="btn btn-purple"
          title="Run each case both with and without your skill, then blind-score and compare"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
          Run A/B
        </button>
      </div>
      <p className="text-[11px] mb-7" style={{ color: "var(--text-tertiary)" }}>
        Tip: Use A/B to see if your skill actually improves output quality
      </p>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
          {error}
        </div>
      )}

      {/* Previous benchmark summary bar */}
      {!running && currentResults.size === 0 && previousBenchmark && (() => {
        const passed = previousBenchmark.cases.filter((c) => c.status === "pass").length;
        const total = previousBenchmark.cases.length;
        const pct = previousBenchmark.overall_pass_rate !== undefined
          ? Math.round(previousBenchmark.overall_pass_rate * 100)
          : total > 0 ? Math.round((passed / total) * 100) : 0;
        const totalMs = previousBenchmark.cases.reduce((s, c) => s + (c.durationMs ?? 0), 0);
        const when = new Date(previousBenchmark.timestamp);
        return (
          <div className="mb-5 px-4 py-3 rounded-lg flex items-center justify-between" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
            <div className="flex items-center gap-3">
              <span className="text-[20px] font-bold" style={{ color: pct >= 80 ? "var(--green)" : pct >= 50 ? "var(--yellow)" : "var(--red)" }}>{pct}%</span>
              <div>
                <div className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>Last Benchmark — {passed}/{total} passed</div>
                <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {previousBenchmark.model} · {when.toLocaleString()}{totalMs > 0 ? ` · ${(totalMs / 1000).toFixed(1)}s` : ""}
                </div>
              </div>
            </div>
            <span className="pill" style={{
              background: pct >= 80 ? "var(--green-muted)" : pct >= 50 ? "var(--yellow-muted)" : "var(--red-muted)",
              color: pct >= 80 ? "var(--green)" : pct >= 50 ? "var(--yellow)" : "var(--red)",
            }}>
              {pct >= 80 ? "Healthy" : pct >= 50 ? "Needs Work" : "Failing"}
            </span>
          </div>
        );
      })()}

      {/* Eval case list with per-case Run buttons and previous results (shown when not running and no current results) */}
      {!running && currentResults.size === 0 && evalCases && evalCases.evals.length > 0 && (
        <div className="space-y-2 mb-6">
          <div className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-tertiary)" }}>
            Eval Cases
          </div>
          {evalCases.evals.map((ec) => {
            const prev = previousBenchmark?.cases.find((c) => c.eval_id === ec.id);
            return (
              <div
                key={ec.id}
                className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-100"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
              >
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>
                  #{ec.id}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{ec.name}</div>
                  <div className="text-[11px] truncate mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                    {ec.assertions.length} assertion{ec.assertions.length !== 1 ? "s" : ""}
                  </div>
                </div>
                {/* Previous result pill */}
                {prev && (
                  <span
                    className="pill flex-shrink-0"
                    style={{
                      background: prev.status === "pass" ? "var(--green-muted)" : prev.status === "error" ? "var(--yellow-muted)" : "var(--red-muted)",
                      color: prev.status === "pass" ? "var(--green)" : prev.status === "error" ? "var(--yellow)" : "var(--red)",
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{
                      background: prev.status === "pass" ? "var(--green)" : prev.status === "error" ? "var(--yellow)" : "var(--red)"
                    }} />
                    {prev.status} {Math.round(prev.pass_rate * 100)}%
                    {prev.durationMs != null && <span className="ml-1 opacity-70">{(prev.durationMs / 1000).toFixed(1)}s</span>}
                  </span>
                )}
                <button
                  onClick={() => handleStartBenchmark([ec.id])}
                  disabled={running}
                  className="btn btn-ghost text-[12px] flex-shrink-0"
                  style={{ color: "var(--accent)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  Run
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Results */}
      {currentResults.size > 0 && (
        <div className="space-y-3 stagger-children">
          {Array.from(currentResults.entries()).map(([evalId, data]) => {
            const isExpanded = expandedOutputs.has(evalId);
            const isCompleted = !!data.status;
            const isHistoryOpen = expandedCaseHistory === evalId;

            return (
              <div key={evalId} className="glass-card overflow-hidden">
                <div
                  className="p-5"
                  style={{ cursor: isCompleted ? "pointer" : "default" }}
                  onClick={() => { if (isCompleted) toggleCaseHistory(evalId); }}
                >
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>
                        #{evalId}
                      </span>
                      <h4 className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                        {data.name || "Eval Case"}
                      </h4>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Time & tokens */}
                      {data.durationMs != null && (
                        <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>
                          {(data.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                      {data.tokens != null && (
                        <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>
                          {data.tokens.toLocaleString()} tok
                        </span>
                      )}
                      {/* Status pill */}
                      {data.status ? (
                        <span
                          className="pill"
                          style={{
                            background: data.status === "pass" ? "var(--green-muted)" : data.status === "error" ? "var(--yellow-muted)" : "var(--red-muted)",
                            color: data.status === "pass" ? "var(--green)" : data.status === "error" ? "var(--yellow)" : "var(--red)",
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{
                            background: data.status === "pass" ? "var(--green)" : data.status === "error" ? "var(--yellow)" : "var(--red)"
                          }} />
                          {data.status} {data.passRate !== undefined ? `${Math.round(data.passRate * 100)}%` : ""}
                        </span>
                      ) : (
                        <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--accent)" }}>
                          <div className="spinner" style={{ width: 12, height: 12 }} />
                          Evaluating...
                        </div>
                      )}
                      {/* History expand indicator */}
                      {isCompleted && (
                        <svg
                          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5"
                          style={{ transform: isHistoryOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s ease", flexShrink: 0 }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      )}
                    </div>
                  </div>

                  {/* Error message */}
                  {data.errorMessage && (
                    <div className="mb-3 p-3 rounded-lg text-[12px]" style={{ background: "var(--red-muted)", color: "var(--red)" }}>
                      {data.errorMessage}
                    </div>
                  )}

                  {/* Assertions */}
                  <div className="space-y-2">
                    {data.assertions.map((a) => (
                      <div
                        key={a.assertion_id}
                        className="flex items-start gap-3 p-3 rounded-lg animate-fade-in"
                        style={{ background: a.pass ? "var(--green-muted)" : "var(--red-muted)" }}
                      >
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ background: a.pass ? "var(--green)" : "var(--red)" }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            {a.pass ? <polyline points="20 6 9 17 4 12" /> : <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>}
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{a.text || a.assertion_id}</div>
                          <div className="text-[12px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{a.reasoning}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Per-case history panel */}
                {isHistoryOpen && (
                  <div className="px-5 py-4 animate-fade-in" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                        Case History
                      </div>
                      {/* Model filter */}
                      <select
                        value={caseHistoryModelFilter}
                        onChange={(e) => {
                          setCaseHistoryModelFilter(e.target.value);
                          loadCaseHistory(evalId, e.target.value);
                        }}
                        className="text-[11px] px-2 py-1 rounded"
                        style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
                      >
                        <option value="">All models</option>
                        {[...new Set(caseHistoryData.map((h) => h.model))].map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    {caseHistoryLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <div className="spinner" style={{ width: 16, height: 16 }} />
                      </div>
                    ) : caseHistoryData.length === 0 ? (
                      <div className="text-[12px] py-3 text-center" style={{ color: "var(--text-tertiary)" }}>
                        No history found for this case.
                      </div>
                    ) : (
                      <>
                        {/* Mini trend line */}
                        {caseHistoryData.length >= 2 && (() => {
                          const points = caseHistoryData.slice().reverse();
                          const w = 200;
                          const h = 40;
                          const pad = 4;
                          const maxRate = 1;
                          const stepX = (w - pad * 2) / (points.length - 1);
                          return (
                            <div className="mb-3">
                              <svg width={w} height={h} style={{ display: "block" }}>
                                <polyline
                                  points={points.map((p, i) => {
                                    const x = pad + i * stepX;
                                    const y = h - pad - ((p.pass_rate / maxRate) * (h - pad * 2));
                                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                                  }).join(" ")}
                                  fill="none"
                                  stroke="var(--accent)"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                {points.map((p, i) => {
                                  const x = pad + i * stepX;
                                  const y = h - pad - ((p.pass_rate / maxRate) * (h - pad * 2));
                                  return <circle key={i} cx={x} cy={y} r="2.5" fill="var(--accent)" />;
                                })}
                              </svg>
                            </div>
                          );
                        })()}
                        {/* History entries */}
                        <div className="space-y-1.5">
                          {caseHistoryData.map((entry, i) => {
                            const pct = Math.round(entry.pass_rate * 100);
                            const when = new Date(entry.timestamp);
                            return (
                              <div
                                key={i}
                                className="flex items-center gap-3 px-3 py-2 rounded-lg text-[12px]"
                                style={{ background: "var(--surface-2)" }}
                              >
                                <span className="text-[11px] flex-shrink-0" style={{ color: "var(--text-tertiary)" }}>
                                  {when.toLocaleDateString()} {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                                <span
                                  className="pill flex-shrink-0"
                                  style={{ background: "var(--surface-3)", color: "var(--text-secondary)", fontSize: "10px" }}
                                >
                                  {entry.model}
                                </span>
                                <span
                                  className="pill flex-shrink-0"
                                  style={{
                                    background: pct >= 80 ? "var(--green-muted)" : pct >= 50 ? "var(--yellow-muted)" : "var(--red-muted)",
                                    color: pct >= 80 ? "var(--green)" : pct >= 50 ? "var(--yellow)" : "var(--red)",
                                    fontSize: "10px",
                                  }}
                                >
                                  {pct}%
                                </span>
                                {entry.durationMs != null && (
                                  <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>
                                    {(entry.durationMs / 1000).toFixed(1)}s
                                  </span>
                                )}
                                {entry.tokens != null && (
                                  <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>
                                    {entry.tokens.toLocaleString()} tok
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Expand/collapse LLM output */}
                {data.output && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(evalId); }}
                      className="w-full px-5 py-2.5 flex items-center justify-center gap-2 text-[12px] font-medium transition-all duration-150"
                      style={{
                        background: "var(--surface-2)",
                        color: "var(--text-secondary)",
                        borderTop: "1px solid var(--border-subtle)",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                    >
                      <svg
                        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                        style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s ease" }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                      {isExpanded ? "Hide LLM Output" : "Show Actual LLM Output"}
                    </button>

                    {isExpanded && (
                      <div className="p-4 animate-fade-in" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                        <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-tertiary)" }}>
                          LLM Output
                        </div>
                        <div
                          className="text-[12px] leading-relaxed p-3 rounded-lg max-h-64 overflow-y-auto whitespace-pre-wrap"
                          style={{ background: "var(--surface-1)", color: "var(--text-secondary)", fontFamily: "var(--font-mono, monospace)" }}
                        >
                          {data.output}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* Pass rate chart */}
          {done && currentResults.size > 1 && (() => {
            const entries = Array.from(currentResults.entries());
            const passColor = "#34d399";
            const failColor = "#f87171";
            return (
              <GroupedBarChart
                title="Benchmark Results — Pass Rate per Eval"
                groups={entries.map(([id, data]) => {
                  const passed = data.assertions.filter((a) => a.pass).length;
                  const total = data.assertions.length;
                  const rate = total > 0 ? passed / total : 0;
                  return {
                    label: data.name || `Eval #${id}`,
                    values: [{ value: rate * 100, label: `${passed}/${total}` }],
                  };
                })}
                seriesColors={[entries.every(([, d]) => d.status === "pass") ? passColor : "#6383ff"]}
                seriesLabels={["Pass Rate"]}
                maxValue={100}
                formatValue={(v) => `${Math.round(v)}%`}
                yLabel="Accuracy"
              />
            );
          })()}

          {/* Overall result */}
          {done && overallPct !== null && (() => {
            const allData = Array.from(currentResults.values());
            const totalMs = allData.reduce((s, d) => s + (d.durationMs ?? 0), 0);
            const totalTok = allData.reduce((s, d) => s + (d.tokens ?? 0), 0);
            const hasTokens = allData.some((d) => d.tokens != null);
            return (
              <div
                className="glass-card p-6 text-center animate-fade-in-scale"
                style={{ borderColor: overallPct >= 80 ? "var(--green)" : overallPct >= 50 ? "var(--yellow)" : "var(--red)", borderWidth: 2 }}
              >
                <div className="text-[36px] font-bold tracking-tight" style={{
                  color: overallPct >= 80 ? "var(--green)" : overallPct >= 50 ? "var(--yellow)" : "var(--red)",
                }}>
                  {overallPct}%
                </div>
                <div className="text-[13px] mt-1" style={{ color: "var(--text-tertiary)" }}>
                  {runScope === "all" ? "Overall Pass Rate" : "Pass Rate"}
                </div>
                <div className="flex items-center justify-center gap-4 mt-2 text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>
                  {model && <span>{model}</span>}
                  {totalMs > 0 && <span>{(totalMs / 1000).toFixed(1)}s total</span>}
                  {hasTokens && totalTok > 0 && <span>{totalTok.toLocaleString()} tokens</span>}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Empty running state */}
      {running && currentResults.size === 0 && (
        <div className="text-center py-16 animate-fade-in">
          <div className="spinner-lg mx-auto mb-4" />
          <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>Generating outputs and evaluating assertions...</p>
        </div>
      )}

      {/* Progress log */}
      {progressEntries.length > 0 && (
        <div className="glass-card mt-3 overflow-hidden">
          <ProgressLog entries={progressEntries} isRunning={running} />
        </div>
      )}
    </div>
  );
}
