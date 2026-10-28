import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { api } from "../api";
import type { SkillUpdateInfo } from "../api";
import type { BatchUpdateProgress, VersionDiff } from "../types";
import { ChangelogViewer } from "../components/ChangelogViewer";

function classifyBump(installed: string, latest: string): "major" | "minor" | "patch" {
  const [iMaj, iMin] = installed.split(".").map(Number);
  const [lMaj, lMin] = latest.split(".").map(Number);
  if (lMaj > iMaj) return "major";
  if (lMin > iMin) return "minor";
  return "patch";
}

const BUMP_COLORS: Record<string, { bg: string; text: string }> = {
  major: { bg: "var(--red-muted)", text: "var(--red)" },
  minor: { bg: "var(--yellow-muted)", text: "var(--yellow)" },
  patch: { bg: "var(--green-muted)", text: "var(--green)" },
};

interface UpdateItem extends SkillUpdateInfo {
  pinned?: boolean;
  pinnedVersion?: string;
}

// P2-9: use the server's local fs identifiers, falling back to the name.
function localIds(skill: UpdateItem): { plugin: string; skillName: string } {
  const parts = skill.name.split("/");
  return {
    plugin: skill.localPlugin ?? (parts.length >= 3 ? parts[parts.length - 2] : parts[0]),
    skillName: skill.localSkill ?? parts[parts.length - 1],
  };
}

export function UpdatesPanel() {
  const [updates, setUpdates] = useState<UpdateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<Map<string, BatchUpdateProgress>>(new Map());
  const [batchRunning, setBatchRunning] = useState(false);
  const [singleUpdating, setSingleUpdating] = useState<Set<string>>(new Set());
  const [singleErrors, setSingleErrors] = useState<Map<string, string>>(new Map());
  const [toast, setToastState] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState<Set<string>>(new Set());
  // P2-9: one timer for the toast, cleared on unmount.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setToast = useCallback((msg: string | null) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState(msg);
    if (msg) toastTimer.current = setTimeout(() => setToastState(null), 5000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const [changelogDiff, setChangelogDiff] = useState<{ skill: UpdateItem; diff: VersionDiff } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // 1126 P1-6: a failed check is shown as an error with Retry, never as
  // "All skills are up to date".
  const fetchUpdates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getSkillUpdates({ throwOnError: true });
      setUpdates(data.filter((u) => u.updateAvailable));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUpdates(); }, [fetchUpdates]);

  const selectableUpdates = useMemo(
    () => updates.filter((u) => !u.pinned),
    [updates],
  );

  const handleToggle = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selected.size === selectableUpdates.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableUpdates.map((u) => u.name)));
    }
  }, [selected, selectableUpdates]);

  // 1126 P0-2: batch update reads the POST's SSE stream and updates each row
  // from skill:start / skill:done / skill:skipped / skill:error.
  const handleBatchUpdate = useCallback(async () => {
    const skills = [...selected];
    if (!skills.length) return;
    setBatchRunning(true);
    setBatchProgress(new Map(skills.map((s) => [s, { skill: s, status: "pending" as const }])));
    const setRow = (p: BatchUpdateProgress) =>
      setBatchProgress((prev) => new Map(prev).set(p.skill, p));
    try {
      const summary = await api.runBatchUpdate(skills, {
        onEvent: (e) => {
          if (e.type === "start") setRow({ skill: e.skill, status: "updating" });
          else if (e.type === "done") {
            setRow({ skill: e.skill, status: "done", fromVersion: e.fromVersion, toVersion: e.version });
          } else if (e.type === "skipped") {
            setRow({
              skill: e.skill,
              status: "skipped",
              error: e.reason === "pinned" && e.pinnedVersion ? `pinned at ${e.pinnedVersion}` : e.message,
            });
          } else setRow({ skill: e.skill, status: "error", error: e.error });
        },
      });
      const parts = [`Updated ${summary.updated}`];
      if (summary.skipped) parts.push(`${summary.skipped} skipped`);
      parts.push(`${summary.failed} failed`);
      setToast(summary.incomplete ? `${parts.join(", ")} (connection closed early)` : parts.join(", "));
      if (summary.updated > 0) fetchUpdates();
    } catch (err) {
      setToast(`Batch update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBatchRunning(false);
    }
  }, [selected, fetchUpdates, setToast]);

  // Single skill update — POST (same as UpdateAction.tsx). 1126 P0-1/P1-4:
  // the result is read from the stream's `done` frame, so failures and pinned
  // skips are shown as such.
  const handleSingleUpdate = useCallback(async (skill: UpdateItem) => {
    const { plugin, skillName } = localIds(skill);

    setSingleUpdating((prev) => new Set(prev).add(skill.name));
    setSingleErrors((prev) => { const next = new Map(prev); next.delete(skill.name); return next; });

    try {
      const result = await api.postSkillUpdate(plugin, skillName);
      if (result.skipped) {
        const msg = result.skipReason === "pinned"
          ? `Pinned at ${result.pinnedVersion ?? skill.installed}; unpin it to update.`
          : result.body;
        setSingleErrors((prev) => new Map(prev).set(skill.name, msg));
        setToast(`${skillName} was not updated: ${msg}`);
        fetchUpdates();
      } else if (!result.ok) {
        const http = result.status !== 200 ? ` (HTTP ${result.status})` : "";
        const msg = `Update failed${http}${result.body ? `: ${result.body}` : ""}`;
        setSingleErrors((prev) => new Map(prev).set(skill.name, msg));
        setToast(`Couldn't update ${skillName}: ${result.body || `HTTP ${result.status}`}`);
      } else {
        setToast(result.version ? `Updated ${skillName} to ${result.version}` : `Updated ${skillName}`);
        fetchUpdates();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setSingleErrors((prev) => new Map(prev).set(skill.name, msg));
      setToast(`Couldn't update ${skillName} — ${msg}`);
    } finally {
      setSingleUpdating((prev) => {
        const next = new Set(prev);
        next.delete(skill.name);
        return next;
      });
    }
  }, [fetchUpdates, setToast]);

  // 1126 P1-3: pin / unpin from the list.
  const handleTogglePin = useCallback(async (skill: UpdateItem) => {
    const { plugin, skillName } = localIds(skill);
    setPinBusy((prev) => new Set(prev).add(skill.name));
    try {
      if (skill.pinned) {
        await api.unpinSkill(plugin, skillName);
        setToast(`Unpinned ${skillName}`);
      } else {
        const state = await api.pinSkill(plugin, skillName);
        setToast(`Pinned ${skillName} at ${state.pinnedVersion ?? skill.installed}`);
        setSelected((prev) => { const next = new Set(prev); next.delete(skill.name); return next; });
      }
      fetchUpdates();
    } catch (err) {
      setToast(`Couldn't change the pin on ${skillName}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPinBusy((prev) => { const next = new Set(prev); next.delete(skill.name); return next; });
    }
  }, [fetchUpdates, setToast]);

  // View Changes → load diff in modal
  const handleViewChanges = useCallback(async (skill: UpdateItem) => {
    if (!skill.latest) return;
    const parts = skill.name.split("/");
    const plugin = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
    const skillName = parts[parts.length - 1];

    setDiffLoading(true);
    try {
      const diff = await api.getVersionDiff(plugin, skillName, skill.installed, skill.latest);
      setChangelogDiff({ skill, diff });
    } catch {
      setChangelogDiff(null);
    } finally {
      setDiffLoading(false);
    }
  }, []);

  // Loading state
  if (loading) {
    return (
      <div data-testid="updates-panel" className="p-6">
        <div className="skeleton h-6 w-48 mb-4" />
        <div className="space-y-3">
          <div className="skeleton h-16 rounded-lg" />
          <div className="skeleton h-16 rounded-lg" />
        </div>
      </div>
    );
  }

  // 1126 P1-6: error state with Retry.
  if (loadError) {
    return (
      <div data-testid="updates-panel" className="flex flex-col items-center justify-center h-full py-16 px-8">
        <div className="text-[15px] font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          Couldn't check for updates
        </div>
        <div
          data-testid="updates-panel-error"
          role="alert"
          className="text-[12px] mb-4 text-center max-w-md"
          style={{ color: "var(--red)", fontFamily: "var(--font-mono)" }}
        >
          {loadError}
        </div>
        <button onClick={fetchUpdates} className="btn btn-primary text-[12px]" data-testid="updates-panel-retry">
          Retry
        </button>
      </div>
    );
  }

  // Empty state
  if (updates.length === 0) {
    return (
      <div data-testid="updates-panel" className="flex flex-col items-center justify-center h-full py-16">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-4">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <div className="text-[15px] font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          All skills are up to date
        </div>
        <div className="text-[12px] mb-4" style={{ color: "var(--text-tertiary)" }}>
          No updates available for installed skills.
        </div>
        <button onClick={fetchUpdates} className="btn btn-secondary text-[12px]">
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div data-testid="updates-panel" className="p-6">
      {/* Toast notification */}
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-[13px] font-medium animate-fade-in"
          style={{ background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}
        >
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="text-[16px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Available Updates ({selectableUpdates.length})
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchUpdates} className="btn btn-ghost text-[12px]" disabled={batchRunning}>
            Refresh
          </button>
          <button
            onClick={handleBatchUpdate}
            disabled={selected.size === 0 || batchRunning}
            className="btn btn-primary text-[12px]"
          >
            {batchRunning ? "Updating..." : `Update Selected (${selected.size})`}
          </button>
        </div>
      </div>

      {/* Select All */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={handleSelectAll}
          className="flex items-center gap-2 text-[12px] font-medium"
          style={{ color: "var(--text-secondary)", background: "transparent", border: "none", cursor: "pointer" }}
        >
          <span
            className="w-4 h-4 rounded border flex items-center justify-center"
            style={{
              borderColor: selected.size === selectableUpdates.length && selectableUpdates.length > 0 ? "var(--accent)" : "var(--border-default)",
              background: selected.size === selectableUpdates.length && selectableUpdates.length > 0 ? "var(--accent)" : "transparent",
            }}
          >
            {selected.size === selectableUpdates.length && selectableUpdates.length > 0 && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper)" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            )}
          </span>
          Select All
        </button>
      </div>

      {/* Skill rows */}
      <div className="space-y-2">
        {updates.map((skill) => {
          const shortName = skill.name.split("/").pop() || skill.name;
          const bump = skill.latest ? classifyBump(skill.installed, skill.latest) : "patch";
          const bumpStyle = BUMP_COLORS[bump];
          const isPinned = !!skill.pinned;
          const isUpdating = singleUpdating.has(skill.name);
          const batchState = batchProgress.get(skill.name);
          const isChecked = selected.has(skill.name);

          return (
            <div
              key={skill.name}
              className="rounded-lg px-4 py-3 transition-all duration-150"
              style={{
                background: "var(--surface-1)",
                border: "1px solid var(--border-subtle)",
                opacity: isPinned ? 0.7 : 1,
              }}
            >
              <div className="flex items-center gap-3">
                {/* Checkbox */}
                <button
                  onClick={() => !isPinned && handleToggle(skill.name)}
                  disabled={isPinned}
                  className="flex-shrink-0"
                  style={{ background: "transparent", border: "none", cursor: isPinned ? "not-allowed" : "pointer" }}
                >
                  <span
                    className="w-4 h-4 rounded border flex items-center justify-center"
                    style={{
                      borderColor: isChecked ? "var(--accent)" : "var(--border-default)",
                      background: isChecked ? "var(--accent)" : "transparent",
                      opacity: isPinned ? 0.4 : 1,
                    }}
                  >
                    {isChecked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper)" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                  </span>
                </button>

                {/* Skill info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                      {shortName}
                    </span>
                    {isPinned && (
                      <span className="text-[10px]" title={`Pinned at ${skill.pinnedVersion || skill.installed}`}>📌</span>
                    )}
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{ background: bumpStyle.bg, color: bumpStyle.text }}
                    >
                      {bump}
                    </span>
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {skill.installed} → {skill.latest || "?"}
                    {isPinned && ` (pinned at ${skill.pinnedVersion || skill.installed})`}
                  </div>
                </div>

                {/* Batch progress indicator */}
                {batchState && (
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{
                      background: batchState.status === "done" ? "var(--green-muted)" :
                                  batchState.status === "error" ? "var(--red-muted)" :
                                  batchState.status === "skipped" ? "var(--surface-3)" :
                                  "var(--yellow-muted)",
                      color: batchState.status === "done" ? "var(--green)" :
                             batchState.status === "error" ? "var(--red)" :
                             batchState.status === "skipped" ? "var(--text-secondary)" :
                             "var(--yellow)",
                    }}
                  >
                    {batchState.status}
                    {batchState.status === "done" && batchState.toVersion && ` ${batchState.toVersion}`}
                    {batchState.error && `: ${batchState.error}`}
                  </span>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleTogglePin(skill)}
                    disabled={pinBusy.has(skill.name) || batchRunning}
                    className="btn btn-ghost text-[11px]"
                    data-testid="updates-panel-pin-toggle"
                    title={isPinned ? "Unpin so this skill can update" : `Pin at ${skill.installed}`}
                  >
                    {isPinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    onClick={() => handleViewChanges(skill)}
                    className="btn btn-ghost text-[11px]"
                    disabled={diffLoading}
                  >
                    View Changes
                  </button>
                  <button
                    onClick={() => handleSingleUpdate(skill)}
                    disabled={isPinned || isUpdating || batchRunning}
                    title={isPinned ? `Pinned at ${skill.pinnedVersion || skill.installed}` : ""}
                    className={`btn ${isPinned ? "btn-ghost" : "btn-primary"} text-[11px]`}
                  >
                    {isUpdating ? (
                      <span className="flex items-center gap-1">
                        <span className="spinner spinner-sm" /> Updating
                      </span>
                    ) : batchState?.status === "done" ? (
                      <span style={{ color: "var(--green)" }}>✓</span>
                    ) : isPinned ? (
                      `📌 ${skill.pinnedVersion || skill.installed}`
                    ) : (
                      "Update"
                    )}
                  </button>
                </div>
              </div>
              {singleErrors.get(skill.name) && (
                <div
                  data-testid="updates-panel-row-error"
                  role="alert"
                  className="text-[11px] mt-2"
                  style={{ color: "var(--red)", fontFamily: "var(--font-mono)" }}
                >
                  {singleErrors.get(skill.name)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Changelog modal */}
      {changelogDiff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          // eslint-disable-next-line vskill/no-raw-color -- intentional: modal scrim needs constant opaque overlay independent of theme
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setChangelogDiff(null)}
        >
          <div style={{ width: "80%", maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button
                onClick={() => setChangelogDiff(null)}
                className="btn btn-ghost text-[12px]"
              >
                Close
              </button>
            </div>
            <ChangelogViewer
              contentDiff={changelogDiff.diff.contentDiff}
              fromLabel={changelogDiff.diff.from}
              toLabel={changelogDiff.diff.to}
              diffSummary={changelogDiff.diff.diffSummary}
              renderContext="inline"
            />
          </div>
        </div>
      )}
    </div>
  );
}
