import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";
import { useSSE } from "../sse";
import type { EvalsFile, EvalCase, Assertion } from "../types";

interface AssertionResult {
  assertion_id: string;
  text: string;
  pass: boolean;
  reasoning: string;
}

interface InlineResult {
  status?: string;
  passRate?: number;
  errorMessage?: string;
  durationMs?: number;
  tokens?: number | null;
  output?: string;
  assertions: AssertionResult[];
}

export function SkillDetailPage() {
  const { plugin, skill } = useParams<{ plugin: string; skill: string }>();
  const [evals, setEvals] = useState<EvalsFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingCase, setEditingCase] = useState<EvalCase | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { events, running: sseRunning, start: sseStart } = useSSE();
  const [runningEvalId, setRunningEvalId] = useState<number | null>(null);
  const [inlineResults, setInlineResults] = useState<Map<number, InlineResult>>(new Map());
  const [expandedInline, setExpandedInline] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!plugin || !skill) return;
    api.getEvals(plugin, skill).then(setEvals).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [plugin, skill]);

  async function save(updated: EvalsFile) {
    if (!plugin || !skill) return;
    setSaving(true);
    try {
      const saved = await api.saveEvals(plugin, skill, updated);
      setEvals(saved);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function addCase(newCase: EvalCase) {
    if (!evals) return;
    save({ ...evals, evals: [...evals.evals, newCase] });
    setShowForm(false);
  }

  function updateCase(updated: EvalCase) {
    if (!evals) return;
    save({ ...evals, evals: evals.evals.map((e) => (e.id === updated.id ? updated : e)) });
    setEditingCase(null);
  }

  function deleteCase(id: number) {
    if (!evals || !confirm("Delete this eval case?")) return;
    save({ ...evals, evals: evals.evals.filter((e) => e.id !== id) });
  }

  function addAssertion(caseId: number) {
    if (!evals) return;
    const evalCase = evals.evals.find((e) => e.id === caseId);
    if (!evalCase) return;
    updateCase({
      ...evalCase,
      assertions: [...evalCase.assertions, { id: `assert-${Date.now()}`, text: "New assertion", type: "boolean" as const }],
    });
  }

  function updateAssertion(caseId: number, assertionId: string, text: string) {
    if (!evals) return;
    const evalCase = evals.evals.find((e) => e.id === caseId);
    if (!evalCase) return;
    updateCase({
      ...evalCase,
      assertions: evalCase.assertions.map((a) => (a.id === assertionId ? { ...a, text } : a)),
    });
  }

  function deleteAssertion(caseId: number, assertionId: string) {
    if (!evals) return;
    const evalCase = evals.evals.find((e) => e.id === caseId);
    if (!evalCase) return;
    updateCase({
      ...evalCase,
      assertions: evalCase.assertions.filter((a) => a.id !== assertionId),
    });
  }

  // Process SSE events into inline results
  useEffect(() => {
    if (!runningEvalId) return;
    const result: InlineResult = { assertions: [] };
    for (const evt of events) {
      if (evt.event === "output_ready") {
        const d = evt.data as { eval_id: number; output: string; durationMs?: number; tokens?: number | null };
        if (d.eval_id === runningEvalId) {
          result.output = d.output;
          if (d.durationMs != null) result.durationMs = d.durationMs;
          if (d.tokens != null) result.tokens = d.tokens;
        }
      }
      if (evt.event === "assertion_result") {
        const d = evt.data as AssertionResult & { eval_id: number };
        if (d.eval_id === runningEvalId && !result.assertions.find((a) => a.assertion_id === d.assertion_id)) {
          result.assertions.push(d);
        }
      }
      if (evt.event === "case_complete") {
        const d = evt.data as { eval_id: number; status: string; pass_rate?: number; error_message?: string };
        if (d.eval_id === runningEvalId) {
          result.status = d.status;
          result.passRate = d.pass_rate;
          result.errorMessage = d.error_message || undefined;
        }
      }
    }
    setInlineResults((prev) => new Map(prev).set(runningEvalId, result));
  }, [events, runningEvalId]);

  // Clear running state when SSE finishes
  useEffect(() => {
    if (!sseRunning && runningEvalId) setRunningEvalId(null);
  }, [sseRunning, runningEvalId]);

  function runSingleBenchmark(evalId: number) {
    setRunningEvalId(evalId);
    setExpandedInline((prev) => new Set(prev).add(evalId));
    sseStart(`/api/skills/${plugin}/${skill}/benchmark`, { eval_ids: [evalId] });
  }

  function toggleInlineExpand(evalId: number) {
    setExpandedInline((prev) => {
      const next = new Set(prev);
      next.has(evalId) ? next.delete(evalId) : next.add(evalId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="px-10 py-8 max-w-5xl">
        <div className="skeleton h-5 w-48 mb-6" />
        <div className="flex gap-2 mb-6"><div className="skeleton h-9 w-32 rounded-lg" /><div className="skeleton h-9 w-32 rounded-lg" /></div>
        <div className="space-y-4">
          <div className="skeleton h-32 rounded-xl" />
          <div className="skeleton h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-10 py-8 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-1 text-[13px]">
        <Link to="/" className="transition-colors duration-150" style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
        >
          Skills
        </Link>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        <span style={{ color: "var(--text-tertiary)" }}>{plugin}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{skill}</span>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 mt-4 mb-7">
        <Link to={`/skills/${plugin}/${skill}/benchmark`} className="btn btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
          Run Benchmark
        </Link>
        <Link to={`/skills/${plugin}/${skill}/compare`} className="btn btn-purple">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5" /><path d="M8 21H3v-5" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg>
          Compare A/B
        </Link>
        <Link to={`/skills/${plugin}/${skill}/history`} className="btn btn-secondary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          History
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
          {error}
        </div>
      )}

      {/* Eval cases */}
      {evals ? (
        <div className="space-y-3 stagger-children">
          {evals.evals.map((evalCase) => (
            <div key={evalCase.id} className="glass-card p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>
                      #{evalCase.id}
                    </span>
                    <h4 className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>{evalCase.name}</h4>
                  </div>
                  <p className="text-[12px] mt-1.5 line-clamp-2" style={{ color: "var(--text-tertiary)" }}>{evalCase.prompt}</p>
                </div>
                <div className="flex gap-1 ml-3">
                  <button
                    onClick={() => runSingleBenchmark(evalCase.id)}
                    disabled={sseRunning}
                    className="btn btn-ghost text-[12px] flex-shrink-0"
                    style={{ color: "var(--accent)" }}
                  >
                    {runningEvalId === evalCase.id ? (
                      <><div className="spinner" style={{ width: 12, height: 12 }} /> Running...</>
                    ) : (
                      <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg> Run</>
                    )}
                  </button>
                  <button onClick={() => { setEditingCase(evalCase); setShowForm(true); }} className="btn btn-ghost text-[12px]">Edit</button>
                  <button onClick={() => deleteCase(evalCase.id)} className="btn btn-danger text-[12px]">Delete</button>
                </div>
              </div>

              {/* Assertions */}
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                    Assertions
                  </span>
                  <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)", fontSize: "10px", padding: "1px 7px" }}>
                    {evalCase.assertions.length}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {evalCase.assertions.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 group">
                      <span className="text-[11px] font-mono w-28 truncate flex-shrink-0" style={{ color: "var(--text-tertiary)" }}>{a.id}</span>
                      <input
                        className="input-field flex-1 text-[12px] py-1.5"
                        style={{ background: "transparent", border: "1px solid transparent", borderRadius: "6px" }}
                        value={a.text}
                        onChange={(e) => updateAssertion(evalCase.id, a.id, e.target.value)}
                        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.background = "var(--surface-2)"; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "transparent"; }}
                      />
                      <button
                        onClick={() => deleteAssertion(evalCase.id, a.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-1 rounded"
                        style={{ color: "var(--red)" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={() => addAssertion(evalCase.id)} className="btn btn-ghost text-[12px] mt-2" style={{ color: "var(--accent)" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add assertion
                </button>
              </div>

              {/* Inline benchmark results */}
              {(() => {
                const ir = inlineResults.get(evalCase.id);
                if (!ir || (ir.assertions.length === 0 && !ir.status)) return null;
                const isExpanded = expandedInline.has(evalCase.id);
                return (
                  <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                          Benchmark Result
                        </span>
                        {ir.durationMs != null && (
                          <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>
                            {(ir.durationMs / 1000).toFixed(1)}s
                          </span>
                        )}
                        {ir.tokens != null && (
                          <span className="text-[11px] font-mono" style={{ color: "var(--text-tertiary)" }}>
                            {ir.tokens.toLocaleString()} tok
                          </span>
                        )}
                      </div>
                      {ir.status ? (
                        <span
                          className="pill"
                          style={{
                            background: ir.status === "pass" ? "var(--green-muted)" : ir.status === "error" ? "var(--yellow-muted)" : "var(--red-muted)",
                            color: ir.status === "pass" ? "var(--green)" : ir.status === "error" ? "var(--yellow)" : "var(--red)",
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{
                            background: ir.status === "pass" ? "var(--green)" : ir.status === "error" ? "var(--yellow)" : "var(--red)"
                          }} />
                          {ir.status} {ir.passRate !== undefined ? `${Math.round(ir.passRate * 100)}%` : ""}
                        </span>
                      ) : (
                        <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--accent)" }}>
                          <div className="spinner" style={{ width: 12, height: 12 }} />
                          Evaluating...
                        </div>
                      )}
                    </div>

                    {ir.errorMessage && (
                      <div className="mb-2 p-2 rounded-lg text-[12px]" style={{ background: "var(--red-muted)", color: "var(--red)" }}>
                        {ir.errorMessage}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      {ir.assertions.map((a) => (
                        <div
                          key={a.assertion_id}
                          className="flex items-start gap-2 p-2 rounded-lg animate-fade-in"
                          style={{ background: a.pass ? "var(--green-muted)" : "var(--red-muted)" }}
                        >
                          <div
                            className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{ background: a.pass ? "var(--green)" : "var(--red)" }}
                          >
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              {a.pass ? <polyline points="20 6 9 17 4 12" /> : <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>}
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{a.text || a.assertion_id}</div>
                            <div className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{a.reasoning}</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {ir.output && (
                      <>
                        <button
                          onClick={() => toggleInlineExpand(evalCase.id)}
                          className="mt-2 flex items-center gap-1.5 text-[11px] font-medium transition-colors duration-150"
                          style={{ color: "var(--text-tertiary)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
                        >
                          <svg
                            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                            style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s ease" }}
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                          {isExpanded ? "Hide Output" : "Show LLM Output"}
                        </button>
                        {isExpanded && (
                          <div
                            className="mt-2 text-[11px] leading-relaxed p-3 rounded-lg max-h-48 overflow-y-auto whitespace-pre-wrap animate-fade-in"
                            style={{ background: "var(--surface-1)", color: "var(--text-secondary)", fontFamily: "var(--font-mono, monospace)" }}
                          >
                            {ir.output}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}

          {/* Add case */}
          <button
            onClick={() => { setEditingCase(null); setShowForm(true); }}
            className="w-full p-4 rounded-xl text-[13px] font-medium transition-all duration-150"
            style={{
              border: "2px dashed var(--border-default)",
              color: "var(--text-tertiary)",
              background: "transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.background = "var(--accent-muted)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-default)";
              e.currentTarget.style.color = "var(--text-tertiary)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            + Add Eval Case
          </button>
        </div>
      ) : (
        <div className="text-center py-16 animate-fade-in-scale">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "var(--surface-2)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
          </div>
          <p className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>No evals.json found</p>
          <button onClick={() => setShowForm(true)} className="btn btn-primary mt-3">Create evals.json</button>
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <EvalCaseFormModal
          evalCase={editingCase}
          skillName={evals?.skill_name || skill || ""}
          existingIds={evals?.evals.map((e) => e.id) || []}
          onSave={(c) => editingCase ? updateCase(c) : addCase(c)}
          onCancel={() => { setShowForm(false); setEditingCase(null); }}
        />
      )}

      {/* Save toast */}
      {saving && (
        <div className="fixed bottom-5 right-5 flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] animate-fade-in-scale"
          style={{ background: "var(--accent)", color: "#fff", boxShadow: "0 8px 32px rgba(99,131,255,0.3)" }}>
          <div className="spinner" style={{ borderTopColor: "#fff", borderColor: "rgba(255,255,255,0.2)" }} />
          Saving...
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                              */
/* ------------------------------------------------------------------ */
function EvalCaseFormModal({
  evalCase,
  skillName,
  existingIds,
  onSave,
  onCancel,
}: {
  evalCase: EvalCase | null;
  skillName: string;
  existingIds: number[];
  onSave: (c: EvalCase) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(evalCase?.name || "");
  const [prompt, setPrompt] = useState(evalCase?.prompt || "");
  const [expectedOutput, setExpectedOutput] = useState(evalCase?.expected_output || "");
  const [assertions, setAssertions] = useState<Assertion[]>(
    evalCase?.assertions || [{ id: "assert-1", text: "", type: "boolean" }],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = evalCase?.id ?? (existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1);
    onSave({
      id,
      name,
      prompt,
      expected_output: expectedOutput,
      files: evalCase?.files || [],
      assertions: assertions.filter((a) => a.text.trim()),
    });
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 animate-overlay-in" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
      <form
        onSubmit={handleSubmit}
        className="glass-card p-6 w-full max-w-2xl max-h-[85vh] overflow-auto animate-modal-in"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border-default)" }}
      >
        <h3 className="text-[16px] font-semibold mb-5" style={{ color: "var(--text-primary)" }}>
          {evalCase ? "Edit Eval Case" : "New Eval Case"}
        </h3>

        <label className="block mb-4">
          <span className="text-[12px] font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Name</span>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. basic-test-question" />
        </label>

        <label className="block mb-4">
          <span className="text-[12px] font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Prompt</span>
          <textarea className="input-field h-24 resize-y" value={prompt} onChange={(e) => setPrompt(e.target.value)} required placeholder="The user prompt to test against..." />
        </label>

        <label className="block mb-4">
          <span className="text-[12px] font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Expected Output</span>
          <textarea className="input-field h-20 resize-y" value={expectedOutput} onChange={(e) => setExpectedOutput(e.target.value)} placeholder="What a good answer should include..." />
        </label>

        <div className="mb-5">
          <span className="text-[12px] font-medium mb-2 block" style={{ color: "var(--text-secondary)" }}>Assertions</span>
          {assertions.map((a, i) => (
            <div key={i} className="flex gap-2 mt-1.5">
              <input
                className="input-field w-32 text-[12px] font-mono"
                value={a.id}
                onChange={(e) => { const u = [...assertions]; u[i] = { ...u[i], id: e.target.value }; setAssertions(u); }}
                placeholder="ID"
              />
              <input
                className="input-field flex-1 text-[12px]"
                value={a.text}
                onChange={(e) => { const u = [...assertions]; u[i] = { ...u[i], text: e.target.value }; setAssertions(u); }}
                placeholder="Assertion text"
              />
              <button type="button" onClick={() => setAssertions(assertions.filter((_, j) => j !== i))} className="btn btn-ghost p-1.5" style={{ color: "var(--red)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setAssertions([...assertions, { id: `assert-${assertions.length + 1}`, text: "", type: "boolean" }])} className="btn btn-ghost text-[12px] mt-2" style={{ color: "var(--accent)" }}>
            + Add assertion
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <button type="button" onClick={onCancel} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  );
}
