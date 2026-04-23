import { useState, useMemo, useEffect, useRef } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { useConfig } from "../../ConfigContext";
import type { RunMode, InlineResult, CaseRunStatus } from "./workspaceTypes";
import type { ClassifiedError } from "../../components/ErrorCard";
import type { ComparisonCaseDetail } from "../../types";
import { formatCost, formatTokens } from "../../utils/formatCost";
import { verdictLabel } from "../../../../eval/verdict.js";

// ---------------------------------------------------------------------------
// Exported pure helpers (tested in RunPanel.test.tsx)
// ---------------------------------------------------------------------------

/** Returns the appropriate pass-rate label based on the benchmark run type. */
export function passRateLabel(type?: RunMode): string {
  return type === "baseline" ? "Baseline Pass Rate" : "Skill Pass Rate";
}

/** Formats model + timestamp into a provenance string like "claude-sonnet-4-5 · Mar 19, 2026 7:30 PM". */
export function formatProvenance(model?: string, timestamp?: string): string {
  let datePart = "";
  if (timestamp) {
    const d = new Date(timestamp);
    if (!isNaN(d.getTime())) {
      datePart = d.toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit",
      });
    }
  }
  const parts = [model, datePart].filter(Boolean);
  return parts.join(" · ");
}

/** Produces a human-readable improvement statement from comparison delta. */
export function deltaStatement(delta: number, totalAssertions: number, caseCount: number): string {
  const caseWord = caseCount === 1 ? "test case" : "test cases";
  if (delta === 0) return `Your skill performs the same as the baseline across ${caseCount} ${caseWord}`;
  const diff = Math.round(Math.abs(delta) * totalAssertions);
  if (diff === 0) return `Your skill performs the same as the baseline across ${caseCount} ${caseWord}`;
  const direction = delta > 0 ? "more" : "fewer";
  return `Your skill passes ${diff} ${direction} assertions across ${caseCount} ${caseWord}`;
}

/** Converts 1-5 rubric scores to percentage pairs for display. */
export function formatComparisonScore(
  skillScore: number,
  baselineScore: number,
): { skill: number; baseline: number } {
  const pct = (s: number) => { const v = (s / 5) * 100; return !isFinite(v) ? 0 : Math.round(Math.min(100, Math.max(0, v))); };
  return { skill: pct(skillScore), baseline: pct(baselineScore) };
}

/** Returns winner badge text and accent flag for a comparison result. */
export function winnerLabel(winner: "skill" | "baseline" | "tie"): { text: string; isSkill: boolean } {
  if (winner === "skill") return { text: "Skill wins", isSkill: true };
  if (winner === "baseline") return { text: "Baseline wins", isSkill: false };
  return { text: "Tie", isSkill: false };
}

/** Estimate duration label based on case/assertion count (client-side heuristic) */
function estimateLabel(totalCases: number, totalAssertions: number): string {
  // ~15-25s per LLM call (conservative for CLI providers)
  const totalCalls = totalCases + totalAssertions;
  const minSec = totalCalls * 10;
  const maxSec = totalCalls * 25;
  const fmt = (s: number) => s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`;
  return `${fmt(minSec)}\u2013${fmt(maxSec)}`;
}

// Client-side cost estimation — approximate per-call costs by provider
const APPROX_COST_PER_CALL: Partial<Record<string, number>> = {
  "anthropic": 0.01,    // ~2K input + 1K output tokens at Sonnet rates
  "openrouter": 0.01,   // varies, use Sonnet-equivalent
  "ollama": 0,           // free
  "claude-cli": 0,       // subscription
  "codex-cli": 0,        // subscription
  "gemini-cli": 0,       // free tier
};

function estimateCostLabel(provider: string | null, totalCalls: number): string | null {
  if (!provider) return null;
  const perCall = APPROX_COST_PER_CALL[provider];
  // Unknown or free providers: return null to suppress cost display (intentional)
  if (perCall == null || perCall === 0) return null;
  const min = perCall * totalCalls * 0.5;
  const max = perCall * totalCalls * 2;
  return `${formatCost(min)}\u2013${formatCost(max)}`;
}

export function RunPanel() {
  const { state, runCase, runAll, cancelCase, cancelAll, isReadOnly } = useWorkspace();
  const { evals, caseRunStates, bulkRunActive, latestBenchmark, inlineResults } = state;
  const { config } = useConfig();

  const cases = evals?.evals ?? [];

  const isAnyRunning = useMemo(() => {
    for (const s of caseRunStates.values()) {
      if (s.status === "running" || s.status === "queued") return true;
    }
    return false;
  }, [caseRunStates]);

  // Progress tracking
  const completedCases = cases.filter((c) => {
    const s = caseRunStates.get(c.id);
    return s && (s.status === "complete" || s.status === "error" || s.status === "cancelled");
  }).length;

  const runningCases = cases.filter((c) => {
    const s = caseRunStates.get(c.id);
    return s && (s.status === "running" || s.status === "queued");
  }).length;

  // Elapsed timer — ticks every second while cases are running
  const runStartRef = useRef<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (isAnyRunning && !runStartRef.current) {
      runStartRef.current = Date.now();
    }
    if (!isAnyRunning) {
      runStartRef.current = null;
      setElapsedSec(0);
      return;
    }
    const timer = setInterval(() => {
      if (runStartRef.current) {
        setElapsedSec(Math.round((Date.now() - runStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isAnyRunning]);

  const totalAssertions = cases.reduce((s, c) => s + c.assertions.length, 0);
  const totalCalls = cases.length + totalAssertions;
  const durationEstimate = useMemo(() => estimateLabel(cases.length, totalAssertions), [cases.length, totalAssertions]);
  const costEstimate = useMemo(() => estimateCostLabel(config?.provider ?? null, totalCalls), [config?.provider, totalCalls]);

  return (
    <div className="p-5">
      {/* Read-only notice */}
      {isReadOnly && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4 text-[11px]"
          style={{ background: "var(--surface-2)", color: "var(--text-tertiary)", border: "1px solid var(--border-subtle)" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Installed skill — benchmarking is disabled. Edit the source skill to run benchmarks.
        </div>
      )}
      {/* Controls */}
      <div
        className="rounded-xl p-4 mb-5"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Benchmark</span>
          {isAnyRunning && (
            <span className="text-[11px] font-medium" style={{ color: "var(--accent)" }}>
              {runningCases} running
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isAnyRunning && (
            <button onClick={cancelAll} className="btn text-[12px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid var(--red-muted)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              Cancel All
            </button>
          )}
          <button
            onClick={() => runAll("comparison")}
            disabled={cases.length === 0 || isAnyRunning || isReadOnly}
            className="btn btn-primary text-[12px]"
            title="Runs both your skill and the baseline, then compares results side by side"
          >
            Run A/B Test
          </button>
          <button
            onClick={() => runAll("benchmark")}
            disabled={cases.length === 0 || isAnyRunning || isReadOnly}
            className="btn btn-secondary text-[12px]"
            title="Runs benchmark using your skill only"
          >
            Test Skill
          </button>
          <button
            onClick={() => runAll("baseline")}
            disabled={cases.length === 0 || isAnyRunning || isReadOnly}
            className="btn btn-secondary text-[12px]"
            title="Runs benchmark using the baseline (no skill) for reference"
          >
            Test Baseline
          </button>
        </div>

        {!isAnyRunning && cases.length > 0 && (
          <div className="flex items-center gap-3 mt-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            <span>Est. duration: {durationEstimate}</span>
            {costEstimate && <span>Est. cost: {costEstimate}</span>}
            {!costEstimate && config?.provider && (config.provider === "claude-cli" || config.provider === "codex-cli") && (
              <span>Cost: Subscription</span>
            )}
            {!costEstimate && config?.provider && (config.provider === "ollama" || config.provider === "gemini-cli") && (
              <span>Cost: Free</span>
            )}
          </div>
        )}
      </div>

      {/* Progress */}
      {isAnyRunning && cases.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
              Progress: {completedCases}/{cases.length} cases
            </span>
            <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {Math.round((completedCases / cases.length) * 100)}%
            </span>
          </div>
          <div className="rounded-full overflow-hidden" style={{ height: 6, background: "var(--surface-3)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(completedCases / cases.length) * 100}%`,
                background: "var(--accent)",
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              Elapsed: {elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`}
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              Est. total: {durationEstimate}
            </span>
          </div>
        </div>
      )}

      {/* Results cards */}
      <div className="space-y-3 stagger-children">
        {cases.map((c) => {
          const r = inlineResults.get(c.id);
          const caseRunState = caseRunStates.get(c.id);
          const caseStatus = caseRunState?.status ?? "idle";
          const benchCase = latestBenchmark?.cases.find((bc) => bc.eval_id === c.id);
          return (
            <RunCaseCard
              key={c.id}
              name={c.name}
              evalId={c.id}
              result={r}
              caseCost={benchCase?.cost}
              caseBillingMode={benchCase?.billingMode}
              caseInputTokens={benchCase?.inputTokens}
              caseOutputTokens={benchCase?.outputTokens}
              caseStatus={caseStatus}
              runMode={caseRunState?.mode ?? null}
              comparisonDetail={benchCase?.comparisonDetail}
              isReadOnly={isReadOnly}
              onRun={(id) => runCase(id, "benchmark")}
              onBaseline={(id) => runCase(id, "baseline")}
              onCompare={(id) => runCase(id, "comparison")}
              onCancel={(id) => cancelCase(id)}
            />
          );
        })}
      </div>

      {/* Summary on completion */}
      {!isAnyRunning && latestBenchmark && latestBenchmark.cases.length > 0 && (
        <div className="mt-5">
          <div
            className="rounded-xl p-4 mb-4"
            style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                {passRateLabel(latestBenchmark.type)}
              </span>
              <span
                className="text-[20px] font-bold"
                style={{
                  color: (latestBenchmark.overall_pass_rate ?? 0) >= 0.8 ? "var(--green)"
                    : (latestBenchmark.overall_pass_rate ?? 0) >= 0.5 ? "var(--yellow)"
                    : "var(--red)",
                }}
              >
                {latestBenchmark.overall_pass_rate != null ? `${Math.round(latestBenchmark.overall_pass_rate * 100)}%` : "--"}
              </span>
            </div>
            {latestBenchmark.totalDurationMs != null && (
              <div className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>
                Total: {(latestBenchmark.totalDurationMs / 1000).toFixed(1)}s
                {latestBenchmark.model && ` | Model: ${latestBenchmark.model}`}
                {latestBenchmark.totalInputTokens != null && latestBenchmark.totalOutputTokens != null
                  && ` | Tokens: ${formatTokens(latestBenchmark.totalInputTokens, latestBenchmark.totalOutputTokens)}`}
                {latestBenchmark.totalCost != null && ` | Cost: ${formatCost(latestBenchmark.totalCost)}`}
              </div>
            )}

            {/* Celebration CTA — 100% pass rate, no existing comparison */}
            {latestBenchmark.overall_pass_rate >= 0.9999 && !latestBenchmark.comparison && (
              <button
                onClick={() => runAll("comparison")}
                disabled={cases.length === 0 || isReadOnly}
                className="text-[13px] font-semibold mt-3 w-full rounded-lg transition-opacity duration-150"
                style={{
                  padding: "10px 0",
                  background: "var(--green)",
                  color: "var(--color-paper)",
                  border: "none",
                  cursor: "pointer",
                  opacity: cases.length === 0 ? 0.5 : 1,
                }}
              >
                Run Final A/B Comparison
              </button>
            )}
          </div>

          {/* Comparison scores */}
          {latestBenchmark.comparison && (
            <div
              className="rounded-xl p-4"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
                Skill vs Baseline
              </div>
              {(() => {
                const provenance = formatProvenance(latestBenchmark.model, latestBenchmark.timestamp);
                return provenance ? (
                  <div className="text-[10px] mt-0.5 mb-3" style={{ color: "var(--text-tertiary)" }}>
                    {provenance}
                  </div>
                ) : <div className="mb-3" />;
              })()}
              <div className="grid grid-cols-2 gap-4">
                <ScoreBar label="Skill" value={latestBenchmark.comparison.skillPassRate} color="var(--accent)" />
                <ScoreBar label="Baseline" value={latestBenchmark.comparison.baselinePassRate} color="var(--text-tertiary)" />
              </div>
              <div className="mt-3 text-[12px] font-medium" style={{
                color: latestBenchmark.comparison.delta > 0 ? "var(--green)" : latestBenchmark.comparison.delta < 0 ? "var(--red)" : "var(--text-tertiary)",
              }}>
                Delta: {latestBenchmark.comparison.delta > 0 ? "+" : ""}{(latestBenchmark.comparison.delta * 100).toFixed(1)}%
                {latestBenchmark.verdict && ` | ${verdictLabel(latestBenchmark.verdict)}`}
              </div>
              {(() => {
                const benchmarkTotalAssertions = latestBenchmark.cases.reduce((s, c) => s + c.assertions.length, 0);
                const stmt = deltaStatement(
                  latestBenchmark.comparison.delta,
                  benchmarkTotalAssertions,
                  latestBenchmark.cases.length,
                );
                return (
                  <div className="mt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {stmt}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run case card — independent per-case controls
// ---------------------------------------------------------------------------

const MODE_BADGE: Record<RunMode, { label: string; bg: string; color: string }> = {
  benchmark: { label: "Skill", bg: "var(--accent-muted)", color: "var(--accent)" },
  baseline: { label: "Baseline", bg: "var(--surface-3)", color: "var(--text-tertiary)" },
  comparison: { label: "Compare", bg: "var(--purple-muted)", color: "var(--purple)" },
};

function RunCaseCard({ name, evalId, result, caseCost, caseBillingMode, caseInputTokens, caseOutputTokens, caseStatus, runMode, comparisonDetail, isReadOnly, onRun, onBaseline, onCompare, onCancel }: {
  name: string;
  evalId: number;
  result?: InlineResult;
  caseCost?: number | null;
  caseBillingMode?: string;
  caseInputTokens?: number | null;
  caseOutputTokens?: number | null;
  caseStatus: CaseRunStatus;
  runMode: RunMode | null;
  comparisonDetail?: ComparisonCaseDetail;
  isReadOnly?: boolean;
  onRun: (evalId: number) => void;
  onBaseline: (evalId: number) => void;
  onCompare: (evalId: number) => void;
  onCancel: (evalId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isActive = caseStatus === "running" || caseStatus === "queued";
  const isDone = caseStatus === "complete" || caseStatus === "error";

  return (
    <div
      className="rounded-xl overflow-hidden transition-all duration-200"
      style={{
        background: "var(--surface-1)",
        border: isActive ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
        // eslint-disable-next-line vskill/no-raw-color -- intentional: active-glow shadow uses alpha-only accent tint
        boxShadow: isActive ? "0 0 12px rgba(99, 131, 255, 0.15)" : "none",
      }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {caseStatus === "running" && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />}
          {caseStatus === "queued" && (
            <span className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>queued</span>
          )}
          <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
            #{evalId} {name}
          </span>
          {runMode && (isActive || isDone) && (() => {
            const badge = MODE_BADGE[runMode];
            return badge ? (
              <span className="pill text-[9px] font-semibold" style={{ background: badge.bg, color: badge.color, padding: "1px 6px" }}>
                {badge.label}
              </span>
            ) : null;
          })()}
        </div>
        <div className="flex items-center gap-2">
          {isActive ? (
            <button
              onClick={() => onCancel(evalId)}
              className="btn text-[10px] px-2 py-1"
              style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid var(--red-muted)" }}
            >
              Cancel
            </button>
          ) : (
            <>
              <button onClick={() => onCompare(evalId)} disabled={isReadOnly} className="btn btn-primary text-[10px] px-2 py-1">Compare</button>
              <button onClick={() => onRun(evalId)} disabled={isReadOnly} className="btn btn-secondary text-[10px] px-2 py-1">Skill</button>
              <button onClick={() => onBaseline(evalId)} disabled={isReadOnly} className="btn btn-secondary text-[10px] px-2 py-1">Base</button>
            </>
          )}
          {result && result.status != null && (
            <span
              className="pill text-[10px]"
              style={{
                background: result.status === "pass" ? "var(--green-muted)" : "var(--red-muted)",
                color: result.status === "pass" ? "var(--green)" : "var(--red)",
              }}
            >
              {result.passRate != null ? `${Math.round(result.passRate * 100)}%` : result.status}
            </span>
          )}
          {caseInputTokens != null && caseOutputTokens != null && (
            <span className="text-[10px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono, monospace)" }}>
              {formatTokens(caseInputTokens, caseOutputTokens)}
            </span>
          )}
          {caseCost != null && (
            <span className="text-[10px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono, monospace)" }}>
              {formatCost(caseCost, caseBillingMode)}
            </span>
          )}
          {caseStatus === "cancelled" && (
            <span className="pill text-[10px]" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>
              cancelled
            </span>
          )}
        </div>
      </div>

      {/* Assertions */}
      {result && result.assertions.length > 0 && (
        <div className="px-4 pb-3">
          <div className="space-y-1">
            {result.assertions.map((a) => (
              <div key={a.assertion_id} className="flex items-center gap-2 text-[11px]">
                <span style={{ color: a.pass ? "var(--green)" : "var(--red)" }}>
                  {a.pass ? "PASS" : "FAIL"}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>{a.text}</span>
              </div>
            ))}
          </div>

          {result.output && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] mt-2 transition-colors duration-150"
              style={{ color: "var(--text-tertiary)" }}
            >
              {expanded ? "Hide output" : "Show output"}
            </button>
          )}
          {expanded && result.output && (
            <pre
              className="text-[11px] mt-2 p-3 rounded-lg overflow-auto"
              style={{
                background: "var(--surface-0)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-subtle)",
                maxHeight: 200,
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                whiteSpace: "pre-wrap",
              }}
            >
              {result.output}
            </pre>
          )}
        </div>
      )}

      {/* Per-case comparison detail row */}
      {comparisonDetail && (
        <div className="px-4 pb-3">
          <div
            className="rounded-lg px-3 py-2"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center gap-4 text-[11px] flex-wrap">
              {(() => {
                const content = formatComparisonScore(comparisonDetail.skillContentScore, comparisonDetail.baselineContentScore);
                const structure = formatComparisonScore(comparisonDetail.skillStructureScore, comparisonDetail.baselineStructureScore);
                const badge = winnerLabel(comparisonDetail.winner);
                return (
                  <>
                    <span style={{ color: "var(--text-secondary)" }}>
                      Content: Skill {content.skill}% / Baseline {content.baseline}%
                    </span>
                    <span style={{ color: "var(--text-tertiary)" }}>·</span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      Structure: Skill {structure.skill}% / Baseline {structure.baseline}%
                    </span>
                    <span style={{ color: "var(--text-tertiary)" }}>·</span>
                    <span style={{ color: badge.isSkill ? "var(--accent)" : "var(--text-tertiary)", fontWeight: 500 }}>
                      {badge.text}
                    </span>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Error message */}
      {result && result.errorMessage && (
        <CaseError errorMessage={result.errorMessage} classifiedError={result.classifiedError} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible error display — shows friendly summary, click to reveal raw details
// ---------------------------------------------------------------------------

const ERROR_ICONS: Record<string, string> = {
  rate_limit: "\u23F1",
  context_window: "\u26A0",
  auth: "\uD83D\uDD12",
  timeout: "\u231B",
  provider_unavailable: "\u26A1",
  parse_error: "\u2753",
  unknown: "\u274C",
};

function CaseError({ errorMessage, classifiedError }: { errorMessage: string; classifiedError?: ClassifiedError }) {
  const [showRaw, setShowRaw] = useState(false);
  const title = classifiedError?.title ?? "Error";
  const hint = classifiedError?.hint;
  const icon = classifiedError ? (ERROR_ICONS[classifiedError.category] ?? ERROR_ICONS.unknown) : ERROR_ICONS.unknown;

  return (
    <div className="px-4 pb-3">
      <div className="rounded-lg overflow-hidden" style={{ background: "var(--red-muted)", border: "1px solid var(--red-muted)" }}>
        {/* Summary row — always visible */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span style={{ fontSize: 12 }}>{icon}</span>
          <span className="text-[11.5px] font-semibold flex-1" style={{ color: "var(--red)" }}>
            {title}
          </span>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-[10px] px-1.5 py-0.5 rounded transition-colors duration-150"
            style={{ color: "var(--text-tertiary)", background: "transparent" }}
          >
            {showRaw ? "Hide details" : "Details"}
          </button>
        </div>

        {/* Hint */}
        {hint && (
          <div className="px-3 pb-2 text-[10.5px]" style={{ color: "var(--text-secondary)" }}>
            {hint}
          </div>
        )}

        {/* Raw error — collapsible */}
        {showRaw && (
          <pre
            className="text-[10px] px-3 pb-2.5 overflow-auto"
            style={{
              color: "var(--text-tertiary)",
              maxHeight: 120,
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: 0,
            }}
          >
            {errorMessage}
          </pre>
        )}
      </div>
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{label}</span>
        <span className="text-[12px] font-semibold" style={{ color }}>{Math.round(value * 100)}%</span>
      </div>
      <div className="rounded-full overflow-hidden" style={{ height: 6, background: "var(--surface-3)" }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value * 100}%`, background: color }} />
      </div>
    </div>
  );
}
