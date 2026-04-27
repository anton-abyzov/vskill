// ---------------------------------------------------------------------------
// 0793 — Convert standalone skills into a Claude Code plugin.
//
// Triggered from the AUTHORING > Skills sidebar group header (or the
// AUTHORING > Plugins empty-state) when 2+ standalone skills share a parent
// directory. POSTs to /api/authoring/convert-to-plugin which writes
// <parent>/.claude-plugin/plugin.json and runs `claude plugin validate`. On
// success the caller refreshes /api/skills and the affected skills flip from
// scopeV2 'authoring-project' to 'authoring-plugin' automatically (the
// existing dedupeByDir precedence handles that transition).
// ---------------------------------------------------------------------------

import * as React from "react";
import { api, ApiError } from "../api";

const KEBAB = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;

export interface ConvertToPluginDialogProps {
  /** Absolute path of one skill in the candidate group; server derives pluginDir. */
  anchorSkillDir: string;
  /** Display label for the candidate (e.g. parent folder basename). */
  candidateLabel: string;
  /** Initial values prefilled into the form. */
  initialName: string;
  initialDescription?: string;
  /**
   * Called once the manifest is written and the user closes the dialog.
   * `validation` is forwarded so the caller can surface a parity warning when
   * the server soft-skipped schema validation (matches the CLI sibling, which
   * prints a yellow "claude CLI not found on PATH" line — see plugin.ts:153).
   */
  onConverted: (result: {
    pluginDir: string;
    manifestPath: string;
    validation: "passed" | "skipped";
  }) => void;
  /** Called when the user cancels without converting. */
  onCancel: () => void;
}

export function ConvertToPluginDialog({
  anchorSkillDir,
  candidateLabel,
  initialName,
  initialDescription,
  onConverted,
  onCancel,
}: ConvertToPluginDialogProps): React.ReactElement {
  const [pluginName, setPluginName] = React.useState(initialName);
  const [description, setDescription] = React.useState(initialDescription ?? "");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stderr, setStderr] = React.useState<string | null>(null);

  const nameValid = KEBAB.test(pluginName);
  const submitDisabled = submitting || !nameValid;

  const onSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitDisabled) return;
      setSubmitting(true);
      setError(null);
      setStderr(null);
      try {
        const result = await api.convertToPlugin({
          anchorSkillDir,
          pluginName: pluginName.trim(),
          description: description.trim(),
        });
        // F-002 (0793 review iteration 2): forward `validation` to the caller
        // so a "skipped" outcome can be surfaced (CLI does this with a yellow
        // warning line; the dialog's caller is responsible for the UI parity).
        onConverted({
          pluginDir: result.pluginDir,
          manifestPath: result.manifestPath,
          validation: result.validation,
        });
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
          // 0793 T-004: validation-failed responses include `stderr` from
          // `claude plugin validate`. Show it inline so the user sees what
          // Claude Code rejected.
          const details = err.details;
          if (details && typeof details.stderr === "string") {
            setStderr(details.stderr);
          }
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
        setSubmitting(false);
      }
    },
    [submitDisabled, anchorSkillDir, pluginName, description, onConverted],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vskill-convert-dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          background: "var(--bg-primary, #fff)",
          color: "var(--text-primary, #111)",
          borderRadius: 8,
          padding: 20,
          width: "min(540px, 92vw)",
          boxShadow: "0 12px 48px rgba(0,0,0,0.25)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <h2
          id="vskill-convert-dialog-title"
          style={{ margin: 0, fontSize: 16, fontWeight: 600 }}
        >
          Convert <span style={{ fontFamily: "var(--font-mono)" }}>{candidateLabel}/</span> to a plugin
        </h2>
        <p style={{ marginTop: 8, marginBottom: 16, fontSize: 13, color: "var(--text-secondary)" }}>
          Writes <span style={{ fontFamily: "var(--font-mono)" }}>.claude-plugin/plugin.json</span> into
          this folder and validates it via <span style={{ fontFamily: "var(--font-mono)" }}>claude plugin validate</span>.
          The skills already on disk will appear nested under the new plugin.
        </p>

        <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
          Plugin name
        </label>
        <input
          type="text"
          value={pluginName}
          onChange={(e) => setPluginName(e.target.value)}
          disabled={submitting}
          autoFocus
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            boxSizing: "border-box",
            border: "1px solid var(--border-subtle)",
            borderRadius: 4,
          }}
        />
        {!nameValid && (
          <div style={{ fontSize: 11, color: "var(--color-error, #c00)", marginTop: 4 }}>
            Must be kebab-case (lowercase letters, digits, hyphens; 2–64 chars).
          </div>
        )}

        <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginTop: 12, marginBottom: 4 }}>
          Description
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 13,
            boxSizing: "border-box",
            border: "1px solid var(--border-subtle)",
            borderRadius: 4,
          }}
        />

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: 8,
              fontSize: 12,
              background: "var(--color-error-bg, #fee)",
              color: "var(--color-error, #c00)",
              borderRadius: 4,
            }}
          >
            <div style={{ fontWeight: 500 }}>{error}</div>
            {stderr && (
              <pre
                style={{
                  marginTop: 6,
                  padding: 6,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  whiteSpace: "pre-wrap",
                  background: "rgba(0,0,0,0.04)",
                  borderRadius: 3,
                  maxHeight: 160,
                  overflow: "auto",
                }}
              >
                {stderr}
              </pre>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              background: "transparent",
              border: "1px solid var(--border-subtle)",
              borderRadius: 4,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitDisabled}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              background: "var(--color-accent, #2b6cb0)",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: submitDisabled ? "not-allowed" : "pointer",
              opacity: submitDisabled ? 0.5 : 1,
            }}
          >
            {submitting ? "Converting…" : "Convert"}
          </button>
        </div>
      </form>
    </div>
  );
}
