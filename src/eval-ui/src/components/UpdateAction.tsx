import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStudio } from "../StudioContext";
import type { SkillInfo, VersionDiff } from "../types";
import { useToast } from "./ToastProvider";
import { ChangelogViewer } from "./ChangelogViewer";

interface Props {
  skill: SkillInfo | null;
}

type ActionStatus = "idle" | "updating" | "done" | "error";

/**
 * 0736 US-001: "Update to X.Y.Z" CTA rendered inside the RightPanel Overview
 * tab when the selected skill has an outstanding update.
 *
 * Uses a single POST /api/skills/:plugin/:skill/update (not an EventSource).
 * The old SSE side-channel (startSkillUpdate) caused ERR_CONNECTION_REFUSED
 * because the backend only accepts POST, not GET.
 */
export function UpdateAction({ skill }: Props) {
  const { refreshUpdates, dismissPushUpdate } = useStudio();
  const { toast } = useToast();
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [changelogDiff, setChangelogDiff] = useState<VersionDiff | null>(null);
  const [changelogLoading, setChangelogLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleUpdate = useCallback(async () => {
    if (!skill) return;
    if (status === "updating") return;

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("updating");
    setErrorMsg(null);

    try {
      const result = await api.postSkillUpdate(skill.plugin, skill.skill, controller.signal);

      if (result.ok) {
        setStatus("done");
        void refreshUpdates();
        dismissPushUpdate(`${skill.plugin}/${skill.skill}`);
        toast({ message: `Updated ${skill.skill}.`, severity: "success", durationMs: 4000 });
      } else {
        const msg = `Update failed (HTTP ${result.status}): ${result.body}`;
        setStatus("idle");
        setErrorMsg(msg);
        toast({
          message: `Couldn't update ${skill.skill} — HTTP ${result.status}`,
          severity: "error",
          durationMs: 0,
          action: { label: "Retry", onInvoke: () => { void handleUpdate(); } },
        });
      }
    } catch (err) {
      // Aborted on unmount — caller is gone, no UI to update.
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const errMsg = err instanceof Error ? err.message : "Network error";
      setStatus("idle");
      setErrorMsg(errMsg);
      toast({
        message: `Couldn't update ${skill.skill} — ${errMsg}`,
        severity: "error",
        durationMs: 0,
        action: { label: "Retry", onInvoke: () => { void handleUpdate(); } },
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [skill, status, refreshUpdates, dismissPushUpdate, toast]);

  useEffect(() => {
    if (!showChangelog) return;
    if (changelogDiff != null) return;
    if (!skill || !skill.latestVersion) return;
    let cancelled = false;
    setChangelogLoading(true);
    api.getVersionDiff(skill.plugin, skill.skill, skill.currentVersion ?? "", skill.latestVersion)
      .then((diff) => {
        if (!cancelled) setChangelogDiff(diff);
      })
      .catch(() => {
        if (!cancelled) setChangelogDiff(null);
      })
      .finally(() => {
        if (!cancelled) setChangelogLoading(false);
      });
    return () => { cancelled = true; };
  }, [showChangelog, changelogDiff, skill?.plugin, skill?.skill, skill?.latestVersion, skill?.currentVersion, skill]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  if (!skill) return null;
  if (skill.updateAvailable !== true) return null;

  const latest = skill.latestVersion;
  const buttonLabel =
    status === "updating"
      ? "Updating…"
      : latest
        ? `Update to ${latest}`
        : "Update";
  const disabled = status === "updating";

  return (
    <div
      data-testid="update-action"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "12px 16px",
        borderTop: "1px solid var(--border-default)",
        borderBottom: "1px solid var(--border-default)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          data-testid="update-action-button"
          onClick={() => { void handleUpdate(); }}
          disabled={disabled}
          style={{
            height: 36,
            padding: "0 14px",
            background: "var(--color-ink)",
            color: "var(--color-paper)",
            border: "none",
            borderRadius: 4,
            cursor: disabled ? "not-allowed" : "pointer",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {buttonLabel}
        </button>
        <button
          type="button"
          data-testid="update-action-toggle-changelog"
          onClick={() => setShowChangelog((v) => !v)}
          disabled={disabled || !latest}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {showChangelog ? "Hide changelog" : "Preview changelog"}
        </button>
      </div>
      {status === "updating" && (
        <div
          data-testid="update-action-progress"
          role="status"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-muted, var(--text-secondary))",
          }}
        >
          Updating…
        </div>
      )}
      {errorMsg && status !== "updating" && (
        <div
          data-testid="update-action-error"
          role="alert"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-error, #d32f2f)",
          }}
        >
          {errorMsg}
        </div>
      )}
      {showChangelog && latest && (
        <div data-testid="update-action-changelog" style={{ paddingTop: 8 }}>
          {changelogLoading && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Loading changelog…</div>
          )}
          {!changelogLoading && changelogDiff && (
            <ChangelogViewer
              contentDiff={changelogDiff.contentDiff}
              fromLabel={changelogDiff.from}
              toLabel={changelogDiff.to}
              diffSummary={changelogDiff.diffSummary ?? undefined}
              renderContext="inline"
            />
          )}
          {!changelogLoading && !changelogDiff && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Couldn't load changelog.</div>
          )}
        </div>
      )}
    </div>
  );
}
