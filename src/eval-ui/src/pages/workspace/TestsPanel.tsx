import { useState, useCallback, useEffect, useMemo } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { api } from "../../api";
import type { EvalCase, Assertion, EvalsFile, CaseHistoryEntry } from "../../types";
import type { InlineResult, CaseRunStatus } from "./workspaceTypes";
import { passRateColor, shortDate, fmtDuration, MiniTrend } from "../../utils/historyUtils";
import { ProgressLog } from "../../components/ProgressLog";
import { ErrorCard } from "../../components/ErrorCard";

export function TestsPanel() {
  const { state, dispatch, saveEvals, runCase, cancelCase, generateEvals } = useWorkspace();
  const { evals, selectedCaseId, inlineResults, caseRunStates, generateEvalsLoading, generateEvalsProgress, generateEvalsError } = state;
  const [showForm, setShowForm] = useState(false);

  const defaultEvals: EvalsFile = { skill_name: state.skill, evals: [] };
  const effectiveEvals = evals ?? defaultEvals;
  const cases = effectiveEvals.evals;
  const selectedCase = cases.find((c) => c.id === selectedCaseId) ?? null;

  const handleGenerateEvals = useCallback(() => {
    generateEvals();
  }, [generateEvals]);

  // Empty state
  if (!evals || cases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "var(--accent-muted)" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <div className="text-center">
          <div className="text-[14px] font-medium mb-1" style={{ color: "var(--text-primary)" }}>No test cases yet</div>
          <div className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>Create test cases to start evaluating your skill</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowForm(true)} className="btn btn-primary text-[12px]">Create Test Case</button>
          <button onClick={handleGenerateEvals} disabled={generateEvalsLoading} className="btn btn-secondary text-[12px]">
            {generateEvalsLoading ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Generating...</> : "Generate with AI"}
          </button>
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
              onRetry={handleGenerateEvals}
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
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border-subtle)" }}>
          Test Cases ({cases.length})
        </div>
        <div className="py-1">
          {cases.map((c) => {
            const result = inlineResults.get(c.id);
            const active = selectedCaseId === c.id;
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
                  <span className="text-[12px] font-medium truncate" style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)" }}>
                    #{c.id} {c.name}
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

  return (
    <div className="p-5 animate-fade-in" key={evalCase.id}>
      {/* Title + actions */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>
            #{evalCase.id} {evalCase.name}
          </span>
          <StatusPill result={result} />
        </div>
        <div className="flex items-center gap-2">
          {caseStatus === "running" || caseStatus === "queued" ? (
            <button onClick={() => onCancel(evalCase.id)} className="btn text-[12px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              Cancel
            </button>
          ) : (
            <>
              <button onClick={() => onRun(evalCase.id)} className="btn btn-primary text-[12px]">
                Run
              </button>
              <button onClick={() => onCompare(evalCase.id)} className="btn btn-purple text-[12px]">
                A/B Compare
              </button>
            </>
          )}
          {hasFails && caseStatus !== "running" && caseStatus !== "queued" && (
            <button onClick={() => onImprove(evalCase.id)} className="btn btn-secondary text-[12px]">
              Fix with AI
            </button>
          )}
          {caseStatus !== "running" && caseStatus !== "queued" && (
            <button onClick={deleteCase} className="btn btn-ghost text-[12px]" style={{ color: "var(--red)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* All passing celebration */}
      {allPassing && (
        <div className="mb-4 px-4 py-3 rounded-xl flex items-center gap-3" style={{ background: "var(--green-muted)", border: "1px solid rgba(52, 211, 153, 0.2)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          <span className="text-[13px] font-medium" style={{ color: "var(--green)" }}>All assertions passing</span>
        </div>
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
            className="p-3 rounded-lg text-[12px] cursor-pointer transition-all duration-150"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              whiteSpace: "pre-wrap",
              border: "1px solid var(--border-subtle)",
              maxHeight: 200,
              overflowY: "auto",
            }}
            onClick={() => setEditingPrompt(true)}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
          >
            {evalCase.prompt || <span style={{ color: "var(--text-tertiary)", fontStyle: "italic" }}>Click to edit prompt...</span>}
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
            className="p-3 rounded-lg text-[12px] cursor-pointer transition-all duration-150"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              whiteSpace: "pre-wrap",
              border: "1px solid var(--border-subtle)",
              maxHeight: 200,
              overflowY: "auto",
            }}
            onClick={() => setEditingExpected(true)}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--border-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
          >
            {evalCase.expected_output || <span style={{ fontStyle: "italic" }}>Click to edit expected output...</span>}
          </div>
        )}
      </Section>

      {/* Assertions */}
      <Section title={`Assertions (${evalCase.assertions.length})`} action={<button onClick={addAssertion} className="btn btn-ghost text-[11px]">+ Add</button>}>
        {evalCase.assertions.length === 0 ? (
          <div className="text-[12px] text-center py-4" style={{ color: "var(--text-tertiary)" }}>
            No assertions. Click "+ Add" to create one.
          </div>
        ) : (
          <div className="space-y-2">
            {evalCase.assertions.map((a) => {
              const r = result?.assertions.find((ar) => ar.assertion_id === a.id);
              return (
                <AssertionRow
                  key={a.id}
                  assertion={a}
                  result={r}
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

      {/* Execution History (collapsible) */}
      <CaseHistorySection evalId={evalCase.id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assertion Row
// ---------------------------------------------------------------------------

function AssertionRow({
  assertion, result, onUpdate, onDelete,
}: {
  assertion: Assertion;
  result?: { pass: boolean; reasoning: string };
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

        {/* ID + text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-mono font-semibold" style={{ color: "var(--text-tertiary)" }}>{assertion.id}</span>
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
              className="text-[12px] cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
              onClick={() => { setText(assertion.text); setEditing(true); }}
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
        <button
          onClick={onDelete}
          className="btn btn-ghost p-1 opacity-0 group-hover:opacity-100"
          style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--red)"; e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.opacity = ""; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
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
  if (!result || result.status == null) {
    return <span className="pill text-[10px]" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>--</span>;
  }
  const pass = result.status === "pass";
  return (
    <span
      className="pill text-[10px]"
      style={{
        background: pass ? "var(--green-muted)" : "var(--red-muted)",
        color: pass ? "var(--green)" : "var(--red)",
      }}
    >
      {result.passRate != null ? `${Math.round(result.passRate * 100)}%` : result.status}
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
// Case History Section (collapsible, lazy-loaded)
// ---------------------------------------------------------------------------

function CaseHistorySection({ evalId }: { evalId: number }) {
  const { state, dispatch } = useWorkspace();
  const { plugin, skill } = state;
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [cache, setCache] = useState<Record<number, CaseHistoryEntry[]>>({});

  const entries = cache[evalId] ?? null;

  const fetchIfNeeded = useCallback(async (id: number) => {
    setLoading(true);
    try {
      const data = await api.getCaseHistory(plugin, skill, id);
      setCache((prev) => ({ ...prev, [id]: data }));
    } catch {
      setCache((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setLoading(false);
    }
  }, [plugin, skill]);

  // Auto-fetch on mount when expanded by default
  useEffect(() => {
    if (expanded && !cache[evalId]) {
      fetchIfNeeded(evalId);
    }
  }, [evalId, plugin, skill]);

  const handleToggle = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next && !cache[evalId]) {
      fetchIfNeeded(evalId);
    }
  }, [expanded, evalId, cache, fetchIfNeeded]);

  const displayEntries = entries ? entries.slice(0, 10) : [];

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

              {/* History entries */}
              <div className="space-y-2">
                {displayEntries.map((entry, idx) => (
                  <div
                    key={idx}
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
                          background: entry.type === "benchmark" ? "rgba(99,131,255,0.15)" : entry.type === "comparison" ? "var(--purple-muted)" : "rgba(251,146,60,0.15)",
                          color: entry.type === "benchmark" ? "#6383ff" : entry.type === "comparison" ? "var(--purple)" : "#fb923c",
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
                ))}
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

  const nextId = Math.max(0, ...evals.evals.map((e) => e.id)) + 1;

  const handleSave = () => {
    if (!name.trim() || !prompt.trim()) return;
    const newCase: EvalCase = {
      id: nextId,
      name: name.trim(),
      prompt: prompt.trim(),
      expected_output: expected.trim(),
      files: [],
      assertions: assertions.filter((a) => a.text.trim()),
    };
    onSave({ ...evals, evals: [...evals.evals, newCase] });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-overlay-in" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div className="w-full max-w-lg rounded-xl p-6 animate-modal-in" style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}>
        <div className="text-[15px] font-semibold mb-4" style={{ color: "var(--text-primary)" }}>New Test Case</div>

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

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-secondary text-[12px]">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim() || !prompt.trim()} className="btn btn-primary text-[12px]">Save</button>
        </div>
      </div>
    </div>
  );
}
