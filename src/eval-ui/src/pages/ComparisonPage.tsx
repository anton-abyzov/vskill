import { useState, useEffect, useRef } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { useSSE } from "../sse";
import { api } from "../api";
import { GroupedBarChart } from "../components/GroupedBarChart";
import { ProgressLog } from "../components/ProgressLog";
import type { ProgressEntry } from "../components/ProgressLog";

interface ComparisonOutputsEvent {
  eval_id: number;
  eval_name: string;
  prompt: string;
  skillOutput: string;
  baselineOutput: string;
  skillContentScore: number;
  skillStructureScore: number;
  baselineContentScore: number;
  baselineStructureScore: number;
  winner: "skill" | "baseline" | "tie";
}

const VERDICT_STYLES: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  EFFECTIVE:    { bg: "var(--green-muted)",  text: "var(--green)",  border: "var(--green)",  glow: "rgba(52,211,153,0.15)" },
  MARGINAL:     { bg: "var(--yellow-muted)", text: "var(--yellow)", border: "var(--yellow)", glow: "rgba(251,191,36,0.15)" },
  INEFFECTIVE:  { bg: "rgba(251,146,60,0.12)", text: "var(--orange)", border: "var(--orange)", glow: "rgba(251,146,60,0.15)" },
  DEGRADING:    { bg: "var(--red-muted)",    text: "var(--red)",    border: "var(--red)",    glow: "rgba(248,113,113,0.15)" },
};

export function ComparisonPage() {
  const { plugin, skill } = useParams<{ plugin: string; skill: string }>();
  const { events, running, done, error, start } = useSSE();
  const [expandedOutputs, setExpandedOutputs] = useState<Set<number>>(new Set());
  const [model, setModel] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const autostartRef = useRef(false);

  useEffect(() => {
    api.getConfig().then((c) => setModel(c.model)).catch(() => {});
  }, []);

  // Autostart support — triggered via ?autostart=true from HistoryPage rerun buttons
  useEffect(() => {
    if (searchParams.get("autostart") === "true" && !autostartRef.current && plugin && skill) {
      autostartRef.current = true;
      setExpandedOutputs(new Set());
      start(`/api/skills/${plugin}/${skill}/compare`);
    }
  }, [searchParams, plugin, skill]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleStart() {
    setExpandedOutputs(new Set());
    start(`/api/skills/${plugin}/${skill}/compare`);
  }

  function toggleExpand(evalId: number) {
    setExpandedOutputs((prev) => {
      const next = new Set(prev);
      next.has(evalId) ? next.delete(evalId) : next.add(evalId);
      return next;
    });
  }

  const comparisons: ComparisonOutputsEvent[] = [];
  const caseErrors: Array<{ eval_id: number; error: string }> = [];
  const activeCases: Array<{ eval_id: number; eval_name: string }> = [];
  const progressEntries: ProgressEntry[] = [];
  for (const evt of events) {
    if (evt.event === "outputs_ready") {
      const d = evt.data as ComparisonOutputsEvent;
      if (!comparisons.find((c) => c.eval_id === d.eval_id)) comparisons.push(d);
    } else if (evt.event === "case_error") {
      const d = evt.data as { eval_id: number; error: string };
      if (!caseErrors.find((c) => c.eval_id === d.eval_id)) caseErrors.push(d);
    } else if (evt.event === "case_start") {
      const d = evt.data as { eval_id: number; eval_name: string };
      if (!activeCases.find((c) => c.eval_id === d.eval_id)) activeCases.push(d);
    } else if (evt.event === "progress") {
      const d = evt.data as { eval_id?: number; phase: string; message: string; current?: number; total?: number };
      progressEntries.push({
        timestamp: Date.now(),
        evalId: d.eval_id,
        phase: d.phase,
        message: d.message,
        current: d.current,
        total: d.total,
      });
    }
  }

  // The latest case being processed (for progress display)
  const completedIds = new Set([...comparisons.map(c => c.eval_id), ...caseErrors.map(c => c.eval_id)]);
  const currentCase = activeCases.filter(c => !completedIds.has(c.eval_id)).pop();

  const doneEvent = events.find((e) => e.event === "done");
  const doneData = doneEvent?.data as {
    verdict?: string;
    overall_pass_rate?: number;
    comparison?: { skillRubricAvg: number; baselineRubricAvg: number; delta: number };
    error?: string;
  } | undefined;

  return (
    <div className="px-10 py-8 max-w-6xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5 text-[13px]">
        <Link to={`/skills/${plugin}/${skill}`} className="transition-colors duration-150" style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
        >
          {skill}
        </Link>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>A/B Comparison</span>
      </div>

      <div className="mb-3">
        <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          Runs each eval prompt twice: once WITH your skill, once WITHOUT. An LLM judge scores both outputs blindly on content and structure (1-5 each).
        </p>
        {model && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>Model:</span>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--surface-3)", color: "var(--accent)" }}>
              {model}
            </span>
          </div>
        )}
      </div>

      <button onClick={handleStart} disabled={running} className="btn btn-purple mb-7">
        {running ? (
          <><div className="spinner" style={{ borderTopColor: "#fff", borderColor: "rgba(255,255,255,0.2)", width: 14, height: 14 }} /> Comparing...</>
        ) : (
          <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5" /><path d="M8 21H3v-5" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg> Run Comparison</>
        )}
      </button>

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
          {error}
        </div>
      )}

      {/* Done-level error (e.g. failed to load evals) */}
      {doneData?.error && (
        <div className="mb-5 px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
          <span className="font-semibold">Error:</span> {doneData.error}
        </div>
      )}

      {/* Per-case errors */}
      {caseErrors.length > 0 && (
        <div className="space-y-2 mb-5">
          {caseErrors.map((ce) => (
            <div key={ce.eval_id} className="px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
              <span className="font-semibold">Eval #{ce.eval_id} failed:</span> {ce.error}
            </div>
          ))}
        </div>
      )}

      {comparisons.length > 0 && (
        <div className="space-y-4 stagger-children">
          {comparisons.map((c) => {
            const isExpanded = expandedOutputs.has(c.eval_id);
            const winnerLabel = c.winner === "skill" ? "Skill Wins" : c.winner === "baseline" ? "Baseline Wins" : "Tie";
            const winnerColor = c.winner === "skill" ? "var(--green)" : c.winner === "baseline" ? "var(--red)" : "var(--text-tertiary)";

            return (
              <div key={c.eval_id} className="glass-card overflow-hidden">
                {/* Header */}
                <div className="p-5 pb-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>#{c.eval_id}</span>
                      <h4 className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>{c.eval_name || "Eval Case"}</h4>
                    </div>
                    <span className="pill" style={{
                      background: c.winner === "skill" ? "var(--green-muted)" : c.winner === "baseline" ? "var(--red-muted)" : "var(--surface-3)",
                      color: winnerColor,
                      fontWeight: 700,
                    }}>
                      {winnerLabel}
                    </span>
                  </div>

                  {/* Prompt used */}
                  <div className="mb-4 p-3 rounded-lg" style={{ background: "var(--surface-2)" }}>
                    <div className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-tertiary)" }}>Prompt</div>
                    <div className="text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{c.prompt}</div>
                  </div>

                  {/* Score comparison bars */}
                  <div className="grid grid-cols-2 gap-4">
                    <ScoreBar
                      label="WITH Skill"
                      contentScore={c.skillContentScore}
                      structureScore={c.skillStructureScore}
                      isWinner={c.winner === "skill"}
                    />
                    <ScoreBar
                      label="WITHOUT Skill"
                      contentScore={c.baselineContentScore}
                      structureScore={c.baselineStructureScore}
                      isWinner={c.winner === "baseline"}
                    />
                  </div>
                </div>

                {/* Expand/collapse actual outputs */}
                <button
                  onClick={() => toggleExpand(c.eval_id)}
                  className="w-full px-5 py-3 flex items-center justify-center gap-2 text-[12px] font-medium transition-all duration-150"
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
                  {isExpanded ? "Hide LLM Outputs" : "Show Actual LLM Outputs"}
                </button>

                {/* Actual outputs side by side */}
                {isExpanded && (
                  <div className="grid grid-cols-2 gap-0 animate-fade-in" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <OutputPanel
                      label="WITH Skill"
                      output={c.skillOutput}
                      accentColor={c.winner === "skill" ? "var(--green)" : undefined}
                    />
                    <OutputPanel
                      label="WITHOUT Skill"
                      output={c.baselineOutput}
                      accentColor={c.winner === "baseline" ? "var(--red)" : undefined}
                      hasBorderLeft
                    />
                  </div>
                )}
              </div>
            );
          })}

          {/* Score comparison chart */}
          {done && comparisons.length > 1 && (
            <GroupedBarChart
              title="Score Comparison — With Skill vs Without"
              groups={comparisons.map((c) => ({
                label: c.eval_name || `Eval #${c.eval_id}`,
                values: [
                  { value: (c.skillContentScore + c.skillStructureScore) / 2, label: `${c.skillContentScore + c.skillStructureScore}/10` },
                  { value: (c.baselineContentScore + c.baselineStructureScore) / 2, label: `${c.baselineContentScore + c.baselineStructureScore}/10` },
                ],
              }))}
              seriesColors={["#6383ff", "#a0a0a0"]}
              seriesLabels={["With Skill", "Without Skill"]}
              maxValue={5}
              yLabel="Avg Score"
            />
          )}

          {/* Verdict */}
          {done && doneData?.verdict && (() => {
            const vs = VERDICT_STYLES[doneData.verdict] || VERDICT_STYLES.INEFFECTIVE;
            return (
              <div
                className="glass-card p-8 text-center animate-fade-in-scale"
                style={{ borderColor: vs.border, borderWidth: 2, boxShadow: `0 0 40px ${vs.glow}` }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-tertiary)" }}>Verdict</div>
                <div className="text-[32px] font-bold tracking-tight" style={{ color: vs.text }}>{doneData.verdict}</div>
                {doneData.comparison && (
                  <div className="flex justify-center gap-8 mt-5">
                    <MetricPill label="Skill Avg" value={doneData.comparison.skillRubricAvg.toFixed(1)} />
                    <MetricPill label="Baseline Avg" value={doneData.comparison.baselineRubricAvg.toFixed(1)} />
                    <MetricPill
                      label="Delta"
                      value={`${doneData.comparison.delta > 0 ? "+" : ""}${doneData.comparison.delta.toFixed(1)}`}
                      color={doneData.comparison.delta > 0 ? "var(--green)" : doneData.comparison.delta < 0 ? "var(--red)" : "var(--text-secondary)"}
                    />
                  </div>
                )}
                {doneData.overall_pass_rate !== undefined && (
                  <div className="text-[12px] mt-3" style={{ color: "var(--text-tertiary)" }}>
                    Assertion pass rate: {Math.round(doneData.overall_pass_rate * 100)}%
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {running && comparisons.length === 0 && caseErrors.length === 0 && (
        <div className="text-center py-16 animate-fade-in">
          <div className="spinner-lg mx-auto mb-4" />
          <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>Generating WITH and WITHOUT outputs...</p>
          <p className="text-[12px] mt-1" style={{ color: "var(--text-tertiary)" }}>
            {currentCase
              ? `Processing: ${currentCase.eval_name || `Eval #${currentCase.eval_id}`}`
              : "Then blind-scoring both responses"}
          </p>
        </div>
      )}

      {progressEntries.length > 0 && (
        <div className="glass-card mt-3 overflow-hidden">
          <ProgressLog entries={progressEntries} isRunning={running} />
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, contentScore, structureScore, isWinner }: {
  label: string;
  contentScore: number;
  structureScore: number;
  isWinner: boolean;
}) {
  const avg = ((contentScore + structureScore) / 2).toFixed(1);
  const avgNum = parseFloat(avg);
  const avgColor = avgNum >= 4 ? "var(--green)" : avgNum >= 3 ? "var(--yellow)" : "var(--red)";

  return (
    <div className="rounded-xl p-4" style={{
      background: "var(--surface-2)",
      border: isWinner ? "1px solid var(--green)" : "1px solid transparent",
      boxShadow: isWinner ? "0 0 20px var(--green-muted)" : "none",
    }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-tertiary)" }}>{label}</div>
        <div className="text-[16px] font-bold" style={{ color: avgColor }}>{avg}</div>
      </div>
      <div className="space-y-2">
        <ScoreRow label="Content" score={contentScore} />
        <ScoreRow label="Structure" score={structureScore} />
      </div>
    </div>
  );
}

function ScoreRow({ label, score }: { label: string; score: number }) {
  const pct = (score / 5) * 100;
  const color = score >= 4 ? "var(--green)" : score >= 3 ? "var(--yellow)" : "var(--red)";

  return (
    <div className="flex items-center gap-2.5">
      <div className="text-[11px] w-16" style={{ color: "var(--text-tertiary)" }}>{label}</div>
      <div className="flex-1 h-1.5 rounded-full" style={{ background: "var(--surface-3)" }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-[12px] font-semibold w-5 text-right" style={{ color }}>{score}</div>
    </div>
  );
}

function OutputPanel({ label, output, accentColor, hasBorderLeft }: {
  label: string;
  output: string;
  accentColor?: string;
  hasBorderLeft?: boolean;
}) {
  return (
    <div className="p-4" style={{
      borderLeft: hasBorderLeft ? "1px solid var(--border-subtle)" : undefined,
    }}>
      <div className="flex items-center gap-2 mb-3">
        {accentColor && (
          <div className="w-2 h-2 rounded-full" style={{ background: accentColor }} />
        )}
        <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: accentColor || "var(--text-tertiary)" }}>
          {label}
        </div>
      </div>
      <div
        className="text-[12px] leading-relaxed p-3 rounded-lg max-h-64 overflow-y-auto whitespace-pre-wrap"
        style={{ background: "var(--surface-1)", color: "var(--text-secondary)", fontFamily: "var(--font-mono, monospace)" }}
      >
        {output || "(empty output)"}
      </div>
    </div>
  );
}

function MetricPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <div className="text-[18px] font-bold" style={{ color: color || "var(--text-primary)" }}>{value}</div>
      <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{label}</div>
    </div>
  );
}
