import { useState, useCallback, useEffect, useMemo, useRef, Fragment } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { api } from "../../api";
import type { EvalCase, Assertion, EvalsFile, CaseHistoryEntry, CredentialStatus } from "../../types";
import { getTestType } from "../../types";
import type { InlineResult, CaseRunStatus } from "./workspaceTypes";
import { passRateColor, shortDate, fmtDuration, MiniTrend } from "../../utils/historyUtils";
import { verdictExplanation } from "../../../../eval/verdict.js";
import type { VerdictExplanationResult } from "../../../../eval/verdict.js";
import { ProgressLog } from "../../components/ProgressLog";
import { ErrorCard } from "../../components/ErrorCard";
import { ParameterStorePanel } from "./ParameterStorePanel";

const READ_ONLY_TOOLTIP = "This is an installed copy (read-only). Open the source skill to edit.";

// ---------------------------------------------------------------------------
// Assertion quality badge types
// ---------------------------------------------------------------------------

interface AssertionBadges {
  flaky: boolean;          // 30-70% pass rate across recent history
  nonDiscriminating: boolean; // passes on both skill and baseline runs
  regression: boolean;     // was passing in previous run, now failing
}

// ---------------------------------------------------------------------------
// Hook: shared case history fetcher (used by badges + history section)
// ---------------------------------------------------------------------------

function useCaseHistory(plugin: string, skill: string, evalId: number) {
  const [entries, setEntries] = useState<CaseHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const prevIdRef = useRef<string>("");

  useEffect(() => {
    const key = `${plugin}/${skill}/${evalId}`;
    if (prevIdRef.current === key) return;
    prevIdRef.current = key;

    setLoading(true);
    api.getCaseHistory(plugin, skill, evalId)
      .then((data) => setEntries(data))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [plugin, skill, evalId]);

  const refetch = useCallback(() => {
    setLoading(true);
    prevIdRef.current = ""; // force refetch
    api.getCaseHistory(plugin, skill, evalId)
      .then((data) => setEntries(data))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [plugin, skill, evalId]);

  return { entries, loading, refetch };
}

// ---------------------------------------------------------------------------
// Compute assertion quality badges from history + current result
// ---------------------------------------------------------------------------

function computeAssertionBadges(
  assertionId: string,
  currentResult: { pass: boolean } | undefined,
  historyEntries: CaseHistoryEntry[] | null,
): AssertionBadges {
  const badges: AssertionBadges = { flaky: false, nonDiscriminating: false, regression: false };
  if (!historyEntries || historyEntries.length === 0) return badges;

  // --- Flaky: 30-70% pass rate across recent runs (up to 10) ---
  const recentRuns = historyEntries.slice(0, 10);
  const matchingAssertions = recentRuns
    .map((e) => e.assertions.find((a) => a.id === assertionId))
    .filter(Boolean);
  if (matchingAssertions.length >= 2) {
    const passCount = matchingAssertions.filter((a) => a!.pass).length;
    const passRate = passCount / matchingAssertions.length;
    if (passRate >= 0.3 && passRate <= 0.7) {
      badges.flaky = true;
    }
  }

  // --- Non-Discriminating: passes on both skill (benchmark) and baseline runs ---
  const latestBenchmark = historyEntries.find((e) => e.type === "benchmark");
  const latestBaseline = historyEntries.find((e) => e.type === "baseline");
  if (latestBenchmark && latestBaseline) {
    const benchmarkAssertion = latestBenchmark.assertions.find((a) => a.id === assertionId);
    const baselineAssertion = latestBaseline.assertions.find((a) => a.id === assertionId);
    if (benchmarkAssertion?.pass && baselineAssertion?.pass) {
      badges.nonDiscriminating = true;
    }
  }

  // --- Regression: was passing in previous run, now failing ---
  if (currentResult && !currentResult.pass && historyEntries.length >= 1) {
    // The first history entry is the most recent previous run
    const prevRun = historyEntries[0];
    const prevAssertion = prevRun.assertions.find((a) => a.id === assertionId);
    if (prevAssertion?.pass) {
      badges.regression = true;
    }
  }

  return badges;
}

export function TestsPanel() {
  const { state, dispatch, saveEvals, runCase, runAll, cancelCase, cancelAll, generateEvals, isReadOnly } = useWorkspace();
  const { evals, evalsError, selectedCaseId, inlineResults, caseRunStates, generateEvalsLoading, generateEvalsProgress, generateEvalsError } = state;

  const isAnyRunning = useMemo(() => {
    for (const s of caseRunStates.values()) {
      if (s.status === "running" || s.status === "queued") return true;
    }
    return false;
  }, [caseRunStates]);
  const [showForm, setShowForm] = useState(false);
  const [testTypeFilter, setTestTypeFilter] = useState<"all" | "unit" | "integration">("all");

  const defaultEvals: EvalsFile = { skill_name: state.skill, evals: [] };
  const effectiveEvals = evals ?? defaultEvals;
  const allCases = effectiveEvals.evals;
  const cases = useMemo(() =>
    testTypeFilter === "all"
      ? allCases
      : allCases.filter((c) => getTestType(c) === testTypeFilter),
    [testTypeFilter, allCases],
  );
  const selectedCase = cases.find((c) => c.id === selectedCaseId) ?? null;

  // US-001: Auto-select first visible case when filter changes and current selection is hidden
  useEffect(() => {
    if (selectedCaseId !== null && !cases.find((c) => c.id === selectedCaseId)) {
      dispatch({ type: "SELECT_CASE", caseId: cases.length > 0 ? cases[0].id : null });
    }
  }, [cases, selectedCaseId, dispatch]);

  // T-046: Fetch credential status for integration tests
  const [credentialStatuses, setCredentialStatuses] = useState<CredentialStatus[]>([]);
  const hasIntegrationTests = useMemo(() => allCases.some((c) => getTestType(c) === "integration"), [allCases]);
  useEffect(() => {
    if (!hasIntegrationTests) return;
    api.getCredentials(state.plugin, state.skill)
      .then((res) => setCredentialStatuses(res.credentials))
      .catch(() => setCredentialStatuses([]));
  }, [state.plugin, state.skill, hasIntegrationTests]);
  const missingCredNames = useMemo(() => new Set(
    credentialStatuses.filter((c) => c.status === "missing").map((c) => c.name)
  ), [credentialStatuses]);

  const [generateDropdownOpen, setGenerateDropdownOpen] = useState(false);
  const handleGenerateEvals = useCallback((testType?: "unit" | "integration") => {
    setGenerateDropdownOpen(false);
    generateEvals(testType ? { testType } : undefined);
  }, [generateEvals]);

  // Empty state (or validation error)
  if (!evals || allCases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: evalsError ? "var(--red-muted)" : "var(--accent-muted)" }}>
          {evalsError ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          )}
        </div>
        <div className="text-center">
          {evalsError ? (
            <>
              <div className="text-[14px] font-medium mb-1" style={{ color: "var(--red)" }}>Invalid evals.json</div>
              <div className="text-[11px] font-mono px-3 py-2 rounded mt-1 max-w-sm text-left break-words" style={{ color: "var(--text-secondary)", background: "var(--surface-2)" }}>{evalsError}</div>
              <div className="text-[12px] mt-2" style={{ color: "var(--text-tertiary)" }}>Fix the evals.json file and reload, or regenerate test cases with AI</div>
            </>
          ) : (
            <>
              <div className="text-[14px] font-medium mb-1" style={{ color: "var(--text-primary)" }}>No test cases yet</div>
              <div className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>Create test cases to start evaluating your skill</div>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowForm(true)}
            disabled={isReadOnly}
            title={isReadOnly ? READ_ONLY_TOOLTIP : undefined}
            className="btn btn-primary text-[12px]"
          >
            Create Test Case
          </button>
          <div style={{ position: "relative" }}>
            <div className="flex">
              <button
                onClick={() => handleGenerateEvals("unit")}
                disabled={generateEvalsLoading || isReadOnly}
                title={isReadOnly ? READ_ONLY_TOOLTIP : undefined}
                className="btn btn-secondary text-[12px]"
                style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              >
                {generateEvalsLoading ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Generating...</> : "Generate Unit Tests"}
              </button>
              <button
                onClick={() => setGenerateDropdownOpen(!generateDropdownOpen)}
                disabled={generateEvalsLoading || isReadOnly}
                title={isReadOnly ? READ_ONLY_TOOLTIP : undefined}
                className="btn btn-secondary text-[12px]"
                style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "1px solid var(--border-default)", padding: "4px 6px" }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
            </div>
            {generateDropdownOpen && (
              <div
                className="absolute right-0 mt-1 rounded-lg py-1 z-50"
                // eslint-disable-next-line vskill/no-raw-color -- intentional: dropdown elevation shadow uses alpha-only black
                style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)", minWidth: 180, boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}
              >
                <button
                  onClick={() => handleGenerateEvals("integration")}
                  className="w-full text-left px-3 py-2 text-[12px] transition-colors duration-100"
                  style={{ color: "var(--text-secondary)", background: "transparent" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  Generate Integration Tests
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Progress log during generation */}
        {generateEvalsLoading && generateEvalsProgress.length > 0 && (
          <div className="w-full max-w-md mt-3">
            <ProgressLog entries={generateEvalsProgress} isRunning={true} />
          </div>
        )}

        {/* Error from generation */}
        {generateEvalsError && (
          <div className="w-full max-w-md mt-3">
            <ErrorCard
              error={generateEvalsError}
              onRetry={() => handleGenerateEvals()}
            />
          </div>
        )}

        {showForm && (
          <NewCaseForm
            evals={effectiveEvals}
            onSave={(updated) => { saveEvals(updated); setShowForm(false); }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", height: "100%", overflow: "hidden" }}>
      {/* Left: Case list */}
      <div className="overflow-auto" style={{ borderRight: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}>
        <div
          className="px-3 py-2"
          style={{
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            rowGap: 6,
            columnGap: 8,
          }}
        >
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-tertiary)", flex: "1 1 auto", minWidth: 0 }}
          >
            Test Cases ({cases.length})
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 6,
              marginLeft: "auto",
              flexShrink: 0,
            }}
          >
            {isAnyRunning ? (
              <button
                onClick={cancelAll}
                className="btn text-[10px] px-2 py-0.5"
                style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid var(--red-muted)", whiteSpace: "nowrap" }}
              >
                Cancel All
              </button>
            ) : (
              <>
                <button onClick={() => runAll("benchmark")} disabled={cases.length === 0 || isReadOnly} title={isReadOnly ? READ_ONLY_TOOLTIP : undefined} className="btn btn-primary text-[10px] px-2 py-0.5" style={{ whiteSpace: "nowrap" }}>
                  Run All
                </button>
                <button onClick={() => runAll("comparison")} disabled={cases.length === 0 || isReadOnly} title={isReadOnly ? READ_ONLY_TOOLTIP : undefined} className="btn btn-secondary text-[10px] px-2 py-0.5" style={{ whiteSpace: "nowrap" }}>
                  Compare All
                </button>
              </>
            )}
          </div>
        </div>
        {/* Test type filter tabs */}
        <div className="flex px-3 py-1.5 gap-1" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          {(["all", "unit", "integration"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setTestTypeFilter(tab)}
              style={{
                padding: "2px 8px",
                fontSize: 10,
                fontWeight: testTypeFilter === tab ? 600 : 400,
                background: testTypeFilter === tab ? "var(--accent-muted)" : "transparent",
                color: testTypeFilter === tab ? "var(--accent)" : "var(--text-tertiary)",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {tab === "all" ? `All (${allCases.length})` : tab === "unit"
                ? `Unit (${allCases.filter((c) => getTestType(c) === "unit").length})`
                : `Integration (${allCases.filter((c) => getTestType(c) === "integration").length})`}
            </button>
          ))}
        </div>
        <div className="py-1">
          {cases.length === 0 && allCases.length > 0 && (
            <div className="flex items-center justify-center py-8 px-3 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
              No {testTypeFilter === "all" ? "" : testTypeFilter + " "}tests yet
            </div>
          )}
          {cases.map((c) => {
            const result = inlineResults.get(c.id);
            const active = selectedCaseId === c.id;
            const tt = getTestType(c);
            return (
              <button
                key={c.id}
                onClick={() => dispatch({ type: "SELECT_CASE", caseId: c.id })}
                className="w-full text-left px-3 py-2.5 transition-all duration-150"
                style={{
                  background: active ? "var(--accent-muted)" : "transparent",
                  borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--surface-2)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[12px] font-medium truncate flex items-center gap-1.5" style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)" }}>
                    #{c.id} {c.name}
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        padding: "1px 5px",
                        borderRadius: 9999,
                        background: tt === "unit" ? "var(--accent-muted)" : "var(--orange-muted)",
                        color: tt === "unit" ? "var(--accent)" : "var(--orange)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tt === "unit" ? "U" : "I"}
                    </span>
                    {/* T-046: Lock icon for integration tests with missing credentials */}
                    {tt === "integration" && c.requiredCredentials?.some((cr) => missingCredNames.has(cr)) && (
                      <span title="Configure credentials to run">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </span>
                    )}
                  </span>
                  <StatusPill result={result} />
                </div>
                <div className="text-[11px] flex items-center gap-2" style={{ color: "var(--text-tertiary)" }}>
                  {c.assertions.length} assertion{c.assertions.length !== 1 ? "s" : ""}
                  {result?.passRate != null && (
                    <MiniSparkline passRate={result.passRate} />
                  )}
                </div>
              </button>
            );
          })}
        </div>
        {/* Add case button */}
        <div className="px-3 py-2">
          {!isReadOnly && (
            <button
              onClick={() => setShowForm(true)}
              className="w-full py-2 rounded-lg text-[12px] font-medium transition-all duration-150"
              style={{
                border: "1px dashed var(--border-default)",
                color: "var(--text-tertiary)",
                background: "transparent",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.color = "var(--text-tertiary)"; }}
            >
              + Add Test Case
            </button>
          )}
        </div>

        {/* Parameter store for integration test credentials.
            T-0684 (B6): render unconditionally — the panel gracefully
            degrades to an empty "No parameters yet" state when a skill
            has zero integration tests, and the surrounding tab group is
            already visible, so hiding this row was surprising UX. */}
        <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <ParameterStorePanel />
        </div>
      </div>

      {/* Right: Case detail */}
      <div className="overflow-auto">
        {selectedCase ? (
          <CaseDetail
            evalCase={selectedCase}
            result={inlineResults.get(selectedCase.id)}
            evals={evals}
            caseStatus={caseRunStates.get(selectedCase.id)?.status ?? "idle"}
            onSaveEvals={saveEvals}
            onRun={(evalId) => runCase(evalId, "benchmark")}
            onCompare={(evalId) => runCase(evalId, "comparison")}
            onCancel={(evalId) => cancelCase(evalId)}
            onImprove={(evalId) => dispatch({ type: "OPEN_IMPROVE", evalId })}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Select a test case
          </div>
        )}
      </div>

      {/* New case modal */}
      {showForm && (
        <NewCaseForm
          evals={effectiveEvals}
          onSave={(updated) => { saveEvals(updated); setShowForm(false); }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case Detail
// ---------------------------------------------------------------------------

function CaseDetail({
  evalCase, result, evals, caseStatus, onSaveEvals, onRun, onCompare, onCancel, onImprove,
}: {
  evalCase: EvalCase;
  result: InlineResult | undefined;
  evals: EvalsFile;
  caseStatus: CaseRunStatus;
  onSaveEvals: (updated: EvalsFile) => Promise<void>;
  onRun: (evalId: number) => void;
  onCompare: (evalId: number) => void;
  onCancel: (evalId: number) => void;
  onImprove: (evalId: number) => void;
}) {
  const { state, isReadOnly } = useWorkspace();
  const { plugin, skill } = state;
  const { entries: historyEntries, loading: historyLoading } = useCaseHistory(plugin, skill, evalCase.id);

  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptText, setPromptText] = useState(evalCase.prompt);
  const [editingExpected, setEditingExpected] = useState(false);
  const [expectedText, setExpectedText] = useState(evalCase.expected_output);

  // Sync when case changes
  useState(() => { setPromptText(evalCase.prompt); setExpectedText(evalCase.expected_output); });

  const updateCase = useCallback((updated: EvalCase) => {
    onSaveEvals({ ...evals, evals: evals.evals.map((e) => e.id === updated.id ? updated : e) });
  }, [evals, onSaveEvals]);

  const savePrompt = useCallback(() => {
    updateCase({ ...evalCase, prompt: promptText });
    setEditingPrompt(false);
  }, [evalCase, promptText, updateCase]);

  const saveExpected = useCallback(() => {
    updateCase({ ...evalCase, expected_output: expectedText });
    setEditingExpected(false);
  }, [evalCase, expectedText, updateCase]);

  const addAssertion = useCallback(() => {
    updateCase({
      ...evalCase,
      assertions: [...evalCase.assertions, { id: `assert-${Date.now()}`, text: "New assertion", type: "boolean" }],
    });
  }, [evalCase, updateCase]);

  const updateAssertion = useCallback((assertionId: string, text: string) => {
    updateCase({
      ...evalCase,
      assertions: evalCase.assertions.map((a) => a.id === assertionId ? { ...a, text } : a),
    });
  }, [evalCase, updateCase]);

  const deleteAssertion = useCallback((assertionId: string) => {
    updateCase({
      ...evalCase,
      assertions: evalCase.assertions.filter((a) => a.id !== assertionId),
    });
  }, [evalCase, updateCase]);

  const deleteCase = useCallback(() => {
    if (!confirm("Delete this test case?")) return;
    onSaveEvals({ ...evals, evals: evals.evals.filter((e) => e.id !== evalCase.id) });
  }, [evals, evalCase.id, onSaveEvals]);

  const allPassing = result && result.assertions.length > 0 && result.assertions.every((a) => a.pass);
  const hasFails = result && result.assertions.some((a) => !a.pass);
  const tt = getTestType(evalCase);
  const missingCreds = evalCase.requiredCredentials ?? [];
  const hasCredGate = tt === "integration" && missingCreds.length > 0;

  return (
    <div className="p-5 animate-fade-in" key={evalCase.id}>
      {/* Title + actions — wraps to two rows on narrow detail panes so the
          title never gets squeezed into one-word-per-line. */}
      <div
        className="mb-4"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          rowGap: 8,
          columnGap: 12,
        }}
      >
        <div
          className="flex items-center gap-2"
          style={{ flex: "1 1 240px", minWidth: 0 }}
        >
          <span
            className="text-[16px] font-semibold"
            title={`#${evalCase.id} ${evalCase.name}`}
            style={{
              color: "var(--text-primary)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            #{evalCase.id} {evalCase.name}
          </span>
          {isReadOnly ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: 9999,
                background: tt === "unit" ? "var(--accent-muted)" : "var(--orange-muted)",
                color: tt === "unit" ? "var(--accent)" : "var(--orange)",
              }}
            >
              {tt === "unit" ? "Unit" : "Integration"}
            </span>
          ) : (
            <button
              onClick={() => {
                const newType = tt === "unit" ? "integration" : "unit";
                if (newType === "unit") {
                  const { requiredCredentials, requirements, cleanup, ...rest } = evalCase;
                  updateCase({ ...rest, testType: "unit" });
                } else {
                  updateCase({ ...evalCase, testType: "integration" });
                }
              }}
              title={`Click to switch to ${tt === "unit" ? "integration" : "unit"}`}
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: 9999,
                background: tt === "unit" ? "var(--accent-muted)" : "var(--orange-muted)",
                color: tt === "unit" ? "var(--accent)" : "var(--orange)",
                border: "none",
                cursor: "pointer",
              }}
            >
              {tt === "unit" ? "Unit" : "Integration"}
            </button>
          )}
          <StatusPill result={result} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginLeft: "auto",
            flexShrink: 0,
          }}
        >
          {caseStatus === "running" || caseStatus === "queued" ? (
            <button onClick={() => onCancel(evalCase.id)} className="btn text-[12px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid var(--red-muted)", whiteSpace: "nowrap" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              Cancel
            </button>
          ) : (
            <>
              <button onClick={() => onRun(evalCase.id)} disabled={isReadOnly} className="btn btn-primary text-[12px]" style={{ whiteSpace: "nowrap" }}>
                Run
              </button>
              <button onClick={() => onCompare(evalCase.id)} disabled={isReadOnly} className="btn btn-secondary text-[12px]" style={{ whiteSpace: "nowrap" }}>
                A/B Compare
              </button>
            </>
          )}
          {hasFails && !isReadOnly && caseStatus !== "running" && caseStatus !== "queued" && (
            <button onClick={() => onImprove(evalCase.id)} className="btn btn-secondary text-[12px]" style={{ whiteSpace: "nowrap" }}>
              Fix with AI
            </button>
          )}
          {!isReadOnly && caseStatus !== "running" && caseStatus !== "queued" && (
            <button onClick={deleteCase} className="btn btn-ghost text-[12px]" aria-label="Delete test case" title="Delete test case" style={{ color: "var(--red)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* T-048: Platform note for integration tests on installed skills */}
      {isReadOnly && tt === "integration" && (
        <div
          data-testid="platform-integration-note"
          className="mb-4 px-4 py-3 rounded-xl flex items-center gap-3"
          style={{ background: "var(--accent-muted)", border: "1px solid var(--accent-muted)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span className="text-[12px] font-medium" style={{ color: "var(--accent)" }}>
            Run locally in vSkill Studio
          </span>
        </div>
      )}

      {/* All passing celebration */}
      {allPassing && (
        <div className="mb-4 px-4 py-3 rounded-xl flex items-center gap-3" style={{ background: "var(--green-muted)", border: "1px solid var(--green-muted)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          <span className="text-[13px] font-medium" style={{ color: "var(--green)" }}>All assertions passing</span>
        </div>
      )}

      {/* Credential gate for integration tests */}
      {hasCredGate && (
        <div className="mb-4 px-4 py-3 rounded-xl" style={{ background: "var(--orange-muted)", border: "1px solid var(--orange-muted)" }}>
          <div className="flex items-center gap-2 mb-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="text-[12px] font-semibold" style={{ color: "var(--orange)" }}>Required Credentials</span>
          </div>
          <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            This integration test requires the following environment variables:
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {missingCreds.map((cred) => (
              <span
                key={cred}
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono, monospace)",
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "var(--orange-muted)",
                  color: "var(--orange)",
                }}
              >
                {cred}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Editable integration fields */}
      {!isReadOnly && tt === "integration" && (
        <IntegrationFieldsEditor evalCase={evalCase} onUpdate={updateCase} />
      )}

      {/* Prompt */}
      <Section title="Prompt">
        {editingPrompt ? (
          <div>
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              className="input-field w-full"
              rows={4}
              style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12 }}
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button onClick={savePrompt} className="btn btn-primary text-[12px]">Save</button>
              <button onClick={() => { setPromptText(evalCase.prompt); setEditingPrompt(false); }} className="btn btn-ghost text-[12px]">Cancel</button>
            </div>
          </div>
        ) : (
          <div
            className="p-3 rounded-lg text-[12px] transition-all duration-150"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              whiteSpace: "pre-wrap",
              border: "1px solid var(--border-subtle)",
              maxHeight: 200,
              overflowY: "auto",
              cursor: isReadOnly ? "default" : "pointer",
            }}
            onClick={() => { if (!isReadOnly) setEditingPrompt(true); }}
            onMouseEnter={(e) => { if (!isReadOnly) e.currentTarget.style.borderColor = "var(--border-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
          >
            {evalCase.prompt || <span style={{ color: "var(--text-tertiary)", fontStyle: "italic" }}>{isReadOnly ? "No prompt" : "Click to edit prompt..."}</span>}
          </div>
        )}
      </Section>

      {/* Expected Output */}
      <Section title="Expected Output">
        {editingExpected ? (
          <div>
            <textarea
              value={expectedText}
              onChange={(e) => setExpectedText(e.target.value)}
              className="input-field w-full"
              rows={3}
              style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12 }}
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button onClick={saveExpected} className="btn btn-primary text-[12px]">Save</button>
              <button onClick={() => { setExpectedText(evalCase.expected_output); setEditingExpected(false); }} className="btn btn-ghost text-[12px]">Cancel</button>
            </div>
          </div>
        ) : (
          <div
            className="p-3 rounded-lg text-[12px] transition-all duration-150"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              whiteSpace: "pre-wrap",
              border: "1px solid var(--border-subtle)",
              maxHeight: 200,
              overflowY: "auto",
              cursor: isReadOnly ? "default" : "pointer",
            }}
            onClick={() => { if (!isReadOnly) setEditingExpected(true); }}
            onMouseEnter={(e) => { if (!isReadOnly) e.currentTarget.style.borderColor = "var(--border-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
          >
            {evalCase.expected_output || <span style={{ fontStyle: "italic" }}>{isReadOnly ? "No expected output" : "Click to edit expected output..."}</span>}
          </div>
        )}
      </Section>

      {/* Assertions */}
      <Section title={`Assertions (${evalCase.assertions.length})`} action={!isReadOnly ? <button onClick={addAssertion} className="btn btn-ghost text-[11px]">+ Add</button> : undefined}>
        {evalCase.assertions.length === 0 ? (
          <div className="text-[12px] text-center py-4" style={{ color: "var(--text-tertiary)" }}>
            No assertions. Click "+ Add" to create one.
          </div>
        ) : (
          <div className="space-y-2">
            {evalCase.assertions.map((a) => {
              const r = result?.assertions.find((ar) => ar.assertion_id === a.id);
              const badges = computeAssertionBadges(a.id, r, historyEntries);
              return (
                <AssertionRow
                  key={a.id}
                  assertion={a}
                  result={r}
                  badges={badges}
                  isReadOnly={isReadOnly}
                  onUpdate={(text) => updateAssertion(a.id, text)}
                  onDelete={() => deleteAssertion(a.id)}
                />
              );
            })}
          </div>
        )}
      </Section>

      {/* LLM Output (collapsible) */}
      {result?.output && <OutputSection output={result.output} durationMs={result.durationMs} tokens={result.tokens} />}

      {/* Recommendations for INEFFECTIVE results (score < 0.2) */}
      {result && result.passRate != null && result.passRate < 0.2 && (() => {
        const ve = verdictExplanation("INEFFECTIVE", result.passRate);
        return ve.recommendations && ve.recommendations.length > 0 ? (
          <Section title="Recommendations">
            <div className="rounded-xl p-4" style={{ background: "var(--orange-muted)", border: "1px solid var(--orange-muted)" }}>
              <div className="flex items-center gap-2 mb-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span className="text-[12px] font-semibold" style={{ color: "var(--orange)" }}>
                  This eval is significantly below expectations
                </span>
              </div>
              <ul className="space-y-1.5 ml-1">
                {ve.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--orange)", fontWeight: 600, flexShrink: 0 }}>•</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        ) : null;
      })()}

      {/* Execution History (collapsible) */}
      <CaseHistorySection evalId={evalCase.id} sharedEntries={historyEntries} sharedLoading={historyLoading} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assertion Row
// ---------------------------------------------------------------------------

function AssertionRow({
  assertion, result, badges, isReadOnly, onUpdate, onDelete,
}: {
  assertion: Assertion;
  result?: { pass: boolean; reasoning: string };
  badges?: AssertionBadges;
  isReadOnly?: boolean;
  onUpdate: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(assertion.text);
  const [showReasoning, setShowReasoning] = useState(false);

  const save = () => { onUpdate(text); setEditing(false); };

  return (
    <div
      className="rounded-lg px-3 py-2.5 transition-all duration-150"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="flex items-start gap-2">
        {/* Pass/fail indicator */}
        {result ? (
          <span
            className="mt-0.5 rounded-full flex-shrink-0"
            style={{
              width: 18, height: 18,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: result.pass ? "var(--green-muted)" : "var(--red-muted)",
            }}
          >
            {result.pass ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            )}
          </span>
        ) : (
          <span
            className="mt-0.5 rounded-full flex-shrink-0"
            style={{
              width: 18, height: 18,
              border: "1.5px dashed var(--text-tertiary)",
              background: "transparent",
            }}
            title="Not run yet"
          />
        )}

        {/* Regression marker (red downward arrow) */}
        {badges?.regression && (
          <span
            className="mt-0.5 flex-shrink-0"
            title="Regression: was passing, now failing"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 16, height: 18,
              color: "var(--red)",
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </span>
        )}

        {/* ID + text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-mono font-semibold" style={{ color: "var(--text-tertiary)" }}>{assertion.id}</span>
            {/* Quality badges */}
            {badges?.flaky && (
              <span
                title="Flaky: 30-70% pass rate across recent runs"
                style={{
                  display: "inline-block",
                  fontSize: 9,
                  fontWeight: 600,
                  lineHeight: 1,
                  padding: "2px 6px",
                  borderRadius: 9999,
                  background: "var(--yellow-muted)",
                  color: "var(--yellow)",
                  whiteSpace: "nowrap",
                }}
              >
                Flaky
              </span>
            )}
            {badges?.nonDiscriminating && (
              <span
                title="Non-discriminating: passes on both skill and baseline runs"
                style={{
                  display: "inline-block",
                  fontSize: 9,
                  fontWeight: 600,
                  lineHeight: 1,
                  padding: "2px 6px",
                  borderRadius: 9999,
                  background: "var(--surface-3)",
                  color: "var(--text-tertiary)",
                  whiteSpace: "nowrap",
                }}
              >
                Non-Discrim.
              </span>
            )}
          </div>
          {editing ? (
            <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
                className="input-field flex-1 text-[12px]"
                autoFocus
              />
              <button onClick={save} className="btn btn-primary text-[11px]">Save</button>
            </div>
          ) : (
            <div
              className="text-[12px]"
              style={{ color: "var(--text-secondary)", cursor: isReadOnly ? "default" : "pointer" }}
              onClick={() => { if (!isReadOnly) { setText(assertion.text); setEditing(true); } }}
            >
              {assertion.text}
            </div>
          )}

          {/* Reasoning toggle */}
          {result?.reasoning && (
            <button
              onClick={() => setShowReasoning(!showReasoning)}
              className="text-[11px] mt-1 transition-colors duration-150"
              style={{ color: "var(--text-tertiary)" }}
            >
              {showReasoning ? "Hide reasoning" : "Show reasoning"}
            </button>
          )}
          {showReasoning && result?.reasoning && (
            <div className="mt-1 text-[11px] p-2 rounded" style={{ background: "var(--surface-1)", color: "var(--text-tertiary)" }}>
              {result.reasoning}
            </div>
          )}
        </div>

        {/* Delete */}
        {!isReadOnly && (
          <button
            onClick={onDelete}
            className="btn btn-ghost p-1 opacity-0 group-hover:opacity-100"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--red)"; e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.opacity = ""; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

function StatusPill({ result }: { result?: InlineResult }) {
  const [showTooltip, setShowTooltip] = useState(false);
  if (!result || result.status == null) {
    return <span className="pill text-[10px]" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>--</span>;
  }
  const pass = result.status === "pass";
  const score = result.passRate ?? 0;
  const verdict = pass ? "PASS" : "FAIL";
  const explanation = verdictExplanation(verdict, score);

  return (
    <span
      className="pill text-[10px]"
      style={{
        background: pass ? "var(--green-muted)" : "var(--red-muted)",
        color: pass ? "var(--green)" : "var(--red)",
        position: "relative",
        cursor: "default",
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      aria-describedby={showTooltip ? "verdict-tooltip" : undefined}
    >
      {result.passRate != null ? `${Math.round(result.passRate * 100)}%` : result.status}
      {showTooltip && (
        <div
          id="verdict-tooltip"
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            right: 0,
            padding: "6px 10px",
            background: "var(--surface-4)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--text-secondary)",
            whiteSpace: "nowrap",
            zIndex: 50,
            maxWidth: 300,
            width: "max-content",
            // eslint-disable-next-line vskill/no-raw-color -- intentional: tooltip elevation shadow uses alpha-only black
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          {explanation.explanation}
        </div>
      )}
    </span>
  );
}

function MiniSparkline({ passRate }: { passRate: number }) {
  const pct = Math.round(passRate * 100);
  return (
    <div className="flex items-center gap-1">
      <div className="rounded-full overflow-hidden" style={{ width: 32, height: 4, background: "var(--surface-4)" }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: pct >= 80 ? "var(--green)" : pct >= 50 ? "var(--yellow)" : "var(--red)" }}
        />
      </div>
    </div>
  );
}

function OutputSection({ output, durationMs, tokens }: { output: string; durationMs?: number; tokens?: number | null }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mb-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider mb-2 transition-colors duration-150"
        style={{ color: "var(--text-tertiary)" }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s ease" }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        LLM Output
        {durationMs != null && <span style={{ fontWeight: 400 }}>({(durationMs / 1000).toFixed(1)}s)</span>}
        {tokens != null && <span style={{ fontWeight: 400 }}>({tokens} tokens)</span>}
      </button>
      {expanded && (
        <pre
          className="text-[12px] p-4 rounded-lg overflow-auto animate-fade-in"
          style={{
            background: "var(--surface-1)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-subtle)",
            maxHeight: 400,
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {output}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lane assignment for split-lane history grid
// ---------------------------------------------------------------------------

export function getLane(type: string): "left" | "right" | "full" {
  if (type === "baseline") return "right";
  if (type === "comparison") return "full";
  return "left";
}

// ---------------------------------------------------------------------------
// History entry card (shared between flat and split-lane views)
// ---------------------------------------------------------------------------

function HistoryEntryCard({ entry }: { entry: CaseHistoryEntry }) {
  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
    >
      {/* Run header */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>
          {shortDate(entry.timestamp)}
        </span>
        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{entry.model}</span>
        <span
          className="pill"
          style={{
            fontSize: 9, padding: "1px 6px",
            background: entry.type === "benchmark" ? "var(--accent-muted)" : entry.type === "comparison" ? "var(--purple-muted)" : "var(--orange-muted)",
            color: entry.type === "benchmark" ? "var(--accent)" : entry.type === "comparison" ? "var(--purple)" : "var(--orange)",
          }}
        >
          {entry.type}
        </span>
        <span className="text-[12px] font-semibold ml-auto" style={{ color: passRateColor(entry.pass_rate) }}>
          {Math.round(entry.pass_rate * 100)}%
        </span>
      </div>

      {/* Metrics */}
      <div className="flex items-center gap-4 mb-1.5 text-[10px]" style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-tertiary)" }}>
        {entry.durationMs != null && <span>{fmtDuration(entry.durationMs)}</span>}
        {entry.tokens != null && <span>{entry.tokens >= 1000 ? `${(entry.tokens / 1000).toFixed(1)}k` : entry.tokens} tok</span>}
      </div>

      {/* Delta + verdict badge for comparison entries */}
      {entry.type === "comparison" && entry.baselinePassRate != null && (() => {
        const delta = entry.pass_rate - entry.baselinePassRate;
        const verdict = delta > 0.001 ? "skill" : delta < -0.001 ? "baseline" : "tie";
        const deltaSign = delta > 0 ? "+" : "";
        const verdictColor = verdict === "skill" ? "var(--green)" : verdict === "baseline" ? "var(--red)" : "var(--text-tertiary)";
        return (
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>vs baseline:</span>
            <span className="text-[11px] font-semibold" style={{ color: delta >= 0 ? "var(--green)" : "var(--red)" }}>
              {deltaSign}{(delta * 100).toFixed(1)}%
            </span>
            <span className="pill text-[9px]" style={{ padding: "1px 5px", background: "var(--surface-3)", color: verdictColor }}>
              {verdict}
            </span>
          </div>
        );
      })()}

      {/* Assertions */}
      <div className="space-y-0.5">
        {entry.assertions.map((a) => (
          <div key={a.id} className="flex items-start gap-1.5">
            <span
              className="mt-0.5 rounded-full flex-shrink-0"
              style={{
                width: 14, height: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: a.pass ? "var(--green-muted)" : "var(--red-muted)",
              }}
            >
              {a.pass ? (
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
              ) : (
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              )}
            </span>
            <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{a.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case History Section (collapsible, split-lane grid layout)
// ---------------------------------------------------------------------------

function CaseHistorySection({ evalId, sharedEntries, sharedLoading }: {
  evalId: number;
  sharedEntries?: CaseHistoryEntry[] | null;
  sharedLoading?: boolean;
}) {
  const { state, dispatch } = useWorkspace();
  const { plugin, skill } = state;
  const [expanded, setExpanded] = useState(true);

  // Use shared data from parent (useCaseHistory hook in CaseDetail) to avoid duplicate fetches
  const entries = sharedEntries ?? null;
  const loading = sharedLoading ?? false;

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const displayEntries = entries ? entries.slice(0, 10) : [];

  const hasLeft = displayEntries.some((e) => { const l = getLane(e.type); return l === "left" || l === "full"; });
  const hasRight = displayEntries.some((e) => { const l = getLane(e.type); return l === "right" || l === "full"; });

  return (
    <div className="mb-5">
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider mb-2 transition-colors duration-150"
        style={{ color: "var(--text-tertiary)" }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s ease" }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        Execution History
        {entries && entries.length > 0 && <span style={{ fontWeight: 400 }}>({entries.length} run{entries.length !== 1 ? "s" : ""})</span>}
      </button>

      {expanded && (
        <div className="animate-fade-in">
          {loading ? (
            <div className="flex items-center gap-2 py-3">
              <div className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
              <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>Loading history...</span>
            </div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-[12px] py-3" style={{ color: "var(--text-tertiary)" }}>
              No history for this case
            </div>
          ) : (
            <div>
              {/* Sparkline trend */}
              {displayEntries.length >= 2 && (
                <div className="mb-2">
                  <MiniTrend entries={displayEntries} />
                </div>
              )}

              {/* Split-lane grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {/* Column headers */}
                <div
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-tertiary)", gridColumn: "1" }}
                >
                  Skill
                </div>
                <div
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-tertiary)", gridColumn: "2" }}
                >
                  Baseline
                </div>

                {/* Empty column placeholders */}
                {!hasLeft && (
                  <div style={{ gridColumn: "1", fontSize: 12, color: "var(--text-tertiary)" }}>
                    No skill runs
                  </div>
                )}
                {!hasRight && (
                  <div style={{ gridColumn: "2", fontSize: 12, color: "var(--text-tertiary)" }}>
                    No baseline runs
                  </div>
                )}

                {/* Entries */}
                {displayEntries.map((entry, idx) => {
                  const lane = getLane(entry.type);
                  if (lane === "full") {
                    return (
                      <div key={idx} style={{ gridColumn: "1 / -1" }}>
                        <HistoryEntryCard entry={entry} />
                      </div>
                    );
                  }
                  if (lane === "left") {
                    return (
                      <Fragment key={idx}>
                        <div style={{ gridColumn: "1" }}>
                          <HistoryEntryCard entry={entry} />
                        </div>
                        <div style={{ gridColumn: "2" }} />
                      </Fragment>
                    );
                  }
                  // lane === "right"
                  return (
                    <Fragment key={idx}>
                      <div style={{ gridColumn: "1" }} />
                      <div style={{ gridColumn: "2" }}>
                        <HistoryEntryCard entry={entry} />
                      </div>
                    </Fragment>
                  );
                })}
              </div>

              {/* View full history link */}
              <button
                onClick={() => dispatch({ type: "SET_PANEL", panel: "history" })}
                className="mt-2 text-[11px] font-medium transition-colors duration-150"
                style={{ color: "var(--accent)" }}
                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
              >
                View full history →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Case Form (modal overlay)
// ---------------------------------------------------------------------------

function NewCaseForm({ evals, onSave, onCancel }: { evals: EvalsFile; onSave: (updated: EvalsFile) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [expected, setExpected] = useState("");
  const [assertions, setAssertions] = useState<Assertion[]>([{ id: `assert-${Date.now()}`, text: "", type: "boolean" }]);
  const [testType, setTestType] = useState<"unit" | "integration">("unit");
  const [credentialInput, setCredentialInput] = useState("");
  const [credentials, setCredentials] = useState<string[]>([]);
  const [platform, setPlatform] = useState("");
  const [chromeProfile, setChromeProfile] = useState("");

  const nextId = Math.max(0, ...evals.evals.map((e) => e.id)) + 1;

  const handleTypeChange = (type: "unit" | "integration") => {
    setTestType(type);
    if (type === "unit") {
      setCredentials([]);
      setCredentialInput("");
      setPlatform("");
      setChromeProfile("");
    }
  };

  const addCredential = () => {
    const val = credentialInput.trim().toUpperCase();
    if (val && !credentials.includes(val)) {
      setCredentials([...credentials, val]);
    }
    setCredentialInput("");
  };

  const handleSave = () => {
    if (!name.trim() || !prompt.trim()) return;
    const newCase: EvalCase = {
      id: nextId,
      name: name.trim(),
      prompt: prompt.trim(),
      expected_output: expected.trim(),
      files: [],
      assertions: assertions.filter((a) => a.text.trim()),
      ...(testType === "integration" ? {
        testType: "integration" as const,
        ...(credentials.length > 0 ? { requiredCredentials: credentials } : {}),
        ...((platform || chromeProfile) ? { requirements: {
          ...(platform ? { platform } : {}),
          ...(chromeProfile ? { chromeProfile } : {}),
        } } : {}),
      } : {}),
    };
    onSave({ ...evals, evals: [...evals.evals, newCase] });
  };

  return (
    // eslint-disable-next-line vskill/no-raw-color -- intentional: modal scrim uses alpha-only black
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-overlay-in" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="w-full max-w-lg rounded-xl p-6 animate-modal-in" style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)", maxHeight: "85vh", overflowY: "auto" }}>
        <div className="text-[15px] font-semibold mb-4" style={{ color: "var(--text-primary)" }}>New Test Case</div>

        {/* Test type toggle */}
        <div className="mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: "var(--text-tertiary)" }}>Type</span>
          <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "var(--surface-2)", display: "inline-flex" }}>
            {(["unit", "integration"] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                className="px-3 py-1 rounded-md text-[12px] font-medium transition-all duration-150"
                style={{
                  background: testType === t ? (t === "unit" ? "var(--accent-muted)" : "var(--orange-muted)") : "transparent",
                  color: testType === t ? (t === "unit" ? "var(--accent)" : "var(--orange)") : "var(--text-tertiary)",
                  border: "none",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <label className="block mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="e.g., auth-check" autoFocus />
        </label>

        <label className="block mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Prompt</span>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="input-field" rows={3} placeholder="User prompt to test..." />
        </label>

        <label className="block mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: "var(--text-tertiary)" }}>Expected Output</span>
          <textarea value={expected} onChange={(e) => setExpected(e.target.value)} className="input-field" rows={2} placeholder="Description of expected behavior..." />
        </label>

        <div className="mb-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider mb-2 block" style={{ color: "var(--text-tertiary)" }}>Assertions</span>
          {assertions.map((a, i) => (
            <div key={a.id} className="flex gap-2 mb-2">
              <input
                value={a.text}
                onChange={(e) => setAssertions(assertions.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                className="input-field flex-1 text-[12px]"
                placeholder="e.g., Output includes a greeting"
              />
              {assertions.length > 1 && (
                <button onClick={() => setAssertions(assertions.filter((_, j) => j !== i))} className="btn btn-ghost p-1" style={{ color: "var(--text-tertiary)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => setAssertions([...assertions, { id: `assert-${Date.now()}`, text: "", type: "boolean" }])}
            className="text-[11px] mt-1 transition-colors duration-150"
            style={{ color: "var(--accent)" }}
          >
            + Add Assertion
          </button>
        </div>

        {/* Integration-specific fields */}
        {testType === "integration" && (
          <div className="mb-4 p-3 rounded-lg" style={{ background: "var(--orange-muted)", border: "1px solid var(--orange-muted)" }}>
            <span className="text-[11px] font-semibold uppercase tracking-wider mb-2 block" style={{ color: "var(--orange)" }}>Integration Settings</span>

            {/* Required Credentials */}
            <div className="mb-3">
              <span className="text-[11px] mb-1 block" style={{ color: "var(--text-secondary)" }}>Required Credentials</span>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {credentials.map((cred) => (
                  <span
                    key={cred}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono"
                    style={{ background: "var(--orange-muted)", color: "var(--orange)" }}
                  >
                    {cred}
                    <button onClick={() => setCredentials(credentials.filter((c) => c !== cred))} style={{ color: "var(--orange)", lineHeight: 1 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  value={credentialInput}
                  onChange={(e) => setCredentialInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCredential(); } }}
                  className="input-field flex-1 text-[11px] font-mono"
                  placeholder="e.g., SLACK_BOT_TOKEN"
                />
                <button onClick={addCredential} className="btn btn-ghost text-[11px]" style={{ color: "var(--orange)" }}>Add</button>
              </div>
            </div>

            {/* Platform */}
            <label className="block mb-3">
              <span className="text-[11px] mb-1 block" style={{ color: "var(--text-secondary)" }}>Platform</span>
              <input value={platform} onChange={(e) => setPlatform(e.target.value)} className="input-field text-[11px]" placeholder="e.g., linkedin, twitter" />
            </label>

            {/* Chrome Profile */}
            <label className="block">
              <span className="text-[11px] mb-1 block" style={{ color: "var(--text-secondary)" }}>Chrome Profile</span>
              <input value={chromeProfile} onChange={(e) => setChromeProfile(e.target.value)} className="input-field text-[11px]" placeholder="e.g., Default" />
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-secondary text-[12px]">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim() || !prompt.trim()} className="btn btn-primary text-[12px]">Save</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integration Fields Editor (used in CaseDetail)
// ---------------------------------------------------------------------------

function IntegrationFieldsEditor({ evalCase, onUpdate }: { evalCase: EvalCase; onUpdate: (updated: EvalCase) => void }) {
  const [credInput, setCredInput] = useState("");

  const addCred = () => {
    const val = credInput.trim().toUpperCase();
    if (val && !(evalCase.requiredCredentials ?? []).includes(val)) {
      onUpdate({ ...evalCase, requiredCredentials: [...(evalCase.requiredCredentials ?? []), val] });
    }
    setCredInput("");
  };

  const removeCred = (cred: string) => {
    const updated = (evalCase.requiredCredentials ?? []).filter((c) => c !== cred);
    onUpdate({ ...evalCase, requiredCredentials: updated.length > 0 ? updated : undefined });
  };

  return (
    <div className="mb-4 p-3 rounded-lg" style={{ background: "var(--orange-muted)", border: "1px solid var(--orange-muted)" }}>
      <span className="text-[11px] font-semibold uppercase tracking-wider mb-2 block" style={{ color: "var(--orange)" }}>Integration Settings</span>

      {/* Required Credentials */}
      <div className="mb-2.5">
        <span className="text-[10px] mb-1 block" style={{ color: "var(--text-secondary)" }}>Required Credentials</span>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {(evalCase.requiredCredentials ?? []).map((cred) => (
            <span key={cred} className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono" style={{ background: "var(--orange-muted)", color: "var(--orange)" }}>
              {cred}
              <button onClick={() => removeCred(cred)} style={{ color: "var(--orange)", lineHeight: 1 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            value={credInput}
            onChange={(e) => setCredInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCred(); } }}
            className="input-field flex-1 text-[11px] font-mono"
            placeholder="e.g., GITHUB_TOKEN"
          />
          <button onClick={addCred} className="btn btn-ghost text-[11px]" style={{ color: "var(--orange)" }}>Add</button>
        </div>
      </div>

      {/* Platform */}
      <div className="mb-2.5">
        <span className="text-[10px] mb-1 block" style={{ color: "var(--text-secondary)" }}>Platform</span>
        <input
          value={evalCase.requirements?.platform ?? ""}
          onChange={(e) => onUpdate({ ...evalCase, requirements: { ...evalCase.requirements, platform: e.target.value || undefined } })}
          className="input-field text-[11px]"
          placeholder="e.g., linkedin, twitter"
        />
      </div>

      {/* Chrome Profile */}
      <div>
        <span className="text-[10px] mb-1 block" style={{ color: "var(--text-secondary)" }}>Chrome Profile</span>
        <input
          value={evalCase.requirements?.chromeProfile ?? ""}
          onChange={(e) => onUpdate({ ...evalCase, requirements: { ...evalCase.requirements, chromeProfile: e.target.value || undefined } })}
          className="input-field text-[11px]"
          placeholder="e.g., Default"
        />
      </div>
    </div>
  );
}
