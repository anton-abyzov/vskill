// ---------------------------------------------------------------------------
// 0698 — CreateSkillModal
//
// Three-step creation flow:
//   1. Destination picker — three cards (Standalone / Existing Plugin / New Plugin)
//   2. Name + description — skill name (kebab-validated), plugin name if applicable
//   3. Create or generate — empty scaffold OR route to /create for AI generation
//
// Calls POST /api/authoring/create-skill to write files; optionally chains to
// the existing AI generation flow afterwards.
//
// Entry points pass `initialMode` so context-aware buttons pre-select the
// relevant card (AUTHORING > Skills "+" opens on "standalone", AUTHORING >
// Plugins "+" opens on "new-plugin", etc.).
// ---------------------------------------------------------------------------

import * as React from "react";
import { mutate as swrMutate } from "../hooks/useSWR";

export type CreateSkillMode = "standalone" | "existing-plugin" | "new-plugin";

export interface AuthoringPluginSummary {
  name: string;
  path: string;
}

export interface CreateSkillModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-select a mode when opening from context-aware entry points. */
  initialMode?: CreateSkillMode;
  /** Whether the active agent is Claude Code — gates plugin modes. */
  isClaudeCode: boolean;
  /** Absolute path of the active project root — displayed in the path preview. */
  projectRoot: string;
  /** Invoked with the created skill's server-returned paths. */
  onCreated?: (result: {
    mode: CreateSkillMode;
    skillName: string;
    pluginName: string | null;
    skillMdPath: string;
  }) => void;
}

const KEBAB = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;

export function CreateSkillModal({
  open,
  onClose,
  initialMode = "standalone",
  isClaudeCode,
  projectRoot,
  onCreated,
}: CreateSkillModalProps): React.ReactElement | null {
  const [step, setStep] = React.useState<"destination" | "details">("destination");
  const [mode, setMode] = React.useState<CreateSkillMode>(initialMode);
  const [skillName, setSkillName] = React.useState("");
  const [pluginName, setPluginName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [plugins, setPlugins] = React.useState<AuthoringPluginSummary[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset when opened
  React.useEffect(() => {
    if (open) {
      setStep("destination");
      setMode(initialMode);
      setSkillName("");
      setPluginName("");
      setDescription("");
      setError(null);
    }
  }, [open, initialMode]);

  // Load existing authored plugins so the "existing plugin" card is meaningful
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/authoring/plugins")
      .then((r) => r.json())
      .then((body: { plugins?: AuthoringPluginSummary[] }) => {
        if (alive) setPlugins(body.plugins ?? []);
      })
      .catch(() => {
        /* non-fatal — existing-plugin card just stays empty */
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // Esc to close
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const hasPlugins = plugins.length > 0;
  const canSelectExistingPlugin = isClaudeCode && hasPlugins;
  const canSelectNewPlugin = isClaudeCode;

  const skillNameValid = KEBAB.test(skillName);
  const pluginNameValid =
    mode === "existing-plugin" ? pluginName.length > 0 : KEBAB.test(pluginName);
  const canSubmit =
    !submitting &&
    skillNameValid &&
    (mode === "standalone" || pluginNameValid);

  const pathPreview = computePathPreview(projectRoot, mode, pluginName, skillName);

  async function routeToGenerator(): Promise<void> {
    // 0703 hotfix: pre-flight uniqueness check before we navigate off. The
    // "Create empty scaffold" path already handles 409 server-side, but the
    // AI branch previously redirected blindly and users only discovered the
    // clash after investing a prompt. Fail fast instead.
    setError(null);
    setSubmitting(true);
    try {
      const probeParams = new URLSearchParams();
      probeParams.set("mode", mode);
      probeParams.set("skillName", skillName);
      if (pluginName) probeParams.set("pluginName", pluginName);
      const probeRes = await fetch(`/api/authoring/skill-exists?${probeParams.toString()}`);
      const probeBody = (await probeRes.json()) as {
        exists?: boolean;
        path?: string;
        error?: string;
      };
      if (!probeRes.ok) {
        setError(probeBody.error ?? `Check failed: ${probeRes.status}`);
        return;
      }
      if (probeBody.exists) {
        setError(
          `Skill '${skillName}' already exists${probeBody.path ? ` at ${probeBody.path}` : ""}`,
        );
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      setSubmitting(false);
    }

    // 0698 polish: chain to the existing AI-generation flow at /create with
    // the destination pre-encoded as query params so the page can surface the
    // target path in its UI.
    const params = new URLSearchParams();
    params.set("mode", mode);
    params.set("skillName", skillName);
    if (description.trim()) params.set("description", description.trim());
    if (pluginName) params.set("pluginName", pluginName);
    // 0703 closure F-001 fix: use `location.hash` instead of `location.assign('/#...')`.
    // The hard-coded `/` prefix worked fine when eval-ui is served at root, but
    // breaks if ever mounted under a subpath (reverse proxy, monorepo sub-app).
    // Setting `location.hash` is the idiomatic way to navigate within a HashRouter
    // app and is subpath-agnostic.
    const hash = `#/create?${params.toString()}`;
    if (typeof window !== "undefined") {
      window.location.hash = hash;
    }
    onClose();
  }

  async function onSubmit(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/authoring/create-skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          skillName,
          description: description.trim() || undefined,
          pluginName: mode === "standalone" ? undefined : pluginName,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        skillMdPath?: string;
        pluginName?: string | null;
      };
      if (!res.ok || !body.ok) {
        setError(body.error ?? `Create failed: ${res.status}`);
        return;
      }
      // Invalidate sidebar cache so the new skill appears immediately
      swrMutate("skills");
      onCreated?.({
        mode,
        skillName,
        pluginName: body.pluginName ?? null,
        skillMdPath: body.skillMdPath!,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create skill"
      data-vskill-create-skill-modal
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }}
      />
      <div
        style={{
          position: "relative",
          width: "min(560px, 92vw)",
          maxHeight: "86vh",
          overflow: "auto",
          background: "var(--color-paper, #fff)",
          border: "1px solid var(--border-default, rgba(0,0,0,0.12))",
          borderRadius: 10,
          boxShadow:
            "0 10px 15px -3px rgba(0,0,0,0.12), 0 20px 40px -8px rgba(0,0,0,0.18)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-subtle, rgba(0,0,0,0.08))",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text-primary)",
              fontFamily: "var(--font-serif, ui-serif)",
              letterSpacing: "0.01em",
            }}
          >
            {step === "destination" ? "Create a skill" : "Name and describe"}
          </h2>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-tertiary)",
              marginLeft: "auto",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            Step {step === "destination" ? "1" : "2"} of 2
          </div>
        </div>

        {/* Step 1: destination cards */}
        {step === "destination" && (
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <DestinationCard
              title="Standalone skill"
              subtitle="A single skill in this project"
              description="Lives at <project>/skills/<name>/SKILL.md. Works with every agent."
              icon="📄"
              selected={mode === "standalone"}
              onClick={() => setMode("standalone")}
            />

            <DestinationCard
              title="Add to existing plugin"
              subtitle={
                canSelectExistingPlugin
                  ? `${plugins.length} plugin source${plugins.length === 1 ? "" : "s"} in this project`
                  : !isClaudeCode
                    ? "Claude Code only"
                    : "No plugin sources in this project yet"
              }
              description="Appends a skill to an existing <plugin>/.claude-plugin/plugin.json source."
              icon="🧩"
              disabled={!canSelectExistingPlugin}
              selected={mode === "existing-plugin"}
              onClick={() => canSelectExistingPlugin && setMode("existing-plugin")}
            />

            <DestinationCard
              title="New plugin"
              subtitle={canSelectNewPlugin ? "Bundles one or more skills for distribution" : "Claude Code only"}
              description="Scaffolds <plugin>/.claude-plugin/plugin.json and its first skill."
              icon="📦"
              disabled={!canSelectNewPlugin}
              selected={mode === "new-plugin"}
              onClick={() => canSelectNewPlugin && setMode("new-plugin")}
            />
          </div>
        )}

        {/* Step 2: details */}
        {step === "details" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "new-plugin" && (
              <Field label="Plugin name" hint="kebab-case">
                <input
                  type="text"
                  value={pluginName}
                  onChange={(e) => setPluginName(e.target.value.trim())}
                  placeholder="my-first-plugin"
                  autoFocus
                  style={inputStyle(!pluginName || pluginNameValid)}
                />
              </Field>
            )}

            {mode === "existing-plugin" && (
              <Field label="Plugin">
                <select
                  value={pluginName}
                  onChange={(e) => setPluginName(e.target.value)}
                  style={{
                    ...inputStyle(true),
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <option value="">Select a plugin…</option>
                  {plugins.map((p) => (
                    <option key={p.path} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Skill name" hint="kebab-case">
              <input
                type="text"
                value={skillName}
                onChange={(e) => setSkillName(e.target.value.trim())}
                placeholder="my-new-skill"
                autoFocus={mode !== "new-plugin"}
                style={inputStyle(!skillName || skillNameValid)}
              />
            </Field>

            <Field label="Description" hint="One short sentence — shown in frontmatter">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Does a thing when Claude needs X"
                style={{
                  ...inputStyle(true),
                  resize: "vertical",
                  minHeight: 52,
                  fontFamily: "var(--font-sans)",
                }}
              />
            </Field>

            {pathPreview && (
              <div
                style={{
                  padding: "8px 10px",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-secondary)",
                  background: "var(--surface-1, rgba(0,0,0,0.03))",
                  border: "1px solid var(--border-subtle, rgba(0,0,0,0.08))",
                  borderRadius: 4,
                  wordBreak: "break-all",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 2, fontFamily: "var(--font-sans)" }}>
                  Will create:
                </div>
                {pathPreview.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}

            {error && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--color-error, #b91c1c)",
                  padding: "6px 10px",
                  background: "color-mix(in oklch, var(--color-error, #b91c1c) 8%, transparent)",
                  borderRadius: 4,
                }}
              >
                {error}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 16px",
            borderTop: "1px solid var(--border-subtle, rgba(0,0,0,0.08))",
            background: "var(--surface-1, rgba(0,0,0,0.02))",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
          {step === "destination" && (
            <button
              type="button"
              onClick={() => setStep("details")}
              style={primaryButtonStyle}
            >
              Continue →
            </button>
          )}
          {step === "details" && (
            <>
              <button
                type="button"
                onClick={() => setStep("destination")}
                style={secondaryButtonStyle}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => void routeToGenerator()}
                disabled={!canSubmit}
                style={{ ...secondaryButtonStyle, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
                title="Opens the AI generation flow with this destination pre-selected (choose Claude Code, Anthropic API, OpenRouter, or local models)"
              >
                Generate with AI
              </button>
              <button
                type="button"
                onClick={() => void onSubmit()}
                disabled={!canSubmit}
                style={{ ...primaryButtonStyle, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
                title="Creates an empty SKILL.md scaffold you can fill in by hand"
              >
                {submitting ? "Creating…" : "Create empty scaffold"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DestinationCard({
  title,
  subtitle,
  description,
  icon,
  selected,
  disabled,
  onClick,
}: {
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 14px",
        textAlign: "left",
        borderRadius: 8,
        border: selected
          ? "2px solid var(--color-accent, #2f6f8f)"
          : "1px solid var(--border-default, rgba(0,0,0,0.12))",
        background: selected
          ? "color-mix(in oklch, var(--color-accent, #2f6f8f) 8%, var(--color-paper, #fff))"
          : disabled
            ? "var(--surface-1, rgba(0,0,0,0.02))"
            : "var(--color-paper, #fff)",
        color: disabled ? "var(--text-tertiary)" : "var(--text-primary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        fontFamily: "inherit",
        width: "100%",
        transition: "border-color 120ms ease, background-color 120ms ease",
      }}
    >
      <span aria-hidden style={{ fontSize: 22, lineHeight: 1, marginTop: 2 }}>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{title}</div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            marginTop: 2,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {subtitle}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.5 }}>
          {description}
        </div>
      </div>
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function inputStyle(valid: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "7px 10px",
    fontSize: 13,
    fontFamily: "var(--font-mono)",
    border: `1px solid ${
      valid ? "var(--border-default, rgba(0,0,0,0.12))" : "var(--color-error, #b91c1c)"
    }`,
    borderRadius: 4,
    background: "var(--surface-0, #fff)",
    color: "var(--text-primary)",
    outline: "none",
    boxSizing: "border-box",
  };
}

const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 600,
  border: "1px solid var(--color-action, #2F5B8E)",
  borderRadius: 6,
  background: "var(--color-action, #2F5B8E)",
  color: "var(--color-action-ink, #FFFFFF)",
  cursor: "pointer",
  fontFamily: "inherit",
  boxShadow: "0 1px 2px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.12)",
  letterSpacing: "0.01em",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "7px 12px",
  fontSize: 13,
  fontWeight: 500,
  border: "1px solid var(--border-default, rgba(0,0,0,0.12))",
  borderRadius: 6,
  background: "transparent",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontFamily: "inherit",
};

function computePathPreview(
  projectRoot: string,
  mode: CreateSkillMode,
  pluginName: string,
  skillName: string,
): string[] | null {
  const safeSkill = skillName || "<skill-name>";
  const safePlugin = pluginName || "<plugin-name>";
  const root = projectRoot || "<project>";
  if (mode === "standalone") {
    return [`${root}/skills/${safeSkill}/SKILL.md`];
  }
  if (mode === "existing-plugin") {
    return [`${root}/${safePlugin}/skills/${safeSkill}/SKILL.md`];
  }
  if (mode === "new-plugin") {
    return [
      `${root}/${safePlugin}/.claude-plugin/plugin.json`,
      `${root}/${safePlugin}/skills/${safeSkill}/SKILL.md`,
    ];
  }
  return null;
}
