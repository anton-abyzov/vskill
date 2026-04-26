import { useState, useEffect, useCallback, useMemo } from "react";
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

export function UpdatesPanel() {
  const [updates, setUpdates] = useState<UpdateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<Map<string, BatchUpdateProgress>>(new Map());
  const [batchRunning, setBatchRunning] = useState(false);
  const [singleUpdating, setSingleUpdating] = useState<Set<string>>(new Set());
  const [singleErrors, setSingleErrors] = useState<Map<string, string>>(new Map());
  const [toast, setToast] = useState<string | null>(null);
  const [changelogDiff, setChangelogDiff] = useState<{ skill: UpdateItem; diff: VersionDiff } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const fetchUpdates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getSkillUpdates();
      setUpdates(data.filter((u) => u.updateAvailable));
    } catch {
      setUpdates([]);
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

  // Batch update via SSE
  const handleBatchUpdate = useCallback(() => {
    const skills = [...selected];
    if (!skills.length) return;
    setBatchRunning(true);
    setBatchProgress(new Map(skills.map((s) => [s, { skill: s, status: "pending" as const }])));

    const es = api.startBatchUpdate(skills);

    es.addEventListener("progress", (evt: MessageEvent) => {
      try {
        const data: BatchUpdateProgress = JSON.parse(evt.data);
        setBatchProgress((prev) => new Map(prev).set(data.skill, data));
      } catch {}
    });

    es.addEventListener("done", (evt: MessageEvent) => {
      es.close();
      setBatchRunning(false);
      try {
        const data = JSON.parse(evt.data);
        setToast(`Updated ${data.updated ?? 0} skills, ${data.failed ?? 0} failed`);
        setTimeout(() => setToast(null), 5000);
      } catch {}
      fetchUpdates();
    });

    es.addEventListener("error", () => {
      es.close();
      setBatchRunning(false);
      setToast("Batch update failed");
      setTimeout(() => setToast(null), 5000);
    });
  }, [selected, fetchUpdates]);

  // Single skill update — uses POST (same as UpdateAction.tsx), not the broken EventSource path.
  const handleSingleUpdate = useCallback(async (skill: UpdateItem) => {
    const parts = skill.name.split("/");
    const plugin = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
    const skillName = parts[parts.length - 1];

    setSingleUpdating((prev) => new Set(prev).add(skill.name));
    setSingleErrors((prev) => { const next = new Map(prev); next.delete(skill.name); return next; });

    try {
      const result = await api.postSkillUpdate(plugin, skillName);
      if (!result.ok) {
        const msg = `Update failed (HTTP ${result.status}): ${result.body}`;
        setSingleErrors((prev) => new Map(prev).set(skill.name, msg));
        setToast(`Couldn't update ${skillName} — HTTP ${result.status}`);
        setTimeout(() => setToast(null), 5000);
      } else {
        fetchUpdates();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setSingleErrors((prev) => new Map(prev).set(skill.name, msg));
      setToast(`Couldn't update ${skillName} — ${msg}`);
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSingleUpdating((prev) => {
        const next = new Set(prev);
        next.delete(skill.name);
        return next;
      });
    }
  }, [fetchUpdates]);

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
                      <span className="text-[10px]" title="Pinned — unpin from CLI to update">📌</span>
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
                                  "var(--yellow-muted)",
                      color: batchState.status === "done" ? "var(--green)" :
                             batchState.status === "error" ? "var(--red)" :
                             "var(--yellow)",
                    }}
                  >
                    {batchState.status}
                    {batchState.error && `: ${batchState.error}`}
                  </span>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
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
                    title={isPinned ? "Pinned — unpin from CLI to update" : ""}
                    className={`btn ${isPinned ? "btn-ghost" : "btn-primary"} text-[11px]`}
                  >
                    {isUpdating ? (
                      <span className="flex items-center gap-1">
                        <span className="spinner spinner-sm" /> Updating
                      </span>
                    ) : batchState?.status === "done" ? (
                      <span style={{ color: "var(--green)" }}>✓</span>
                    ) : (
                      "Update"
                    )}
                  </button>
                </div>
              </div>
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
