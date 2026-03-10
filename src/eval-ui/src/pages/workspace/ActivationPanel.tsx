import { useState, useEffect } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { renderMarkdown } from "../../utils/renderMarkdown";
import type { ActivationResult, ActivationSummary } from "../../types";

const CLASSIFICATION_STYLES: Record<string, { bg: string; text: string }> = {
  TP: { bg: "var(--green-muted)", text: "var(--green)" },
  TN: { bg: "rgba(52,211,153,0.06)", text: "rgba(52,211,153,0.6)" },
  FP: { bg: "var(--red-muted)", text: "var(--red)" },
  FN: { bg: "rgba(248,113,113,0.06)", text: "rgba(248,113,113,0.6)" },
};

const PROMPT_TEMPLATES = [
  { label: "Should activate", prompts: [
    "How do I use this feature?",
    "Show me best practices for this",
    "What's the recommended approach?",
  ]},
  { label: "Should NOT activate", prompts: [
    "!What's the weather today?",
    "!Write me a poem",
    "!How do I cook pasta?",
  ]},
];

export function ActivationPanel() {
  const { state, dispatch, runActivationTest } = useWorkspace();
  const { plugin, skill, activationPrompts, activationResults, activationSummary, activationRunning, activationError } = state;

  const [promptsText, setPromptsText] = useState(activationPrompts);
  const [skillDescription, setSkillDescription] = useState<string | null>(null);
  const [showDescription, setShowDescription] = useState(false);

  // Sync local prompts to workspace state on change
  useEffect(() => {
    dispatch({ type: "SET_ACTIVATION_PROMPTS", prompts: promptsText });
  }, [promptsText, dispatch]);

  // Load skill description
  useEffect(() => {
    fetch(`/api/skills/${plugin}/${skill}/description`)
      .then((r) => r.json())
      .then((d) => setSkillDescription(d.rawContent || d.description || null))
      .catch(() => setSkillDescription(null));
  }, [plugin, skill]);

  function handleRun() {
    runActivationTest(promptsText);
  }

  function addTemplatePrompts(prompts: string[]) {
    const current = promptsText.trim();
    const newText = current ? `${current}\n${prompts.join("\n")}` : prompts.join("\n");
    setPromptsText(newText);
  }

  const correctResults = activationResults.filter((r) => r.classification === "TP" || r.classification === "TN");
  const incorrectResults = activationResults.filter((r) => r.classification === "FP" || r.classification === "FN");

  return (
    <div className="p-5">
      {/* Header */}
      <div className="mb-5">
        <div className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Activation Test
        </div>
        <div className="text-[12px] mt-1" style={{ color: "var(--text-tertiary)" }}>
          Test whether this skill's description activates for relevant prompts and stays silent for irrelevant ones.
        </div>
      </div>

      {/* Config section */}
      <div className="grid grid-cols-5 gap-4 mb-5">
        {/* Prompts */}
        <div className="col-span-3">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>Test Prompts</label>
            <div className="flex gap-1.5">
              {PROMPT_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => addTemplatePrompts(t.prompts)}
                  className="text-[10px] px-2 py-1 rounded-md transition-colors duration-150"
                  style={{ background: "var(--surface-2)", color: "var(--text-tertiary)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "var(--surface-3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.background = "var(--surface-2)"; }}
                >
                  + {t.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            className="input-field h-32 resize-y font-mono text-[12px]"
            value={promptsText}
            onChange={(e) => setPromptsText(e.target.value)}
            placeholder={"How do I write a unit test?\nWhat edge cases should I test?\n!What's the weather like today?\n!Write me a poem about flowers"}
          />
          <div className="flex items-center gap-4 mt-1.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            <span>One prompt per line</span>
            <span className="flex items-center gap-1">
              <code className="px-1 rounded" style={{ background: "var(--surface-2)" }}>!</code> prefix = should NOT activate
            </span>
            <span>{promptsText.trim().split("\n").filter(Boolean).length} prompt{promptsText.trim().split("\n").filter(Boolean).length !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Description preview */}
        <div className="col-span-2">
          <div className="glass-card h-full flex flex-col">
            <button
              onClick={() => setShowDescription(!showDescription)}
              className="w-full p-3 flex items-center justify-between text-left flex-shrink-0"
              style={{ borderBottom: showDescription ? "1px solid var(--border-subtle)" : undefined }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                Skill Description
              </span>
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5"
                style={{ transform: showDescription ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s ease" }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showDescription && skillDescription && (
              <div className="p-3 flex-1 overflow-auto animate-fade-in" style={{ maxHeight: 320 }}>
                <div
                  className="text-[12px] leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(skillDescription) }}
                />
              </div>
            )}
            {!showDescription && skillDescription && (
              <div className="px-3 pb-3 pt-1">
                <div className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
                  {skillDescription.slice(0, 100)}{skillDescription.length > 100 ? "..." : ""}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Run button */}
      <button onClick={handleRun} disabled={activationRunning || !promptsText.trim()} className="btn btn-primary mb-5">
        {activationRunning ? (
          <><div className="spinner" style={{ borderTopColor: "#fff", borderColor: "rgba(255,255,255,0.2)", width: 14, height: 14 }} /> Testing...</>
        ) : (
          <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg> Run Activation Test</>
        )}
      </button>

      {/* Error */}
      {activationError && (
        <div className="mb-5 px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
          {activationError}
        </div>
      )}

      {/* Results */}
      {activationResults.length > 0 && (
        <div className="space-y-5 mb-5">
          {incorrectResults.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
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
                  <circle cx="12" cy="12" r="10" /><polyline points="16 10 11 15 8 12" />
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
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: "var(--text-tertiary)" }}>
            Summary
          </div>
          <div className="grid grid-cols-3 gap-6 mb-5">
            <MetricCard label="Precision" value={activationSummary.precision} description="Of all activations, how many were correct?" detail={`${activationSummary.tp} true / ${activationSummary.tp + activationSummary.fp} total activations`} />
            <MetricCard label="Recall" value={activationSummary.recall} description="Of expected activations, how many fired?" detail={`${activationSummary.tp} activated / ${activationSummary.tp + activationSummary.fn} expected`} />
            <MetricCard label="Reliability" value={activationSummary.reliability} description="Overall correct classification rate" detail={`${activationSummary.tp + activationSummary.tn} correct / ${activationSummary.total} total`} />
          </div>
          <div className="pt-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-3 text-center" style={{ color: "var(--text-tertiary)" }}>
              Confusion Matrix
            </div>
            <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto">
              <ConfusionCell label="True Positive" abbr="TP" count={activationSummary.tp} bg="var(--green-muted)" color="var(--green)" description="Correctly activated" />
              <ConfusionCell label="False Positive" abbr="FP" count={activationSummary.fp} bg="var(--red-muted)" color="var(--red)" description="Wrongly activated" />
              <ConfusionCell label="False Negative" abbr="FN" count={activationSummary.fn} bg="rgba(248,113,113,0.06)" color="rgba(248,113,113,0.6)" description="Missed activation" />
              <ConfusionCell label="True Negative" abbr="TN" count={activationSummary.tn} bg="rgba(52,211,153,0.06)" color="rgba(52,211,153,0.6)" description="Correctly silent" />
            </div>
          </div>
        </div>
      )}

      {/* Loading state */}
      {activationRunning && activationResults.length === 0 && (
        <div className="text-center py-16 animate-fade-in">
          <div className="spinner-lg mx-auto mb-4" />
          <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>Testing activation against skill description...</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function ResultRow({ result }: { result: ActivationResult }) {
  const cs = CLASSIFICATION_STYLES[result.classification] || CLASSIFICATION_STYLES.FN;
  const isCorrect = result.classification === "TP" || result.classification === "TN";

  return (
    <div className="flex items-start gap-3 p-4 rounded-xl transition-all duration-200" style={{ background: cs.bg, border: "1px solid transparent" }}>
      <div className="flex-shrink-0 mt-0.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `color-mix(in srgb, ${cs.text} 20%, transparent)` }}>
          {isCorrect ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={cs.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={cs.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          )}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{result.prompt}</span>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <span className="pill" style={{ background: "rgba(0,0,0,0.1)", color: cs.text, fontWeight: 700, fontSize: "10px", padding: "1px 6px" }}>{result.classification}</span>
          <span style={{ color: result.activate ? "var(--green)" : "var(--text-tertiary)" }}>{result.activate ? "Activated" : "Silent"}</span>
          <span style={{ color: "var(--text-tertiary)" }}>Expected: {result.expected === "should_activate" ? "activate" : "stay silent"}</span>
          <span style={{ color: "var(--text-tertiary)" }}>{result.confidence} confidence</span>
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
