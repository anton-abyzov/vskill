// ---------------------------------------------------------------------------
// 0759 Phase 5 — PublishDrawer.
//
// Mounts when the user clicks Publish on a dirty workspace. Auto-fires the
// AI commit-message generation against the user's already-configured studio
// provider/model, lets them edit the result, and on "Commit & Push" calls
// /api/git/publish with the message — server runs `git add -A && git commit
// -m "<msg>" && git push`. On success, opens verified-skill.com/submit and
// closes the drawer. On failure, dispatches an error toast and stays open
// so the user can adjust and retry.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { buildSubmitUrlFromRemote } from "../utils/normalizeRemoteUrl";

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
}

export function PublishDrawer({ remoteUrl, fileCount, provider, model, onClose }: Props): React.ReactElement {
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

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

  // Auto-fire generation on mount.
  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCommitPush = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || publishing) return;
    setPublishing(true);
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
      emitToast(`Publish failed: ${capped}`, "error");
    } finally {
      setPublishing(false);
    }
  }, [message, publishing, remoteUrl, onClose]);

  const canCommit = message.trim().length > 0 && !publishing && !generating;

  return (
    <div
      role="dialog"
      aria-label="Publish"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 420,
        maxWidth: "calc(100vw - 32px)",
        background: "var(--bg-elevated, #1a1a1a)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        padding: 14,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        zIndex: 1000,
        fontSize: 12,
        color: "var(--text-primary)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Publish</strong>
        <span style={{ color: "var(--text-tertiary)" }}>{fileCount} file{fileCount === 1 ? "" : "s"} changed</span>
      </div>

      <label htmlFor="commit-message" style={{ display: "block", marginBottom: 4, color: "var(--text-secondary)" }}>
        Commit message
      </label>
      <textarea
        id="commit-message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        disabled={generating}
        placeholder={generating ? "Generating with AI…" : "Enter a commit message"}
        style={{
          width: "100%",
          background: "var(--bg-subtle)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 4,
          padding: "6px 8px",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 12,
          color: "var(--text-primary)",
          resize: "vertical",
        }}
      />

      {generateError && (
        <div style={{ color: "var(--error, #f87171)", marginTop: 6, fontSize: 11 }}>
          AI generation failed: {generateError}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
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
  );
}
