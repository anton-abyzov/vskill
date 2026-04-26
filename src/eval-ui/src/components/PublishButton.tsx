// ---------------------------------------------------------------------------
// 0759 — PublishButton.
//
// Click → POST /api/git/publish (real `git push` on the eval-server side).
// On success: window.open verified-skill.com/submit?repo=<encoded> in a new
// tab and emit a studio:toast info event with short SHA + branch.
// On failure: emit a studio:toast error event with stderr summary; do NOT
// open the browser. The full 0742 build will replace this with a richer
// drawer (dirty pill, AI commit messages, gh-CLI repo creation).
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import { api } from "../api";
import { buildSubmitUrlFromRemote } from "../utils/normalizeRemoteUrl";

function emitToast(message: string, severity: "info" | "error"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("studio:toast", { detail: { message, severity } }),
  );
}

interface Props {
  /**
   * Pre-resolved remote URL (from useGitRemote) — used as a fallback if the
   * publish response doesn't include `remoteUrl`. The component prefers the
   * remoteUrl returned by /git-publish (it's the freshest).
   */
  remoteUrl: string;
}

export function PublishButton({ remoteUrl }: Props): React.ReactElement {
  const [publishing, setPublishing] = useState(false);

  const onClick = useCallback(async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      const result = await api.gitPublish();
      const effectiveRemote = result.remoteUrl ?? remoteUrl;
      const submitUrl = buildSubmitUrlFromRemote(effectiveRemote);
      window.open(submitUrl, "_blank", "noopener,noreferrer");
      const shortSha = (result.commitSha ?? "").slice(0, 7);
      const branch = result.branch ?? "";
      emitToast(`Opening verified-skill.com — ${shortSha} on ${branch}`, "info");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Cap at 200 chars for the toast surface
      const summary = message.length > 200 ? message.slice(0, 200) + "…" : message;
      emitToast(`Publish failed: ${summary}`, "error");
    } finally {
      setPublishing(false);
    }
  }, [publishing, remoteUrl]);

  return (
    <button
      type="button"
      aria-label="Publish"
      onClick={onClick}
      disabled={publishing}
      className="btn btn-primary text-[11px]"
      style={{ padding: "5px 14px" }}
      title="Push committed changes and open verified-skill.com to submit"
    >
      {publishing ? (
        <>
          <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
          {" Publishing…"}
        </>
      ) : (
        "Publish"
      )}
    </button>
  );
}
