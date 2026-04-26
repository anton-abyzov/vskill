// ---------------------------------------------------------------------------
// 0759 Phase 5 — PublishDrawer.
// 0759 Phase 9 — sleek redesign per frontend-design spec:
//   • Centered modal (flex container) instead of bottom-right drawer
//   • Backdrop dim + blur — modal is a hard interrupt, not an aside
//   • Two explicit modes: "Write yourself" | "Generate with AI" (segmented)
//     The previous version auto-fired AI generation on mount, which surprised
//     users who wanted to type their own message. Default is now manual; AI
//     runs ONLY when the user picks the AI mode (or hits Regenerate).
//   • Inline error block under the textarea — visible until dismissed,
//     not a transient toast that disappears before the user reads it
//   • Hairline borders, mono labels, restrained motion — matches the studio's
//     terminal-adjacent aesthetic without flashy gradients
//
// Click flow:
//   open → user picks mode → (AI mode: click Generate, see message, edit) →
//   Commit & Push → /api/git/publish → success: window.open verified-skill.com
//   + close drawer; failure: inline error block, drawer stays open.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { buildSubmitUrlFromRemote } from "../utils/normalizeRemoteUrl";

type Mode = "manual" | "ai";

function emitToast(message: string, severity: "info" | "error"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("studio:toast", { detail: { message, severity } }),
  );
}

interface Props {
  remoteUrl: string;
  fileCount: number;
  provider?: string;
  model?: string;
  onClose: () => void;
  /** Optional: open in AI mode instead of manual. Used by tests + future
   *  preference. Default = "manual" (user types their own message). */
  defaultMode?: Mode;
}

export function PublishDrawer({
  remoteUrl,
  fileCount,
  provider,
  model,
  onClose,
  defaultMode = "manual",
}: Props): React.ReactElement {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const result = await api.gitCommitMessage({ provider, model });
      setMessage(result.message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenerateError(msg);
    } finally {
      setGenerating(false);
    }
  }, [provider, model]);

  // Auto-fire generation only when the drawer opens directly in AI mode AND
  // there is no message yet (e.g. first mount). Manual mode never auto-fires.
  useEffect(() => {
    if (defaultMode === "ai" && !message) {
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchToAi = useCallback(() => {
    setMode("ai");
    setPublishError(null);
    if (!message.trim()) {
      generate();
    }
  }, [message, generate]);

  const switchToManual = useCallback(() => {
    setMode("manual");
    setGenerateError(null);
  }, []);

  const onCommitPush = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || publishing) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await api.gitPublish({ commitMessage: trimmed });
      const effectiveRemote = result.remoteUrl ?? remoteUrl;
      const submitUrl = buildSubmitUrlFromRemote(effectiveRemote);
      window.open(submitUrl, "_blank", "noopener,noreferrer");
      const shortSha = (result.commitSha ?? "").slice(0, 7);
      const branch = result.branch ?? "";
      emitToast(`Opening verified-skill.com — ${shortSha} on ${branch}`, "info");
      onClose();
    } catch (err) {
      const summary = err instanceof Error ? err.message : String(err);
      const capped = summary.length > 200 ? summary.slice(0, 200) + "…" : summary;
      // Inline-block error stays visible until the user retries — no transient toast.
      setPublishError(capped);
      // Toast is still emitted for accessibility / discoverability outside the modal.
      emitToast(`Publish failed: ${capped}`, "error");
    } finally {
      setPublishing(false);
    }
  }, [message, publishing, remoteUrl, onClose]);

  const canCommit = message.trim().length > 0 && !publishing && !generating;

  // ── style tokens ───────────────────────────────────────────────────────
  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-mono, monospace)",
    marginBottom: 6,
    display: "block",
  };

  const segmentBase: React.CSSProperties = {
    flex: 1,
    height: 30,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontSize: 11,
    fontFamily: "var(--font-mono, monospace)",
    background: "transparent",
    color: "var(--text-secondary)",
    border: "none",
    cursor: "pointer",
    transition: "background 120ms ease, color 120ms ease",
  };

  const segmentActive: React.CSSProperties = {
    ...segmentBase,
    background: "var(--bg-subtle)",
    color: "var(--text-primary)",
    fontWeight: 600,
  };

  return (
    <>
      {/* Backdrop — rgba dim + blur. Click to dismiss only when not in flight. */}
      <div
        aria-hidden="true"
        onClick={publishing ? undefined : onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.55)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          zIndex: 999,
          animation: "publishDrawerBackdropIn 150ms ease-out",
        }}
      />
      {/* Modal — centered via flex on a fixed inset:0 container, max-height 80vh. */}
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: 24,
          pointerEvents: "none", // panel re-enables; backdrop click handled above
        }}
      >
        <div
          role="dialog"
          aria-label="Publish"
          aria-modal="true"
          style={{
            pointerEvents: "auto",
            width: 520,
            maxWidth: "calc(100vw - 48px)",
            maxHeight: "80vh",
            overflowY: "auto",
            background: "var(--bg-elevated, #1a1a1a)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            padding: 24,
            boxShadow:
              "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono, monospace)",
            animation: "publishDrawerIn 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
        >
          {/* ── Header ───────────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
            <strong
              style={{
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--text-primary)",
                fontFamily: "var(--font-sans, var(--font-mono, sans-serif))",
              }}
            >
              Publish skill
            </strong>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={publishing ? undefined : onClose}
              disabled={publishing}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-tertiary)",
                fontSize: 18,
                lineHeight: 1,
                cursor: publishing ? "not-allowed" : "pointer",
                padding: 0,
                opacity: publishing ? 0.4 : 1,
              }}
            >
              ×
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--text-tertiary)",
              fontVariantNumeric: "tabular-nums",
              marginBottom: 18,
            }}
          >
            <span aria-hidden="true" style={{ color: "var(--color-accent)", fontFamily: "monospace" }}>▮</span>
            <span>
              {fileCount} file{fileCount === 1 ? "" : "s"} changed
            </span>
          </div>
          <div style={{ height: 1, background: "var(--border-subtle)", margin: "0 -24px 18px" }} />

          {/* ── Mode toggle (segmented) ────────────────────────────── */}
          <span style={labelStyle}>Mode</span>
          <div
            role="tablist"
            aria-label="Commit message mode"
            data-testid="publish-mode-toggle"
            style={{
              display: "flex",
              border: "1px solid var(--border-subtle)",
              borderRadius: 4,
              overflow: "hidden",
              marginBottom: 16,
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "manual"}
              data-testid="publish-mode-manual"
              onClick={switchToManual}
              disabled={publishing}
              style={mode === "manual" ? segmentActive : segmentBase}
            >
              Write yourself
            </button>
            <div style={{ width: 1, background: "var(--border-subtle)" }} />
            <button
              type="button"
              role="tab"
              aria-selected={mode === "ai"}
              data-testid="publish-mode-ai"
              onClick={switchToAi}
              disabled={publishing}
              style={mode === "ai" ? segmentActive : segmentBase}
            >
              {generating && mode === "ai" ? "Generating…" : "Generate with AI"}
            </button>
          </div>

          {/* ── Commit message field ──────────────────────────────── */}
          <label htmlFor="commit-message" style={labelStyle}>
            Commit message
          </label>
          <textarea
            id="commit-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            disabled={generating || publishing}
            placeholder={
              generating
                ? "Generating with AI…"
                : mode === "ai"
                  ? "Click Generate to draft a message"
                  : "Type your commit message…"
            }
            style={{
              width: "100%",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 4,
              padding: "10px 12px",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              lineHeight: 1.6,
              color: "var(--text-primary)",
              resize: "vertical",
              outline: "none",
            }}
          />

          {/* ── Inline error block (AI generation failure) ────────── */}
          {generateError && mode === "ai" && (
            <div
              role="alert"
              data-testid="publish-error-generate"
              style={{
                marginTop: 10,
                padding: "8px 12px",
                border: "1px solid oklch(65% 0.14 25 / 0.35)",
                background: "oklch(65% 0.14 25 / 0.06)",
                borderRadius: 4,
                fontSize: 11,
                color: "oklch(70% 0.14 25)",
                fontFamily: "var(--font-mono, monospace)",
                lineHeight: 1.5,
              }}
            >
              <strong style={{ fontWeight: 600 }}>AI generation failed.</strong>{" "}
              {generateError}{" "}
              <button
                type="button"
                onClick={generate}
                disabled={generating}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-accent)",
                  cursor: generating ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  textDecoration: "underline",
                  padding: 0,
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* ── Inline error block (publish/push failure) ────────── */}
          {publishError && (
            <div
              role="alert"
              data-testid="publish-error-push"
              style={{
                marginTop: 10,
                padding: "8px 12px",
                border: "1px solid oklch(65% 0.14 25 / 0.35)",
                background: "oklch(65% 0.14 25 / 0.06)",
                borderRadius: 4,
                fontSize: 11,
                color: "oklch(70% 0.14 25)",
                fontFamily: "var(--font-mono, monospace)",
                lineHeight: 1.5,
              }}
            >
              <strong style={{ fontWeight: 600 }}>Publish failed.</strong> {publishError}
            </div>
          )}

          {/* ── Footer row ────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 18,
              gap: 6,
            }}
          >
            {/* Left: Regenerate (AI mode only). Hidden in manual to avoid a
                button that does nothing relevant. */}
            <div style={{ minHeight: 28 }}>
              {mode === "ai" && (
                <button
                  type="button"
                  aria-label="Regenerate"
                  onClick={generate}
                  disabled={generating || publishing}
                  className="btn btn-ghost text-[11px]"
                  style={{ padding: "4px 10px" }}
                >
                  {generating ? "Generating…" : "Regenerate"}
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                aria-label="Cancel"
                onClick={onClose}
                disabled={publishing}
                className="btn btn-ghost text-[11px]"
                style={{ padding: "4px 10px" }}
              >
                Cancel
              </button>
              <button
                type="button"
                aria-label="Commit & Push"
                onClick={onCommitPush}
                disabled={!canCommit}
                className="btn btn-primary text-[11px]"
                style={{ padding: "5px 14px" }}
              >
                {publishing ? "Publishing…" : "Commit & Push"}
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Inline keyframes — declared once per mount; styled-system surface
          uses CSS-in-JS rather than a global stylesheet on this codebase. */}
      <style>{`
        @keyframes publishDrawerBackdropIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes publishDrawerIn {
          from { opacity: 0; transform: translateY(4px) }
          to { opacity: 1; transform: translateY(0) }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="dialog"][aria-label="Publish"],
          [role="dialog"][aria-label="Publish"] + * { animation: none !important }
        }
      `}</style>
    </>
  );
}
