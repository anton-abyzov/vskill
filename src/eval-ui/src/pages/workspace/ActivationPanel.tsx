import { useState, useEffect } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { useStudio } from "../../StudioContext";
import { renderMarkdown } from "../../utils/renderMarkdown";
import { VersionBadge } from "../../components/VersionBadge";
import type { ActivationResult } from "../../types";
import type { ActivationHistoryRun } from "./workspaceTypes";

const CLASSIFICATION_STYLES: Record<string, { bg: string; text: string }> = {
  TP: { bg: "var(--green-muted)", text: "var(--green)" },
  TN: { bg: "var(--green-muted)", text: "var(--green)" },
  FP: { bg: "var(--red-muted)", text: "var(--red)" },
  FN: { bg: "var(--red-muted)", text: "var(--red)" },
  SCOPE_WARNING: { bg: "var(--yellow-muted)", text: "var(--yellow)" },
  DRIFT_WARNING: { bg: "var(--yellow-muted)", text: "var(--yellow)" },
};

const WARNING_TOOLTIPS: Record<string, string> = {
  scope_warning:
    "Description claims broader scope than name+tags suggest. Either narrow the description or add explicit '+' prefix to confirm intended scope.",
  drift_warning:
    "Description omits intent that classifier inferred from name+tags. Description may need to mention this case explicitly.",
};

export function ActivationPanel() {
  const { state, dispatch, runActivationTest, cancelActivation, generateActivationPrompts } = useWorkspace();
  const {
    plugin, skill, activationPrompts, activationResults, activationSummary,
    activationRunning, activationError, activationStartedAt, activationClassifyingStatus,
    generatingPrompts, generatingPromptsError,
    activationHistory,
  } = state;
  // 0707 T-009: read the skill's frontmatter version so every activation-log
  // row can show a VersionBadge.
  const { state: studioState } = useStudio();
  const currentSkillVersionInfo = studioState.skills.find(
    (s) => s.plugin === plugin && s.skill === skill,
  );
  const currentSkillVersion =
    currentSkillVersionInfo?.resolvedVersion ?? currentSkillVersionInfo?.version ?? null;

  const [promptsText, setPromptsText] = useState(activationPrompts);
  const [skillDescription, setSkillDescription] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Sync local promptsText when activationPrompts changes from AI generation
  useEffect(() => {
    if (activationPrompts && activationPrompts !== promptsText) {
      setPromptsText(activationPrompts);
    }
  }, [activationPrompts]);

  useEffect(() => {
    dispatch({ type: "SET_ACTIVATION_PROMPTS", prompts: promptsText });
  }, [promptsText, dispatch]);

  useEffect(() => {
    fetch(`/api/skills/${plugin}/${skill}/description`)
      .then((r) => r.json())
      .then((d) => setSkillDescription(d.rawContent || d.description || null))
      .catch(() => setSkillDescription(null));
  }, [plugin, skill]);

  function handleRun() {
    runActivationTest(promptsText);
  }

  function handleGeneratePrompts() {
    generateActivationPrompts(8);
  }

  const promptCount = promptsText.trim().split("\n").filter(Boolean).length;
  const isWarning = (r: ActivationResult) => r.verdict === "scope_warning" || r.verdict === "drift_warning";
  const correctResults = activationResults.filter((r) => (r.classification === "TP" || r.classification === "TN") && !isWarning(r));
  const incorrectResults = activationResults.filter((r) => (r.classification === "FP" || r.classification === "FN") && !isWarning(r));
  const warningResults = activationResults.filter(isWarning);
  const cleanDescription = skillDescription?.replace(/^---[\s\S]*?---\s*/, "").trim() ?? null;
  const hasGeneratedPrompts = promptsText.trim().length > 0;
  // NOTE: renderMarkdown performs sanitization before rendering
  const descriptionHtml = cleanDescription ? renderMarkdown(cleanDescription) : "";

  return (
    <div className="p-5 space-y-5">

      {/* Header */}
      <div>
        <div className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Activation Test
        </div>
        <div className="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
          Test whether this skill's description activates for relevant prompts and stays silent for irrelevant ones.
        </div>
      </div>

      {/* Two-column input area */}
      <div className="grid grid-cols-[3fr_2fr] gap-4 items-stretch">

        {/* Left: Prompts */}
        <div className="glass-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
              Test Prompts
            </label>
            <div className="flex gap-1.5">
              <button
                onClick={handleGeneratePrompts}
                disabled={generatingPrompts || !cleanDescription || activationRunning}
                className="text-[10px] px-2.5 py-1 rounded-md transition-colors duration-150 flex items-center gap-1.5"
                style={{
                  background: generatingPrompts ? "var(--surface-3)" : "var(--surface-2)",
                  color: !cleanDescription ? "var(--text-tertiary)" : "var(--accent)",
                  border: "1px solid var(--border-subtle)",
                  opacity: !cleanDescription ? 0.5 : 1,
                  cursor: !cleanDescription ? "not-allowed" : "pointer",
                }}
                title={!cleanDescription ? "No skill description available" : undefined}
                onMouseEnter={(e) => {
                  if (cleanDescription && !generatingPrompts) {
                    e.currentTarget.style.background = "var(--surface-3)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!generatingPrompts) {
                    e.currentTarget.style.background = "var(--surface-2)";
                  }
                }}
              >
                {generatingPrompts ? (
                  <>
                    <div
                      className="spinner"
                      style={{ borderTopColor: "var(--accent)", borderColor: "var(--border-subtle)", width: 10, height: 10 }}
                    />
                    Generating...
                  </>
                ) : (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v3m6.36.64l-2.12 2.12M21 12h-3m-.64 6.36l-2.12-2.12M12 21v-3m-4.24.64l2.12-2.12M3 12h3m.64-6.36l2.12 2.12" />
                    </svg>
                    {hasGeneratedPrompts ? "Regenerate" : "Generate"} Test Prompts
                  </>
                )}
              </button>
            </div>
          </div>

          {!cleanDescription && !activationRunning && (
            <div
              className="text-[11px] mt-1"
              style={{ color: "var(--text-tertiary)" }}
              aria-live="polite"
            >
              Add a description to your skill's frontmatter to enable prompt generation.
            </div>
          )}

          {generatingPromptsError && (
            <div className="text-[11px] px-2 py-1 rounded" style={{ color: "var(--red)", background: "var(--red-muted)" }}>
              {generatingPromptsError}
            </div>
          )}

          <textarea
            className="input-field resize-y font-mono text-[12px]"
            style={{ minHeight: 140, height: 140 }}
            value={promptsText}
            onChange={(e) => setPromptsText(e.target.value)}
            placeholder={"How do I write a unit test?\nWhat edge cases should I test?\n+Deploy this to production\n!What's the weather like today?\n!Write me a poem about flowers"}
          />

          {/* Hint bar */}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            <span>One prompt per line</span>
            <Dot />
            <span>No prefix = auto-classify</span>
            <Dot />
            <span className="flex items-center gap-1">
              <code className="px-1 rounded" style={{ background: "var(--surface-2)" }}>+</code>
              = must activate
            </span>
            <Dot />
            <span className="flex items-center gap-1">
              <code className="px-1 rounded" style={{ background: "var(--surface-2)" }}>!</code>
              = must NOT activate
            </span>
            <Dot />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {promptCount} prompt{promptCount !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Run button + Cancel + Progress */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleRun}
              disabled={activationRunning || !promptsText.trim()}
              className="btn btn-primary"
            >
              {activationRunning ? (
                <>
                  <div
                    className="spinner"
                    style={{ borderTopColor: "var(--color-paper)", borderColor: "var(--border-default)", width: 14, height: 14 }}
                  />
                  Testing...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="6" />
                    <circle cx="12" cy="12" r="2" />
                  </svg>
                  Run Activation Test
                </>
              )}
            </button>

            {activationRunning && (
              <>
                <button
                  onClick={cancelActivation}
                  className="btn btn-secondary text-[12px]"
                >
                  Cancel
                </button>
                <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {activationClassifyingStatus
                    ? activationClassifyingStatus
                    : `${activationResults.length} / ${promptCount} prompts tested`}
                  {activationStartedAt && (
                    <ElapsedTime startedAt={activationStartedAt} />
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right: Skill description — always visible */}
        <div className="glass-card flex flex-col overflow-hidden">
          <div
            className="px-4 pt-3.5 pb-2.5 flex-shrink-0"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
              Skill Description
            </span>
          </div>
          <div className="flex-1 overflow-auto px-4 py-3" style={{ minHeight: 0 }}>
            {cleanDescription ? (
              <div
                className="text-[12px] leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            ) : (
              <div className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                No description available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {activationError && (
        <div
          className="px-4 py-3 rounded-lg text-[13px]"
          style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid var(--red-muted)" }}
        >
          {activationError}
        </div>
      )}

      {/* Loading skeleton */}
      {activationRunning && activationResults.length === 0 && (
        <div className="text-center py-12 animate-fade-in">
          <div className="spinner-lg mx-auto mb-4" />
          <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
            Testing activation against skill description...
          </p>
        </div>
      )}

      {/* Results */}
      {activationResults.length > 0 && (
        <div className="space-y-5">
          {incorrectResults.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <span className="text-[12px] font-semibold" style={{ color: "var(--red)" }}>
                  Incorrect ({incorrectResults.length})
                </span>
                <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>— These need attention</span>
              </div>
              <div className="space-y-1.5 stagger-children">
                {incorrectResults.map((r, i) => <ResultRow key={`incorrect-${i}`} result={r} />)}
              </div>
            </div>
          )}

          {correctResults.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="16 10 11 15 8 12" />
                </svg>
                <span className="text-[12px] font-semibold" style={{ color: "var(--green)" }}>
                  Correct ({correctResults.length})
                </span>
              </div>
              <div className="space-y-1.5 stagger-children">
                {correctResults.map((r, i) => <ResultRow key={`correct-${i}`} result={r} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary metrics */}
      {activationSummary && (
        <div className="glass-card p-6 animate-fade-in-scale" style={{ borderColor: "var(--border-active)", borderWidth: 2 }}>
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-tertiary)" }}>
            Summary
          </div>
          {activationSummary.autoClassifiedCount != null && activationSummary.autoClassifiedCount > 0 && (
            <div className="text-[11px] mb-3" style={{ color: "var(--text-tertiary)" }}>
              {activationSummary.autoClassifiedCount} of {activationSummary.total} prompts auto-classified from skill name and tags
            </div>
          )}
          <div className="grid grid-cols-3 gap-6 mb-5">
            <MetricCard
              label="Precision"
              value={activationSummary.precision}
              description="Of all activations, how many were correct?"
              detail={`${activationSummary.tp} true / ${activationSummary.tp + activationSummary.fp} total activations`}
            />
            <MetricCard
              label="Recall"
              value={activationSummary.recall}
              description="Of expected activations, how many fired?"
              detail={`${activationSummary.tp} activated / ${activationSummary.tp + activationSummary.fn} expected`}
            />
            <MetricCard
              label="Reliability"
              value={activationSummary.reliability}
              description="Overall correct classification rate"
              detail={`${activationSummary.tp + activationSummary.tn} correct / ${activationSummary.total} total`}
            />
          </div>
          <div className="pt-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-3 text-center" style={{ color: "var(--text-tertiary)" }}>
              Confusion Matrix
            </div>
            <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto">
              <ConfusionCell label="True Positive"  abbr="TP" count={activationSummary.tp} bg="var(--green-muted)"          color="var(--green)"                description="Correctly activated" />
              <ConfusionCell label="False Positive" abbr="FP" count={activationSummary.fp} bg="var(--red-muted)"            color="var(--red)"                  description="Wrongly activated" />
              <ConfusionCell label="False Negative" abbr="FN" count={activationSummary.fn} bg="var(--red-muted)"            color="var(--red)"                  description="Missed activation" />
              <ConfusionCell label="True Negative"  abbr="TN" count={activationSummary.tn} bg="var(--green-muted)"          color="var(--green)"                description="Correctly silent" />
            </div>
            <div
              className="mt-3 max-w-xs mx-auto text-center text-[11px]"
              style={{ color: "var(--text-tertiary)" }}
              title="Auto-classified disagreements: not real failures, but worth reviewing. Hover a yellow row for details."
            >
              Warnings:{" "}
              <span style={{ color: (activationSummary.scopeWarnings ?? 0) > 0 ? "var(--yellow)" : "var(--text-tertiary)" }}>
                {activationSummary.scopeWarnings ?? 0} scope
              </span>
              {", "}
              <span style={{ color: (activationSummary.driftWarnings ?? 0) > 0 ? "var(--yellow)" : "var(--text-tertiary)" }}>
                {activationSummary.driftWarnings ?? 0} drift
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Test History */}
      <ActivationHistorySection
        history={activationHistory}
        expanded={historyExpanded}
        onToggle={() => setHistoryExpanded(!historyExpanded)}
        skillVersion={currentSkillVersion}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activation History Section
// ---------------------------------------------------------------------------

function ActivationHistorySection({ history, expanded, onToggle, skillVersion }: {
  history: ActivationHistoryRun[] | null;
  expanded: boolean;
  onToggle: () => void;
  skillVersion?: string | null;
}) {
  if (history === null) return null; // not loaded yet

  return (
    <div className="glass-card overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center justify-between text-left"
        style={{ borderBottom: expanded ? "1px solid var(--border-subtle)" : "none" }}
        onClick={onToggle}
      >
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
          Test History
          {history.length > 0 && (
            <span className="ml-2 font-normal" style={{ color: "var(--text-tertiary)" }}>
              ({history.length} run{history.length !== 1 ? "s" : ""})
            </span>
          )}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 py-3">
          {history.length === 0 ? (
            <div className="text-[12px] py-4 text-center" style={{ color: "var(--text-tertiary)" }}>
              No test runs yet
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((run) => (
                <HistoryRow key={run.id} run={run} skillVersion={skillVersion} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ run, skillVersion }: { run: ActivationHistoryRun; skillVersion?: string | null }) {
  const reliability = Math.round(run.summary.reliability * 100);
  const reliabilityColor = reliability >= 80 ? "var(--green)" : reliability >= 60 ? "var(--yellow)" : "var(--red)";
  const verdict = reliability >= 80 ? "Good" : reliability >= 60 ? "Needs Work" : "Poor";
  const verdictColor = reliabilityColor;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
      style={{ background: "var(--surface-1)" }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            {formatRelativeTime(run.timestamp)}
          </span>
          {/* 0707 T-009: VersionBadge on every activation-log row. */}
          <VersionBadge version={skillVersion ?? null} size="sm" data-testid="activation-row-version" />
          <span
            className="pill text-[9px] px-1.5"
            style={{ background: "var(--surface-2)", color: "var(--text-tertiary)" }}
          >
            {run.model || run.provider}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            {run.promptCount} prompts
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-[12px] font-semibold" style={{ color: reliabilityColor, fontVariantNumeric: "tabular-nums" }}>
          {reliability}%
        </span>
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded"
          style={{ color: verdictColor, background: `color-mix(in srgb, ${verdictColor} 10%, transparent)` }}
        >
          {verdict}
        </span>
      </div>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function Dot() {
  return <span style={{ color: "var(--border-subtle)", userSelect: "none" }}>·</span>;
}

function ResultRow({ result }: { result: ActivationResult }) {
  const isWarning = result.verdict === "scope_warning" || result.verdict === "drift_warning";
  const styleKey = isWarning
    ? (result.verdict === "scope_warning" ? "SCOPE_WARNING" : "DRIFT_WARNING")
    : result.classification;
  const cs = CLASSIFICATION_STYLES[styleKey] || CLASSIFICATION_STYLES.FN;
  const isCorrect = !isWarning && (result.classification === "TP" || result.classification === "TN");
  const verdictLabel = result.verdict === "scope_warning" ? "scope warn" : result.verdict === "drift_warning" ? "drift warn" : null;
  const tooltip = result.verdict && result.verdict !== "ok" ? WARNING_TOOLTIPS[result.verdict] : undefined;

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-xl transition-all duration-200"
      style={{ background: cs.bg, border: "1px solid transparent" }}
    >
      <div className="flex-shrink-0 mt-0.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${cs.text} 20%, transparent)` }}
        >
          {isCorrect ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={cs.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : isWarning ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={cs.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={cs.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{result.prompt}</span>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <span
            className="pill"
            style={{ background: "var(--surface-3)", color: cs.text, fontWeight: 700, fontSize: "10px", padding: "1px 6px" }}
            title={tooltip}
          >
            {verdictLabel ?? result.classification}
          </span>
          <span style={{ color: result.activate ? "var(--green)" : "var(--text-tertiary)" }}>
            {result.activate ? "Activated" : "Silent"}
          </span>
          <span style={{ color: "var(--text-tertiary)" }}>
            Expected: {result.expected === "should_activate" ? "activate" : "stay silent"}
          </span>
          <span style={{ color: "var(--text-tertiary)" }}>{result.confidence} confidence</span>
          {result.autoClassified && (
            <span
              className="pill"
              style={{ background: "var(--purple-muted)", color: "var(--purple)", fontSize: "9px", padding: "1px 5px" }}
            >
              auto
            </span>
          )}
        </div>
        {result.reasoning && (
          <div className="text-[11px] mt-1.5" style={{ color: "var(--text-tertiary)" }}>{result.reasoning}</div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, description, detail }: { label: string; value: number; description: string; detail: string }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "var(--green)" : pct >= 60 ? "var(--yellow)" : "var(--red)";
  return (
    <div className="text-center">
      <div className="text-[28px] font-bold tracking-tight" style={{ color }}>{pct}%</div>
      <div className="text-[12px] font-medium mt-0.5" style={{ color: "var(--text-secondary)" }}>{label}</div>
      <div className="text-[10px] mt-1" style={{ color: "var(--text-tertiary)" }}>{description}</div>
      <div className="text-[10px] mt-0.5 font-mono" style={{ color: "var(--text-tertiary)" }}>{detail}</div>
    </div>
  );
}

function ConfusionCell({ abbr, count, bg, color, description }: {
  label: string; abbr: string; count: number; bg: string; color: string; description: string;
}) {
  return (
    <div className="text-center p-3 rounded-lg" style={{ background: bg }}>
      <div className="text-[20px] font-bold" style={{ color }}>{count}</div>
      <div className="text-[11px] font-semibold" style={{ color }}>{abbr}</div>
      <div className="text-[9px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{description}</div>
    </div>
  );
}

function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span className="ml-2">({elapsed}s)</span>;
}
