import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { useStudio } from "../../StudioContext";
import { api } from "../../api";
import { useSWR, mutate } from "../../hooks/useSWR";
import { ChangelogViewer } from "../../components/ChangelogViewer";
import { buildSubmitUrl } from "../../utils/submit-url";
import { formatTierLabel } from "../../components/FindSkillsPalette/components/TierBadge";
import type { VersionEntry, VersionDiff } from "../../types";

const CERT_COLORS: Record<string, { bg: string; text: string }> = {
  CERTIFIED: { bg: "var(--yellow-muted)", text: "var(--yellow)" },
  VERIFIED: { bg: "var(--accent-muted)", text: "var(--accent)" },
  COMMUNITY: { bg: "var(--surface-3)", text: "var(--text-tertiary)" },
};

function truncate(s: string | null, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function VersionHistoryPanel() {
  const { state } = useWorkspace();
  const { plugin, skill } = state;
  const studio = useStudio();
  const { refreshSkills, updateCount } = studio;
  // 0729: lookup the SkillInfo so the empty state can branch on origin and
  // build a submit URL pre-filled with the skill's repoUrl/homepage.
  const skillInfo = useMemo(
    () => studio.state.skills.find((s) => s.plugin === plugin && s.skill === skill) ?? null,
    [studio.state.skills, plugin, skill],
  );

  // Fetch versions
  const swrKey = `versions/${plugin}/${skill}`;
  const fetcher = useCallback(() => api.getSkillVersions(plugin, skill), [plugin, skill]);
  const { data: versions, loading } = useSWR<VersionEntry[]>(swrKey, fetcher);

  // Selection state
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);

  // Diff state
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Update state (T-006)
  // 0736 GR-001: migrated from EventSource side-channel to single POST.
  // The old api.startSkillUpdate(plugin, skill) issued a GET to a POST-only
  // endpoint and reproduced the ERR_CONNECTION_REFUSED bug 0736 fixed for
  // the skill detail page. Now uses api.postSkillUpdate, mirroring
  // UpdateAction.tsx and UpdatesPanel.tsx semantics.
  const [updateStatus, setUpdateStatus] = useState<"idle" | "updating" | "scanning" | "installing" | "done" | "error">("idle");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Pagination sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);

  const installed = useMemo(() => versions?.find((v) => v.isInstalled) ?? null, [versions]);
  const latest = useMemo(() => versions?.[0] ?? null, [versions]);
  const showAutoLink = installed && latest && installed.version !== latest.version;

  const handleVersionClick = useCallback((version: string) => {
    if (!selectedA) {
      setSelectedA(version);
      setDiff(null);
    } else if (!selectedB && version !== selectedA) {
      setSelectedB(version);
    } else {
      setSelectedA(version);
      setSelectedB(null);
      setDiff(null);
    }
  }, [selectedA, selectedB]);

  // Fetch diff when both selected
  const fetchDiff = useCallback(async (from: string, to: string) => {
    setDiffLoading(true);
    try {
      const result = await api.getVersionDiff(plugin, skill, from, to);
      setDiff(result);
    } catch {
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  }, [plugin, skill]);

  useEffect(() => {
    if (selectedA && selectedB) {
      // Always diff older→newer
      const vList = versions || [];
      const idxA = vList.findIndex((v) => v.version === selectedA);
      const idxB = vList.findIndex((v) => v.version === selectedB);
      const [from, to] = idxA > idxB ? [selectedA, selectedB] : [selectedB, selectedA];
      fetchDiff(from, to);
    }
  }, [selectedA, selectedB, versions, fetchDiff]);

  const handleAutoLink = useCallback(() => {
    if (!installed || !latest) return;
    setSelectedA(installed.version);
    setSelectedB(latest.version);
  }, [installed, latest]);

  // T-006 (0736 GR-001 migration): Update handler — single POST, no SSE.
  // The backend still streams SSE frames in its response body, but
  // api.postSkillUpdate awaits res.text() and parses the trailing "done"
  // event, so the caller sees a final {ok, status, body, version} result.
  // Aborting on unmount prevents stale state writes.
  const handleUpdate = useCallback(async () => {
    setUpdateStatus("updating");
    setUpdateError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await api.postSkillUpdate(plugin, skill, controller.signal);

      if (result.ok) {
        setUpdateStatus("done");
        refreshSkills();
        mutate(swrKey);
      } else {
        const msg = `Update failed (HTTP ${result.status}): ${result.body || "no response body"}`;
        setUpdateStatus("error");
        setUpdateError(msg);
      }
    } catch (err) {
      // Aborted on unmount — caller is gone, no UI to update.
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const errMsg = err instanceof Error ? err.message : "Network error";
      setUpdateStatus("error");
      setUpdateError(errMsg);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [plugin, skill, swrKey, refreshSkills]);

  // Cleanup in-flight request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-5">
        <div className="skeleton h-5 w-40 mb-4" />
        <div className="space-y-3">
          <div className="skeleton h-14 rounded-lg" />
          <div className="skeleton h-14 rounded-lg" />
          <div className="skeleton h-14 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    // 0729: source-origin skills get an actionable empty state with a CTA
    // pointing at verified-skill.com/submit. Anything else (installed plugin /
    // global skills the user doesn't author) keeps the legacy minimal line.
    const isSource = skillInfo?.origin === "source";
    if (isSource) {
      const submitUrl = buildSubmitUrl(skillInfo?.homepage ?? null);
      return (
        <div
          className="flex flex-col items-center justify-center h-full py-16 px-8"
          data-testid="versions-empty-state-local"
        >
          <div
            className="text-[14px] font-semibold mb-2"
            style={{ color: "var(--text-primary)" }}
          >
            No published versions yet
          </div>
          <div
            className="text-[13px] text-center mb-5 max-w-md"
            style={{ color: "var(--text-tertiary)", lineHeight: 1.5 }}
          >
            This skill is local-only — the version history shown here is sourced from
            verified-skill.com. Submit your skill to start tracking versions and share
            it with others.
          </div>
          <a
            href={submitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary text-[12px]"
            data-testid="versions-empty-state-cta"
          >
            Submit on verified-skill.com
          </a>
        </div>
      );
    }
    // Installed skill, no upstream registry entry, but the on-disk SKILL.md
    // carries a frontmatter version. Render that as a single local-only
    // timeline entry so the tab matches the header / sidebar version label
    // instead of pretending no version exists.
    if (skillInfo?.version) {
      return (
        <div className="p-5">
          <div className="text-[14px] font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
            Version History
          </div>
          <div className="relative">
            <div
              className="absolute left-3 top-0 bottom-0"
              style={{ width: 2, background: "var(--border-subtle)" }}
            />
            <div
              data-testid="version-row-local"
              className="w-full text-left pl-8 pr-4 py-3 relative rounded-lg"
              style={{ background: "transparent", border: "1px solid transparent" }}
            >
              <span
                className="absolute left-1.5 top-4 rounded-full"
                style={{
                  width: 10,
                  height: 10,
                  background: "var(--accent)",
                  border: "2px solid var(--accent)",
                }}
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    {skillInfo.version}
                  </span>
                  <span
                    className="text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}
                  >
                    LOCAL
                  </span>
                  <span
                    className="text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
                  >
                    installed
                  </span>
                </div>
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>
                Local-only — this skill is not registered on verified-skill.com, so no upstream history is available.
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div
        className="flex flex-col items-center justify-center h-full py-16"
        data-testid="versions-empty-state-installed"
      >
        <div className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          No version history available
        </div>
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Version History
        </div>
        <div className="flex items-center gap-2">
          {showAutoLink && (
            <button onClick={handleAutoLink} className="btn btn-secondary text-[11px]">
              View changes since installed
            </button>
          )}
          {showAutoLink && updateStatus !== "done" && (
            updateStatus === "error" ? (
              <span className="flex items-center gap-1.5">
                <span className="text-[11px]" style={{ color: "var(--red)" }}>
                  {updateError || "Update failed"}
                </span>
                <button onClick={handleUpdate} className="btn btn-secondary text-[11px]">
                  Retry
                </button>
              </span>
            ) : (
              <button
                onClick={handleUpdate}
                disabled={updateStatus !== "idle"}
                className="btn btn-primary text-[11px]"
              >
                {updateStatus === "idle"
                  ? `Update to ${latest?.version}`
                  : updateStatus === "updating"
                    ? "Starting update..."
                    : updateStatus === "scanning"
                      ? "Scanning..."
                      : "Installing..."}
              </button>
            )
          )}
          {updateCount > 1 && (
            <button
              onClick={() => { window.location.hash = "#/updates"; }}
              className="text-[11px] hover:underline"
              style={{ color: "var(--text-tertiary)", background: "transparent", border: "none", cursor: "pointer" }}
            >
              Manage all updates ({updateCount})
            </button>
          )}
        </div>
      </div>

      {/* Compare hint */}
      {selectedA && !selectedB && (
        <div className="text-[11px] mb-3 px-3 py-2 rounded-lg" style={{ background: "var(--accent-muted)", color: "var(--accent)" }}>
          Click another version to compare with {selectedA}
        </div>
      )}

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div
          className="absolute left-3 top-0 bottom-0"
          style={{ width: 2, background: "var(--border-subtle)" }}
        />

        <div className="space-y-1">
          {versions.map((v) => {
            const certStyle = CERT_COLORS[v.certTier] || CERT_COLORS.COMMUNITY;
            const isSelected = v.version === selectedA || v.version === selectedB;
            const isInstalled = v.isInstalled;

            return (
              <button
                key={v.version}
                onClick={() => handleVersionClick(v.version)}
                className="w-full text-left pl-8 pr-4 py-3 relative rounded-lg transition-all duration-150"
                style={{
                  background: isSelected ? "var(--accent-muted)" : "transparent",
                  border: isSelected ? "1px solid var(--accent)" : "1px solid transparent",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--surface-1)"; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
              >
                {/* Timeline dot */}
                <span
                  className="absolute left-1.5 top-4 rounded-full"
                  style={{
                    width: isInstalled ? 10 : 8,
                    height: isInstalled ? 10 : 8,
                    background: isInstalled ? "var(--accent)" : "var(--surface-3)",
                    border: isInstalled ? "2px solid var(--accent)" : "2px solid var(--border-default)",
                  }}
                />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                      {v.version}
                    </span>
                    <span
                      className="text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{ background: certStyle.bg, color: certStyle.text }}
                    >
                      {formatTierLabel(v.certTier)}
                    </span>
                    {isInstalled && (
                      <span
                        className="text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                        style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
                      >
                        installed
                      </span>
                    )}
                  </div>
                  <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {new Date(v.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {v.diffSummary && (
                  <div className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>
                    {truncate(v.diffSummary, 80)}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Pagination sentinel */}
        <div ref={sentinelRef} style={{ height: 1 }} />
      </div>

      {/* Diff viewer */}
      {diffLoading && (
        <div className="mt-4">
          <div className="skeleton h-48 rounded-xl" />
        </div>
      )}
      {diff && !diffLoading && (
        <div className="mt-4">
          <ChangelogViewer
            contentDiff={diff.contentDiff}
            fromLabel={diff.from}
            toLabel={diff.to}
            diffSummary={diff.diffSummary}
            renderContext="inline"
            onRetry={() => selectedA && selectedB && fetchDiff(
              diff.from, diff.to,
            )}
          />
        </div>
      )}
    </div>
  );
}
