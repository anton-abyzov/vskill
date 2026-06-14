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
//   Commit & Push → /api/git/publish → submit IN-APP via api.submitToQueue →
//   show the structured inline outcome (created/duplicate/alreadyVerified/
//   requeued/blocked). No browser redirect; "Open on website" is a secondary
//   link. Failure: inline error block, drawer stays open.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { api, type SubmitToQueueResult } from "../api";
import { buildSubmitUrlFromRemote, normalizeRemoteUrl } from "../utils/normalizeRemoteUrl";
import { openExternalUrlViaDesktop } from "../preferences/lib/useDesktopBridge";
import { useTier } from "../hooks/useTier";
import { PaywallModal } from "./PaywallModal";

type Mode = "manual" | "ai";

// 0874 — publish-visibility choice. "public" is the world-visible registry;
// "private" is tenant-scoped and gated to paid tiers; "decide-later" defers.
type Privacy = "public" | "private" | "decide-later";

// 0856: structured, in-app submit outcome — drives the inline result block so
// a submit NEVER looks like it "did nothing". Mirrors SubmitToQueueResult plus
// a website-fallback variant for the not-logged-in / unknown-skill path.
type SubmitOutcome =
  | { ok: true; result: SubmitToQueueResult; submitUrl: string }
  | { ok: false; websiteUrl: string };

function emitToast(message: string, severity: "info" | "error"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("studio:toast", { detail: { message, severity } }),
  );
}

/**
 * Build the website submit URL from a raw remote, degrading to the bare submit
 * page when the remote isn't a recognizable github URL. `buildSubmitUrlFrom-
 * Remote` throws on a non-normalizable remote; a successful push must NEVER be
 * reported as a failure, so we swallow that and send the user to the generic
 * submit page (where they can pick the repo manually).
 */
const BARE_SUBMIT_URL = "https://verified-skill.com/submit";
function websiteSubmitUrl(rawRemoteUrl: string): string {
  try {
    return buildSubmitUrlFromRemote(rawRemoteUrl);
  } catch {
    return BARE_SUBMIT_URL;
  }
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
  /** 0856: the skill being published. When present, Commit & Push submits the
   *  skill to the queue IN-APP (POST /api/v1/submissions) instead of opening
   *  verified-skill.com. Absent → falls back to the website-open flow. */
  skillName?: string;
  /** 0856: repo-relative path to the skill dir. Optional — the platform
   *  discovers it from the repo when omitted. */
  skillPath?: string;
  /** 0856: privacy choice forwarded to the submission. Default "public". */
  privacy?: "public" | "private" | "decide-later";
  /** 0856: tenant the user is publishing under (required for private). */
  tenantId?: string;
}

export function PublishDrawer({
  remoteUrl,
  fileCount,
  provider,
  model,
  onClose,
  defaultMode = "manual",
  skillName,
  skillPath,
  privacy,
  tenantId,
}: Props): React.ReactElement {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // 0874 — publish-visibility chooser. Seed from the prop when supplied,
  // otherwise default to "public". Free users can't pick "private" (locked).
  const [privacyChoice, setPrivacyChoice] = useState<Privacy>(privacy ?? "public");
  const [paywallOpen, setPaywallOpen] = useState(false);
  const { isFree } = useTier();
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  // 0856: inline submit outcome — when set, the drawer shows the result block
  // (created / duplicate / alreadyVerified / requeued / blocked) and stays
  // open so the user sees confirmation. `null` until the first submit settles.
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);

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
    setOutcome(null);
    try {
      // Step 1 — commit + push (server-side `git add -A && commit && push`).
      const result = await api.gitPublish({ commitMessage: trimmed });
      const effectiveRemote = result.remoteUrl ?? remoteUrl;
      const shortSha = (result.commitSha ?? "").slice(0, 7);
      const branch = result.branch ?? "";

      // Step 2 — submit to the queue IN-APP when we know the skill identity.
      // Without a skillName we can't form a valid POST body, so fall back to
      // the website submit page (which lets the user pick the skill).
      if (skillName) {
        let repoUrl: string;
        try {
          repoUrl = normalizeRemoteUrl(effectiveRemote);
        } catch {
          // Non-github remote → can't submit in-app; degrade to the website.
          // buildSubmitUrlFromRemote re-runs normalizeRemoteUrl and would
          // re-throw on a non-normalizable remote, escaping to the outer catch
          // and surfacing "Publish failed" even though the push SUCCEEDED.
          // Guard it and fall back to the bare submit page instead.
          setOutcome({ ok: false, websiteUrl: websiteSubmitUrl(effectiveRemote) });
          emitToast(`Pushed ${shortSha} on ${branch} — open the website to submit`, "info");
          return;
        }
        let submitRes: SubmitToQueueResult;
        try {
          submitRes = await api.submitToQueue({
            repoUrl,
            skillName,
            skillPath,
            source: "studio-submit",
            privacy: privacyChoice,
            tenantId,
          });
        } catch {
          // The push already SUCCEEDED — only the in-app queue submit failed,
          // almost always because the user isn't signed in to verified-skill
          // (401) or is offline. A push success must NEVER read as "Publish
          // failed". Degrade to the website submit flow, which carries the
          // ?repo= URL param so the user can sign in there and finish in one
          // click (the prior browser-submit UX).
          setOutcome({ ok: false, websiteUrl: websiteSubmitUrl(effectiveRemote) });
          emitToast(`Pushed ${shortSha} on ${branch} — sign in or finish on the website to submit`, "info");
          return;
        }
        const submitUrl = `https://verified-skill.com/submit?repo=${encodeURIComponent(repoUrl)}`;
        setOutcome({ ok: true, result: submitRes, submitUrl });
        emitToast(`Submitted ${skillName} — ${shortSha} on ${branch}`, "info");
        // Drawer stays open so the inline outcome is visible. The user closes
        // it explicitly via Done / Cancel.
      } else {
        // No skill identity → website-open fallback (legacy behavior). Same
        // guard: a non-github remote must not turn a successful push into
        // "Publish failed".
        setOutcome({ ok: false, websiteUrl: websiteSubmitUrl(effectiveRemote) });
        emitToast(`Pushed ${shortSha} on ${branch} — open the website to submit`, "info");
      }
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
  }, [message, publishing, remoteUrl, skillName, skillPath, privacyChoice, tenantId]);

  const openWebsite = useCallback((url: string) => {
    // Reuse the tiered desktop shell-open seam (Tauri invoke → sidecar →
    // plugin-shell → window.open). Works identically in the browser build.
    void openExternalUrlViaDesktop(url);
  }, []);

  const canCommit = message.trim().length > 0 && !publishing && !generating;

  // 0784 hotfix — modal always renders on a dark surface (matches the
  // backdrop-blur design intent) with hard-coded light text, so readability
  // doesn't depend on the host theme tokens. Light-theme users were getting
  // dark text on the dark modal and couldn't read anything.
  const MODAL_TEXT = "#E6EDF3";
  const MODAL_TEXT_MUTED = "#9CA3AF";
  const MODAL_BORDER = "rgba(255,255,255,0.12)";
  const MODAL_INPUT_BG = "#0F1115";

  // ── style tokens ───────────────────────────────────────────────────────
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: MODAL_TEXT_MUTED,
    fontFamily: "var(--font-mono, monospace)",
    marginBottom: 6,
    display: "block",
  };

  const segmentBase: React.CSSProperties = {
    flex: 1,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontSize: 12,
    fontFamily: "var(--font-mono, monospace)",
    background: "transparent",
    color: MODAL_TEXT_MUTED,
    border: "none",
    cursor: "pointer",
    transition: "background 120ms ease, color 120ms ease",
  };

  const segmentActive: React.CSSProperties = {
    ...segmentBase,
    background: "rgba(255,255,255,0.08)",
    color: MODAL_TEXT,
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
            // 0784 hotfix — hard-coded dark surface + light text so the modal
            // is readable in every theme without relying on host tokens.
            background: "#1A1D24",
            border: `1px solid ${MODAL_BORDER}`,
            borderRadius: 10,
            padding: 24,
            boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
            color: MODAL_TEXT,
            fontFamily: "var(--font-mono, monospace)",
            animation: "publishDrawerIn 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          }}
        >
          {/* ── Header ───────────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
            <strong
              style={{
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: MODAL_TEXT,
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
                color: MODAL_TEXT_MUTED,
                fontSize: 22,
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
              fontSize: 12,
              color: MODAL_TEXT_MUTED,
              fontVariantNumeric: "tabular-nums",
              marginBottom: 18,
            }}
          >
            <span aria-hidden="true" style={{ color: "#F59E0B", fontFamily: "monospace" }}>▮</span>
            <span>
              {fileCount} file{fileCount === 1 ? "" : "s"} changed
            </span>
          </div>
          <div style={{ height: 1, background: MODAL_BORDER, margin: "0 -24px 18px" }} />

          {/* ── Mode toggle (segmented) ────────────────────────────── */}
          <span style={labelStyle}>Mode</span>
          <div
            role="tablist"
            aria-label="Commit message mode"
            data-testid="publish-mode-toggle"
            style={{
              display: "flex",
              border: `1px solid ${MODAL_BORDER}`,
              borderRadius: 6,
              overflow: "hidden",
              marginBottom: 16,
              background: MODAL_INPUT_BG,
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
            <div style={{ width: 1, background: MODAL_BORDER }} />
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

          {/* ── Privacy chooser (0874) ────────────────────────────── */}
          <span style={labelStyle}>Visibility</span>
          <PrivacyChooser
            value={privacyChoice}
            onChange={setPrivacyChoice}
            isFree={isFree}
            onUpgrade={() => setPaywallOpen(true)}
            disabled={publishing}
            border={MODAL_BORDER}
            text={MODAL_TEXT}
            textMuted={MODAL_TEXT_MUTED}
            inputBg={MODAL_INPUT_BG}
          />

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
              background: MODAL_INPUT_BG,
              border: `1px solid ${MODAL_BORDER}`,
              borderRadius: 6,
              padding: "10px 12px",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 13,
              lineHeight: 1.6,
              color: MODAL_TEXT,
              resize: "vertical",
              outline: "none",
            }}
          />

          {/* 0784 hotfix — explicit Generate button so the user doesn't have
              to discover that switching modes triggers generation. Visible
              only in AI mode. */}
          {mode === "ai" && (
            <button
              type="button"
              onClick={generate}
              disabled={generating || publishing}
              data-testid="publish-generate-button"
              style={{
                marginTop: 10,
                padding: "8px 14px",
                background: generating ? "rgba(255,255,255,0.06)" : "#2563EB",
                color: generating ? MODAL_TEXT_MUTED : "#FFFFFF",
                border: "1px solid " + (generating ? MODAL_BORDER : "#2563EB"),
                borderRadius: 6,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 12,
                fontWeight: 600,
                cursor: generating || publishing ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {generating ? "Generating…" : "Generate with AI"}
            </button>
          )}

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

          {/* ── Inline submit outcome (0856) ──────────────────────── */}
          {outcome && (
            <SubmitOutcomeBlock
              outcome={outcome}
              onOpenWebsite={openWebsite}
              border={MODAL_BORDER}
              textMuted={MODAL_TEXT_MUTED}
            />
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
            <div style={{ display: "flex", gap: 8 }}>
              {outcome ? (
                // 0856: post-submit — the result is shown inline; a single
                // "Done" button dismisses. No re-submit (would duplicate).
                <button
                  type="button"
                  aria-label="Done"
                  onClick={onClose}
                  data-testid="publish-done"
                  style={{
                    padding: "8px 16px",
                    background: "#22C55E",
                    color: "#0B0F12",
                    border: "1px solid #22C55E",
                    borderRadius: 6,
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label="Cancel"
                    onClick={onClose}
                    disabled={publishing}
                    style={{
                      padding: "8px 14px",
                      background: "transparent",
                      color: MODAL_TEXT,
                      border: `1px solid ${MODAL_BORDER}`,
                      borderRadius: 6,
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: publishing ? "not-allowed" : "pointer",
                      opacity: publishing ? 0.5 : 1,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    aria-label="Commit & Push"
                    onClick={onCommitPush}
                    disabled={!canCommit}
                    data-testid="publish-commit-push"
                    style={{
                      padding: "8px 16px",
                      background: canCommit ? "#22C55E" : "rgba(255,255,255,0.06)",
                      color: canCommit ? "#0B0F12" : MODAL_TEXT_MUTED,
                      border: "1px solid " + (canCommit ? "#22C55E" : MODAL_BORDER),
                      borderRadius: 6,
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: canCommit ? "pointer" : "not-allowed",
                    }}
                  >
                    {publishing ? "Publishing…" : "Commit & Push"}
                  </button>
                </>
              )}
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
      {/* 0874 — paywall opened from the locked PRIVATE option. Resolving it to a
          paid tier auto-selects private so the user lands back where they were. */}
      <PaywallModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        onProceed={() => setPrivacyChoice("private")}
        skillName={skillName}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// 0874 — PrivacyChooser.
//
// Adapted from the platform's PrivacyTernaryField (PUBLIC / PRIVATE /
// decide-later radiogroup). Tier-gated: free users see the PRIVATE option
// rendered as LOCKED with an inline "Upgrade to publish privately" CTA that
// opens the paywall; paid users can select it. The modal's dark surface tokens
// are threaded in so the chooser reads correctly in every host theme.
// ---------------------------------------------------------------------------

interface PrivacyChooserProps {
  value: Privacy;
  onChange: (next: Privacy) => void;
  isFree: boolean;
  onUpgrade: () => void;
  disabled?: boolean;
  border: string;
  text: string;
  textMuted: string;
  inputBg: string;
}

function PrivacyChooser({
  value,
  onChange,
  isFree,
  onUpgrade,
  disabled,
  border,
  text,
  textMuted,
  inputBg,
}: PrivacyChooserProps): React.ReactElement {
  const segment = (selected: boolean): React.CSSProperties => ({
    flex: 1,
    minWidth: 120,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    border: `1px solid ${selected ? "#22C55E" : border}`,
    borderRadius: 6,
    background: selected ? "rgba(34,197,94,0.08)" : inputBg,
    color: text,
    cursor: disabled ? "not-allowed" : "pointer",
    textAlign: "left",
    fontFamily: "var(--font-mono, monospace)",
  });
  const title: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: text };
  const hint: React.CSSProperties = { fontSize: 10.5, color: textMuted, lineHeight: 1.4 };

  return (
    <div role="radiogroup" aria-label="Visibility" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
      <button
        type="button"
        role="radio"
        aria-checked={value === "public"}
        data-testid="publish-privacy-public"
        onClick={() => !disabled && onChange("public")}
        disabled={disabled}
        style={segment(value === "public")}
      >
        <span style={title}>Public</span>
        <span style={hint}>Visible to everyone on verified-skill.com.</span>
      </button>

      {isFree ? (
        // Locked PRIVATE — clicking opens the paywall instead of selecting it.
        <button
          type="button"
          role="radio"
          aria-checked={value === "private"}
          data-testid="publish-privacy-locked"
          onClick={() => !disabled && onUpgrade()}
          disabled={disabled}
          style={{ ...segment(false), opacity: 0.85 }}
        >
          <span style={title}>🔒 Private</span>
          <span style={{ ...hint, color: "#F59E0B" }}>Upgrade to publish privately</span>
        </button>
      ) : (
        <button
          type="button"
          role="radio"
          aria-checked={value === "private"}
          data-testid="publish-privacy-private"
          onClick={() => !disabled && onChange("private")}
          disabled={disabled}
          style={segment(value === "private")}
        >
          <span style={title}>🔒 Private</span>
          <span style={hint}>Only your org can see, search, or install it.</span>
        </button>
      )}

      <button
        type="button"
        role="radio"
        aria-checked={value === "decide-later"}
        data-testid="publish-privacy-decide-later"
        onClick={() => !disabled && onChange("decide-later")}
        disabled={disabled}
        style={segment(value === "decide-later")}
      >
        <span style={title}>Decide later</span>
        <span style={hint}>Submit without choosing visibility yet.</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 0856 — inline submit outcome block.
//
// Renders the structured result of the in-app submit so the flow never looks
// like a no-op. Each branch gets its own copy + tone; a secondary "Open on
// website" link is always available (in-app is the default when logged in).
// ---------------------------------------------------------------------------

interface SubmitOutcomeBlockProps {
  outcome: SubmitOutcome;
  onOpenWebsite: (url: string) => void;
  border: string;
  textMuted: string;
}

function SubmitOutcomeBlock({
  outcome,
  onOpenWebsite,
  border,
  textMuted,
}: SubmitOutcomeBlockProps): React.ReactElement {
  // Website fallback (not logged in / non-github remote / unknown skill).
  if (!outcome.ok) {
    return (
      <div
        role="status"
        data-testid="publish-outcome"
        data-outcome="website-fallback"
        style={outcomeBoxStyle(border, "#F59E0B")}
      >
        <strong style={{ fontWeight: 600, color: "#F59E0B" }}>Pushed to GitHub.</strong>{" "}
        <span style={{ color: textMuted }}>
          Sign in to submit in-app, or finish on the website.
        </span>{" "}
        <button
          type="button"
          data-testid="publish-open-website"
          onClick={() => onOpenWebsite(outcome.websiteUrl)}
          style={outcomeLinkStyle()}
        >
          Open on website ↗
        </button>
      </div>
    );
  }

  const { result, submitUrl } = outcome;
  let tone = "#22C55E";
  let title = "Submitted to the queue.";
  let detail = "";
  switch (result.kind) {
    case "created":
      tone = "#22C55E";
      title = "Submitted to the queue.";
      detail = `${result.skillName} is now ${result.state}. We’ll notify you when review completes.`;
      break;
    case "requeued":
      tone = "#22C55E";
      title = "Re-queued for review.";
      detail = `This skill was already submitted — it’s back in the queue (${result.state}).`;
      break;
    case "duplicate":
      tone = "#F59E0B";
      title = "Already in the queue.";
      detail = `This skill is already submitted (${result.state}). No new entry was created.`;
      break;
    case "alreadyVerified":
      tone = "#3B82F6";
      title = "Already verified.";
      detail = `${result.skillName ?? "This skill"} is already published — nothing to submit.`;
      break;
    case "blocked":
      tone = "#EF4444";
      title = "Submission blocked.";
      detail = "This skill is on the blocklist and can’t be submitted. Tap to see why.";
      break;
  }

  return (
    <div
      role="status"
      data-testid="publish-outcome"
      data-outcome={result.kind}
      style={outcomeBoxStyle(border, tone)}
    >
      <strong style={{ fontWeight: 600, color: tone }}>{title}</strong>{" "}
      <span style={{ color: textMuted }}>{detail}</span>{" "}
      <button
        type="button"
        data-testid="publish-open-website"
        onClick={() => onOpenWebsite(submitUrl)}
        style={outcomeLinkStyle()}
      >
        Open on website ↗
      </button>
    </div>
  );
}

function outcomeBoxStyle(border: string, tone: string): React.CSSProperties {
  return {
    marginTop: 10,
    padding: "8px 12px",
    border: `1px solid ${border}`,
    borderLeft: `3px solid ${tone}`,
    background: "rgba(255,255,255,0.03)",
    borderRadius: 4,
    fontSize: 11,
    fontFamily: "var(--font-mono, monospace)",
    lineHeight: 1.55,
  };
}

function outcomeLinkStyle(): React.CSSProperties {
  return {
    background: "none",
    border: "none",
    color: "var(--color-accent, #60A5FA)",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "inherit",
    textDecoration: "underline",
    padding: 0,
  };
}
