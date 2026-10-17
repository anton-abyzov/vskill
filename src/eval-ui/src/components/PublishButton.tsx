// ---------------------------------------------------------------------------
// 0759 — PublishButton (in-app submit since 0847).
//
// Click → if the skill has uncommitted changes, open the PublishDrawer (rich
// in-app commit → push → submit with a structured inline outcome). On a clean
// tree, POST /api/git/publish (real `git push`), then submit IN-APP via
// api.submitToQueue (proxied through the local eval-server — NO browser
// redirect) and toast the structured outcome. The website is only opened as a
// graceful fallback when the remote is not a recognizable GitHub URL or the
// skill identity is unknown. On failure: studio:toast error; never open the
// browser on a successful push.
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import { api } from "../api";
import { isSubmissionRefusal } from "../submission-queue";
import { normalizeRemoteUrl } from "../utils/normalizeRemoteUrl";
import { openExternalUrlViaDesktop } from "../preferences/lib/useDesktopBridge";
import { PublishDrawer } from "./PublishDrawer";
import { HOSTED_PRIVATE_PUBLISHING_AVAILABLE } from "../hosted-publishing";
import type { PublishTenantSelection } from "../hooks/usePublishTenant";

function emitToast(message: string, severity: "info" | "error"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("studio:toast", { detail: { message, severity } }),
  );
}

// Bare website submit page. Studio never prefills ?repo= here: nothing on
// these fallback paths has confirmed the repo public (0874 AC-06).
const BARE_SUBMIT_URL = "https://verified-skill.com/submit";

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
  /** 0856: the skill being published — enables the in-app submit flow. When
   *  absent, both the clean-tree path and the drawer fall back to the website. */
  skillName?: string;
  /** 0856: repo-relative skill path (optional — platform discovers it). */
  skillPath?: string;
  /** 0856: privacy choice forwarded to the submission. Default "public". */
  privacy?: "public" | "private" | "decide-later";
  /** 0856: tenant the user is publishing under (required for private). */
  tenantId?: string;
  tenantSelection?: PublishTenantSelection;
}

export function PublishButton({ remoteUrl, provider, model, skillName, skillPath, privacy, tenantId, tenantSelection }: Props): React.ReactElement {
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

      // With hosted publishing available, clean trees also need an explicit
      // visibility/account choice. Publishing never silently defaults private
      // repository content into the public queue.
      if (hasChanges || privacy === "private" || (HOSTED_PRIVATE_PUBLISHING_AVAILABLE && skillName)) {
        setDrawerFileCount(fileCount);
        setDrawerOpen(true);
        return;
      }

      const result = await api.gitPublish();
      const effectiveRemote = result.remoteUrl ?? remoteUrl;
      const shortSha = (result.commitSha ?? "").slice(0, 7);
      const branch = result.branch ?? "";

      // 0856: clean-tree path. When we know the skill, submit IN-APP instead of
      // opening verified-skill.com. The drawer owns the rich inline-outcome UX;
      // here (no dirty changes → no drawer) we submit directly and toast the
      // outcome. Falls back to the website when the skill / remote is unknown.
      if (skillName) {
        let repoUrl: string | null = null;
        try {
          repoUrl = normalizeRemoteUrl(effectiveRemote);
        } catch {
          repoUrl = null;
        }
        if (repoUrl) {
          let submitRes: import("../api").SubmitToQueueResult;
          try {
            submitRes = await api.submitToQueue({
              repoUrl,
              skillName,
              skillPath,
              source: "studio-submit",
              // Explicit private intent always takes the guarded drawer above.
              privacy: privacy ?? "public",
              tenantId: HOSTED_PRIVATE_PUBLISHING_AVAILABLE ? tenantId : undefined,
            });
          } catch (err) {
            // 0874 AC-06: private or unconfirmed repo — the push stands,
            // nothing was sent, and no website or sign-in is offered.
            if (!isSubmissionRefusal(err)) throw err;
            emitToast(`Pushed ${shortSha} on ${branch}. Not submitted to verified-skill.com: ${err.message}`, "info");
            return;
          }
          emitToast(submitToastMessage(submitRes, skillName, shortSha, branch), "info");
        } else {
          // Non-normalizable remote (e.g. GitLab/self-hosted). The push already
          // SUCCEEDED — never surface "Publish failed" here. buildSubmitUrl-
          // FromRemote re-runs normalizeRemoteUrl and would re-throw, so guard
          // it and degrade to the bare submit page instead of letting the throw
          // escape to the outer catch.
          void openExternalUrlViaDesktop(BARE_SUBMIT_URL);
          emitToast(`Pushed ${shortSha} on ${branch} — open the website to submit`, "info");
        }
      } else {
        // No skill identity → website-open fallback. Nothing confirmed the
        // repo public, so open the bare submit page (0874 AC-06): a private
        // repo URL never rides the query string to verified-skill.com.
        void openExternalUrlViaDesktop(BARE_SUBMIT_URL);
        emitToast(`Opening verified-skill.com — ${shortSha} on ${branch}`, "info");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Cap at 200 chars for the toast surface
      const summary = message.length > 200 ? message.slice(0, 200) + "…" : message;
      emitToast(`Publish failed: ${summary}`, "error");
    } finally {
      setPublishing(false);
    }
  }, [publishing, drawerOpen, remoteUrl, skillName, skillPath, privacy, tenantId]);

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
        title="Commit, push, and submit to the review queue — in-app, no browser redirect"
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
          skillName={skillName}
          skillPath={skillPath}
          privacy={privacy}
          tenantId={tenantId}
          tenantSelection={tenantSelection}
          onClose={closeDrawer}
        />
      )}
    </>
  );
}

// 0856: map an in-app submit outcome to a short toast line for the clean-tree
// (no-drawer) path. The drawer path renders a richer inline block instead.
function submitToastMessage(
  result: import("../api").SubmitToQueueResult,
  skillName: string,
  shortSha: string,
  branch: string,
): string {
  switch (result.kind) {
    case "created":
      return `Submitted ${skillName} — ${shortSha} on ${branch}`;
    case "requeued":
      return `Re-queued ${skillName} for review — ${shortSha}`;
    case "duplicate":
      return `${skillName} is already in the queue`;
    case "alreadyVerified":
      return `${skillName} is already verified`;
    case "blocked":
      return `${skillName} is blocked and can’t be submitted`;
  }
}
