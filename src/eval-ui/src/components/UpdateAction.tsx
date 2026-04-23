import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStudio } from "../StudioContext";
import type { SkillInfo, VersionDiff } from "../types";
import { useOptimisticAction } from "../hooks/useOptimisticAction";
import { useToast } from "./ToastProvider";
import { ChangelogViewer } from "./ChangelogViewer";

interface Props {
  skill: SkillInfo | null;
}

type ActionStatus = "idle" | "updating" | "done" | "error";
interface Snapshot {
  status: ActionStatus;
}

const SSE_TIMEOUT_MS = 60_000;

/**
 * 0683 T-009: "Update to X.Y.Z" CTA rendered inside the `RightPanel` Overview
 * tab when the selected skill has an outstanding update. Wraps the existing
 * single-skill SSE update API in a Promise that resolves on `done` and
 * rejects on `error` / `TIMEOUT`, then drives it through
 * `useOptimisticAction` for rollback + retry + toast semantics.
 *
 * Renders `null` when the skill is null, or when `skill.updateAvailable` is
 * not `true`.
 */
export function UpdateAction({ skill }: Props) {
  const { refreshUpdates } = useStudio();
  const { toast } = useToast();
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [progressStatus, setProgressStatus] = useState<string | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [changelogDiff, setChangelogDiff] = useState<VersionDiff | null>(null);
  const [changelogLoading, setChangelogLoading] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSSE = useCallback((): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      if (!skill) {
        reject(new Error("No skill selected"));
        return;
      }
      const es = api.startSkillUpdate(skill.plugin, skill.skill);
      esRef.current = es;
      const cleanup = () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        try { es.close(); } catch { /* noop */ }
        esRef.current = null;
      };
      timeoutRef.current = setTimeout(() => {
        cleanup();
        reject(new Error("TIMEOUT"));
      }, SSE_TIMEOUT_MS);
      es.addEventListener("progress", (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data);
          if (typeof data?.status === "string") setProgressStatus(data.status);
        } catch { /* silent */ }
      });
      es.addEventListener("done", () => {
        cleanup();
        setStatus("done");
        setProgressStatus(null);
        void refreshUpdates();
        toast({ message: `Updated ${skill.skill}.`, severity: "success", durationMs: 4000 });
        resolve();
      });
      es.addEventListener("error", (evt: MessageEvent) => {
        cleanup();
        let message = "Stream error";
        try {
          const data = typeof evt.data === "string" ? JSON.parse(evt.data) : null;
          if (data?.error) message = String(data.error);
        } catch { /* keep default */ }
        reject(new Error(message));
      });
    });
  }, [skill, refreshUpdates, toast]);

  const action = useOptimisticAction<[], Snapshot>({
    snapshot: () => ({ status }),
    apply: () => {
      setStatus("updating");
      setProgressStatus("updating");
    },
    commit: () => runSSE(),
    rollback: (snap) => {
      setStatus(snap.status === "updating" ? "idle" : snap.status);
      setProgressStatus(null);
    },
    failureMessage: (err) =>
      `Couldn't update ${skill?.skill ?? "skill"} — ${(err as Error).message}`,
    timeoutMs: SSE_TIMEOUT_MS + 1000,
  });

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

  // Cleanup SSE on unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (esRef.current) {
        try { esRef.current.close(); } catch { /* noop */ }
      }
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
          onClick={() => { void action.run(); }}
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
      {progressStatus && (
        <div
          data-testid="update-action-progress"
          role="status"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-muted, var(--text-secondary))",
          }}
        >
          {progressStatus}
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
