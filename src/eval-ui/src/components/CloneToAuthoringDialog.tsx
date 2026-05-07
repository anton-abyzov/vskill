// ---------------------------------------------------------------------------
// 0828 — Clone an installed skill into the authoring scope from Skill Studio.
//
// Three target shapes mirroring the `vskill clone` CLI:
//   "standalone"  → <root>/skills/<name>-fork (default)
//   "plugin"      → <existing-plugin-root>/skills/<name>
//   "new-plugin"  → <root>/<plugin-name>/skills/<name> (scaffolds the plugin)
//
// Triggered via the `studio:request-clone` window event (see
// useContextMenuState — the "clone" action dispatches it; App.tsx renders
// this dialog when the event fires). On success: dispatches
// `studio:skills-changed` so the sidebar rescans and the new authoring skill
// appears without a page reload.
// ---------------------------------------------------------------------------

import * as React from "react";
import type { SkillInfo } from "../types";

const KEBAB = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;

export type CloneTarget = "standalone" | "plugin" | "new-plugin";

export interface CloneToAuthoringDialogProps {
  /** Skill the user invoked "Clone to authoring…" on. */
  skill: SkillInfo;
  /** Called once the API responds 200 with ok:true. */
  onCloned: (result: { target: string; files: number | null }) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

interface FormState {
  target: CloneTarget;
  plugin: string;
  pluginName: string;
}

export function CloneToAuthoringDialog(props: CloneToAuthoringDialogProps): React.ReactElement {
  const { skill, onCloned, onCancel } = props;
  const [form, setForm] = React.useState<FormState>({
    target: "standalone",
    plugin: "",
    pluginName: "",
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);

  // Default focus → Cancel (the safer choice). Restore focus on close.
  React.useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    requestAnimationFrame(() => cancelRef.current?.focus());
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, []);

  // Escape closes.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submitDisabled = submitting
    || (form.target === "plugin" && !form.plugin.trim())
    || (form.target === "new-plugin" && !KEBAB.test(form.pluginName.trim()));

  const onSubmit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitDisabled) return;
      setSubmitting(true);
      setError(null);
      try {
        const body: Record<string, unknown> = {
          source: skill.skill,
          sourcePlugin: skill.plugin,
          target: form.target,
        };
        if (form.target === "plugin") body.plugin = form.plugin.trim();
        if (form.target === "new-plugin") body.pluginName = form.pluginName.trim();

        const resp = await fetch("/api/skills/clone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await resp.json().catch(() => ({}))) as {
          ok?: boolean; target?: string; files?: number | null;
          error?: string; message?: string;
        };
        if (!resp.ok || !data.ok) {
          setError(data.message || data.error || `HTTP ${resp.status}`);
          return;
        }
        onCloned({ target: data.target ?? "", files: data.files ?? null });
      } catch (err) {
        setError((err as Error).message ?? "Network error");
      } finally {
        setSubmitting(false);
      }
    },
    [submitDisabled, form, skill, onCloned],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clone-dialog-title"
      ref={dialogRef}
      data-testid="clone-to-authoring-dialog"
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form onSubmit={onSubmit} style={dialogStyle}>
        <h2 id="clone-dialog-title" style={titleStyle}>
          Clone to authoring
        </h2>
        <p style={bodyStyle}>
          Fork <code style={codeStyle}>{skill.skill}</code> into the authoring scope so you can edit it.
        </p>

        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>Target</legend>

          <label style={radioRowStyle}>
            <input
              type="radio"
              name="target"
              value="standalone"
              checked={form.target === "standalone"}
              onChange={() => setForm((f) => ({ ...f, target: "standalone" }))}
              data-testid="clone-target-standalone"
            />
            <span style={radioLabelStyle}>
              <strong>Standalone</strong>
              <span style={radioHintStyle}>
                Lands at <code style={codeStyle}>skills/{skill.skill}-fork/</code>
              </span>
            </span>
          </label>

          <label style={radioRowStyle}>
            <input
              type="radio"
              name="target"
              value="plugin"
              checked={form.target === "plugin"}
              onChange={() => setForm((f) => ({ ...f, target: "plugin" }))}
              data-testid="clone-target-plugin"
            />
            <span style={radioLabelStyle}>
              <strong>Add to existing plugin</strong>
              <span style={radioHintStyle}>Lands inside a plugin you already author.</span>
            </span>
          </label>
          {form.target === "plugin" && (
            <input
              type="text"
              placeholder="plugin name or path"
              value={form.plugin}
              onChange={(e) => setForm((f) => ({ ...f, plugin: e.target.value }))}
              data-testid="clone-plugin-input"
              autoFocus
              style={inputStyle}
            />
          )}

          <label style={radioRowStyle}>
            <input
              type="radio"
              name="target"
              value="new-plugin"
              checked={form.target === "new-plugin"}
              onChange={() => setForm((f) => ({ ...f, target: "new-plugin" }))}
              data-testid="clone-target-new-plugin"
            />
            <span style={radioLabelStyle}>
              <strong>Create new plugin</strong>
              <span style={radioHintStyle}>Scaffolds a fresh plugin folder with this skill inside.</span>
            </span>
          </label>
          {form.target === "new-plugin" && (
            <input
              type="text"
              placeholder="plugin-name (kebab-case)"
              value={form.pluginName}
              onChange={(e) => setForm((f) => ({ ...f, pluginName: e.target.value }))}
              data-testid="clone-new-plugin-name-input"
              autoFocus
              style={inputStyle}
            />
          )}
        </fieldset>

        {error && (
          <div role="alert" style={errorStyle} data-testid="clone-error">
            {error}
          </div>
        )}

        <div style={actionsStyle}>
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            disabled={submitting}
            style={btnSecondaryStyle}
            data-testid="clone-cancel"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitDisabled}
            style={btnPrimaryStyle}
            data-testid="clone-submit"
          >
            {submitting ? "Cloning…" : "Clone"}
          </button>
        </div>
      </form>
    </div>
  );
}

// --- inline styles (matches the lightweight pattern used by ConvertToPluginDialog) ---
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const dialogStyle: React.CSSProperties = {
  background: "var(--bg, #fff)", color: "var(--text, #111)",
  borderRadius: 12, padding: "24px 28px", minWidth: 460, maxWidth: 560,
  boxShadow: "0 24px 60px rgba(0,0,0,0.5)", border: "1px solid var(--border, rgba(0,0,0,0.10))",
};
const titleStyle: React.CSSProperties = { fontSize: 18, fontWeight: 700, margin: 0 };
const bodyStyle: React.CSSProperties = { margin: "12px 0 18px", fontSize: 14, color: "var(--text-muted, #555)" };
const fieldsetStyle: React.CSSProperties = { border: "none", padding: 0, margin: "0 0 16px" };
const legendStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.2, color: "var(--text-muted, #555)", padding: 0, marginBottom: 10 };
const radioRowStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 4px", cursor: "pointer", borderRadius: 6 };
const radioLabelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, fontSize: 14 };
const radioHintStyle: React.CSSProperties = { fontSize: 12, color: "var(--text-muted, #777)" };
const inputStyle: React.CSSProperties = { display: "block", width: "100%", padding: "8px 12px", margin: "4px 0 8px 28px", maxWidth: 380, fontSize: 14, borderRadius: 6, border: "1px solid var(--border, rgba(0,0,0,0.20))", background: "var(--bg, #fff)", color: "var(--text, #111)", fontFamily: "var(--font-geist-mono, monospace)" };
const codeStyle: React.CSSProperties = { fontFamily: "var(--font-geist-mono, monospace)", fontSize: 13, padding: "1px 6px", borderRadius: 4, background: "rgba(127,127,127,0.12)" };
const errorStyle: React.CSSProperties = { fontSize: 13, color: "#c62828", background: "rgba(198,40,40,0.10)", border: "1px solid rgba(198,40,40,0.40)", padding: "8px 12px", borderRadius: 6, margin: "0 0 12px" };
const actionsStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 };
const btnSecondaryStyle: React.CSSProperties = { padding: "8px 16px", borderRadius: 6, border: "1px solid var(--border, rgba(0,0,0,0.20))", background: "transparent", color: "var(--text, #111)", cursor: "pointer", fontSize: 14 };
const btnPrimaryStyle: React.CSSProperties = { padding: "8px 16px", borderRadius: 6, border: "1px solid var(--accent, #06b6d4)", background: "var(--accent, #06b6d4)", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 };
