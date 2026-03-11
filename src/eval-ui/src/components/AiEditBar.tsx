import { useState, useRef, useEffect, useCallback } from "react";
import { useWorkspace } from "../pages/workspace/WorkspaceContext";
import { api } from "../api";
import type { ConfigResponse, ProviderInfo } from "../api";
import { computeDiff } from "../utils/diff";
import type { DiffLine } from "../utils/diff";

export function AiEditBar() {
  const { state, dispatch, submitAiEdit, applyAiEdit, discardAiEdit } = useWorkspace();
  const { aiEditLoading, aiEditResult, aiEditError } = state;

  const [instruction, setInstruction] = useState("");
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [selectedProvider, setSelectedProvider] = useState("claude-cli");
  const [selectedModel, setSelectedModel] = useState("opus");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Load provider config
  useEffect(() => {
    api.getConfig().then((c) => {
      setConfig(c);
      const hasCli = c.providers.find((p) => p.id === "claude-cli" && p.available);
      if (hasCli) {
        setSelectedProvider("claude-cli");
        setSelectedModel("opus");
      }
    }).catch(() => {});
  }, []);

  const provider = config?.providers.find((p) => p.id === selectedProvider && p.available);

  const handleSubmit = useCallback(() => {
    const trimmed = instruction.trim();
    if (!trimmed || aiEditLoading) return;
    submitAiEdit(trimmed);
  }, [instruction, aiEditLoading, submitAiEdit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      discardAiEdit();
    }
  }, [handleSubmit, discardAiEdit]);

  const handleTryAgain = useCallback(() => {
    // Reset result but keep bar open for re-submit
    dispatch({ type: "CLOSE_AI_EDIT" });
    dispatch({ type: "OPEN_AI_EDIT" });
  }, [dispatch]);

  // Compute diff when result is available
  const diffLines: DiffLine[] = aiEditResult
    ? computeDiff(state.skillContent, aiEditResult.improved)
    : [];

  return (
    <div
      className="animate-fade-in"
      style={{ background: "var(--surface-1)", borderTop: "1px solid var(--border-subtle)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-2)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: "rgba(168,85,247,0.15)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" />
              <path d="M17.8 11.8L19 13" /><path d="M15 9h.01" />
              <path d="M17.8 6.2L19 5" /><path d="M11 6.2L9.7 5" />
              <path d="M3 21l9-9" />
            </svg>
          </div>
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
            AI Edit
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            Describe what to change — Enter to submit, Esc to dismiss
          </span>
        </div>
        <button
          onClick={discardAiEdit}
          className="w-6 h-6 rounded-md flex items-center justify-center transition-colors duration-150"
          style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-3">
        {/* Instruction input + model picker + submit */}
        {!aiEditResult && (
          <div className="flex items-end gap-2.5">
            <div className="flex-1">
              <textarea
                ref={textareaRef}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g., Add an error handling section..."
                disabled={aiEditLoading}
                rows={1}
                className="w-full resize-none outline-none"
                style={{
                  background: "var(--surface-0)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
                  minHeight: 36,
                  maxHeight: 96,
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 96) + "px";
                }}
              />
            </div>
            <div style={{ minWidth: 100 }}>
              <label className="text-[10px] font-medium mb-0.5 block" style={{ color: "var(--text-tertiary)" }}>Provider</label>
              <select
                className="input-field text-[11px] py-1"
                value={selectedProvider}
                onChange={(e) => {
                  setSelectedProvider(e.target.value);
                  const p = config?.providers.find((p) => p.id === e.target.value);
                  if (p?.models[0]) setSelectedModel(p.models[0].id);
                }}
                disabled={aiEditLoading}
                style={{ width: "100%" }}
              >
                {config?.providers.filter((p) => p.available).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: 80 }}>
              <label className="text-[10px] font-medium mb-0.5 block" style={{ color: "var(--text-tertiary)" }}>Model</label>
              <select
                className="input-field text-[11px] py-1"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={aiEditLoading}
                style={{ width: "100%" }}
              >
                {provider?.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleSubmit}
              disabled={aiEditLoading || !instruction.trim()}
              className="btn btn-primary flex-shrink-0 text-[11px]"
              style={{ padding: "6px 14px" }}
            >
              {aiEditLoading ? (
                <><div className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> Editing...</>
              ) : (
                "Submit"
              )}
            </button>
          </div>
        )}

        {/* Error */}
        {aiEditError && (
          <div className="mt-3 px-3 py-2.5 rounded-lg text-[12px]" style={{ background: "var(--red-muted)", color: "var(--red)" }}>
            {aiEditError}
          </div>
        )}

        {/* Diff result */}
        {aiEditResult && (
          <div className="animate-fade-in">
            {/* Reasoning */}
            {aiEditResult.reasoning && (
              <div
                className="mb-3 px-3 py-2.5 rounded-lg text-[11.5px]"
                style={{
                  background: "rgba(168,85,247,0.08)",
                  color: "var(--text-secondary)",
                  border: "1px solid rgba(168,85,247,0.2)",
                }}
              >
                <span className="font-semibold" style={{ color: "#a855f7" }}>AI Reasoning: </span>
                {aiEditResult.reasoning}
              </div>
            )}

            {/* Diff lines */}
            <div
              className="rounded-lg overflow-hidden mb-3"
              style={{ border: "1px solid var(--border-subtle)", maxHeight: 300, overflowY: "auto" }}
            >
              {diffLines.map((line, i) => (
                <div
                  key={i}
                  className="px-3 py-0.5 text-[10.5px] font-mono"
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
                onClick={applyAiEdit}
                className="btn btn-primary text-[11px]"
                style={{ padding: "5px 12px" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Apply
              </button>
              <button
                onClick={discardAiEdit}
                className="btn btn-secondary text-[11px]"
                style={{ padding: "5px 12px" }}
              >
                Discard
              </button>
              <button
                onClick={handleTryAgain}
                className="btn btn-ghost text-[11px]"
                style={{ padding: "5px 12px" }}
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
