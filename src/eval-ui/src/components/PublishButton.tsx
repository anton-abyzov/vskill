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
import { PublishDrawer } from "./PublishDrawer";

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
  /** Studio-configured LLM provider — passed through to PublishDrawer for AI commit messages. */
  provider?: string;
  /** Studio-configured LLM model — passed through to PublishDrawer. */
  model?: string;
}

export function PublishButton({ remoteUrl, provider, model }: Props): React.ReactElement {
  const [publishing, setPublishing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerFileCount, setDrawerFileCount] = useState(0);

  const onClick = useCallback(async () => {
    if (publishing || drawerOpen) return;
    setPublishing(true);
    try {
      // 0759 Phase 5: probe dirty state first. If there are uncommitted changes,
      // open the AI-commit-message drawer instead of pushing immediately.
      let hasChanges = false;
      let fileCount = 0;
      try {
        const diff = await api.gitDiff();
        hasChanges = Boolean(diff.hasChanges);
        fileCount = diff.fileCount ?? 0;
      } catch {
        // Diff probe is best-effort. If it fails, fall through to today's
        // push-only flow — preserves backward compatibility with the
        // happy-path 0759 contract.
      }

      if (hasChanges) {
        setDrawerFileCount(fileCount);
        setDrawerOpen(true);
        return;
      }

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
  }, [publishing, drawerOpen, remoteUrl]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <>
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
      {drawerOpen && (
        <PublishDrawer
          remoteUrl={remoteUrl}
          fileCount={drawerFileCount}
          provider={provider}
          model={model}
          onClose={closeDrawer}
        />
      )}
    </>
  );
}
