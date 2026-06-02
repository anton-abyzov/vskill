import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AgentInstallResult,
  MultiInstallResult,
  SupportedAgent,
} from "../types";
import type { InstallStateResponse } from "../types/install-state";
import {
  fetchSupportedAgents,
  groupSupportedAgentsByTier,
  installToAgents,
  startInstallStream,
} from "../api/install";
import { removeSkillFromAgents, type RemoveSkillResponse } from "../api/remove";
import { api } from "../api";
import { ClipboardExportDialog } from "./ClipboardExportDialog";

// ---------------------------------------------------------------------------
// 0845 T-019 + T-020 + T-021 — InstallTargetsModal
//
// Tier-grouped checkbox modal for installing one skill to N tools at once.
// Sections:
//   - Drop-in           (Tier 1, filesystem)
//   - Format-converted  (Tier 2, filesystem)
//   - Cloud only (paste required) (Tier 3, clipboard)
//
// Within each section, detected tools sort above undetected. Only the
// currently active tool is pre-checked on open. Quick actions: Select all
// detected / Clear. Install button is disabled when 0 rows selected.
//
// Submit fires POST /api/studio/install-skill with the agentIds[] payload,
// then consumes the SSE stream. Per-agent rows update live with status
// pills. When the stream ends, any Tier 3 result with an "exported" blob
// triggers a ClipboardExportDialog (one per target, sequentially).
//
// Cancel closes the modal without firing any API call or mutating state
// (AC-US2-08).
// ---------------------------------------------------------------------------

export type InstallScope = "project" | "user";

export interface InstallTargetsModalProps {
  skill: string;
  skillDisplayName?: string;
  scope: InstallScope;
  /** 0850 — currently selected registry version. Drives the install-state
   *  badge variants (Installed v / Update v / Newer v). */
  targetVersion?: string | null;
  activeAgentId?: string | null;
  /** Optional set of agent ids that should start pre-checked, in addition
   *  to the active agent (e.g. when launched from the `+ Install here`
   *  CTA on the AgentScopePicker). */
  preCheckedAgentIds?: string[];
  onClose: () => void;
  onSuccess?: (results: AgentInstallResult[]) => void;
  /** Test-injectable hooks. */
  fetchSupportedAgentsImpl?: typeof fetchSupportedAgents;
  installToAgentsImpl?: typeof installToAgents;
  startInstallStreamImpl?: typeof startInstallStream;
  fetchInstallStateImpl?: (skill: string) => Promise<InstallStateResponse>;
  removeSkillImpl?: typeof removeSkillFromAgents;
  writeClipboardImpl?: (text: string) => Promise<void>;
}

/** 0850 — per-agent install-state badge variants. */
type InstallStateBadge =
  | { kind: "not-installed" }
  | { kind: "installed-current"; version: string | null }
  | { kind: "update-available"; installed: string; target: string }
  | { kind: "newer-installed"; installed: string; target: string }
  | { kind: "installed-other-scope"; otherScope: "project" | "user"; version: string | null };

function compareSemverLoose(a: string, b: string): number {
  // Loose semver compare — splits on dot, compares numerically per segment.
  // Unknown/non-numeric segments compare as 0. Good enough for badge UX.
  const pa = a.split(/[.-]/).map((s) => Number.parseInt(s, 10));
  const pb = b.split(/[.-]/).map((s) => Number.parseInt(s, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function deriveBadge(
  agentId: string,
  scope: InstallScope,
  installState: InstallStateResponse | null,
  targetVersion: string | null | undefined,
): InstallStateBadge {
  if (!installState || !installState.scopes) return { kind: "not-installed" };
  const otherScopeKey = scope === "project" ? "user" : "project";
  const thisScope = installState.scopes[scope];
  const otherScope = installState.scopes[otherScopeKey];
  if (!thisScope || !otherScope) return { kind: "not-installed" };
  const inThisScope = thisScope.installed && thisScope.installedAgentTools.includes(agentId);
  const inOtherScope = otherScope.installed && otherScope.installedAgentTools.includes(agentId);
  if (!inThisScope) {
    if (inOtherScope) {
      return {
        kind: "installed-other-scope",
        otherScope: otherScopeKey,
        version: otherScope.version,
      };
    }
    return { kind: "not-installed" };
  }
  const installed = thisScope.version;
  if (!installed || !targetVersion) {
    return { kind: "installed-current", version: installed };
  }
  const cmp = compareSemverLoose(installed, targetVersion);
  if (cmp === 0) return { kind: "installed-current", version: installed };
  if (cmp < 0) return { kind: "update-available", installed, target: targetVersion };
  return { kind: "newer-installed", installed, target: targetVersion };
}

type Phase = "loading" | "select" | "installing" | "done" | "error";

interface LiveResultMap {
  [agentId: string]: AgentInstallResult;
}

const ACTIVE_AGENT_INSTALL_ALIASES: Readonly<Record<string, string>> =
  Object.freeze({
    "claude-cli": "claude-code",
    "codex-cli": "codex",
  });

function normalizeActiveInstallAgentId(agentId: string | null | undefined): string | null {
  if (!agentId) return null;
  return ACTIVE_AGENT_INSTALL_ALIASES[agentId] ?? agentId;
}

function firstDetectedFilesystemAgentId(agents: SupportedAgent[]): string | null {
  return (
    agents.find((agent) => agent.detected && agent.installMode === "filesystem")?.id ??
    agents.find((agent) => agent.installMode === "filesystem")?.id ??
    null
  );
}

function statusLabel(status: AgentInstallResult["status"]): string {
  switch (status) {
    case "installed":
      return "Installed";
    case "exported":
      return "Exported";
    case "skipped":
      return "Skipped";
    case "error":
      return "Error";
  }
}

function statusColor(status: AgentInstallResult["status"]): string {
  switch (status) {
    case "installed":
      return "var(--color-ok, #22c55e)";
    case "exported":
      return "var(--accent-text, #3b82f6)";
    case "skipped":
      return "var(--text-tertiary)";
    case "error":
      return "var(--color-error, #dc2626)";
  }
}

export function InstallTargetsModal({
  skill,
  skillDisplayName,
  scope,
  targetVersion,
  activeAgentId,
  preCheckedAgentIds,
  onClose,
  onSuccess,
  fetchSupportedAgentsImpl,
  installToAgentsImpl,
  startInstallStreamImpl,
  fetchInstallStateImpl,
  removeSkillImpl,
  writeClipboardImpl,
}: InstallTargetsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [agents, setAgents] = useState<SupportedAgent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [installError, setInstallError] = useState<string | null>(null);
  const [results, setResults] = useState<LiveResultMap>({});
  // 0850 — per-agent install-state for badges + Remove links.
  const [installState, setInstallState] = useState<InstallStateResponse | null>(null);
  const [installStateNonce, setInstallStateNonce] = useState(0);
  const [removingAgents, setRemovingAgents] = useState<Set<string>>(new Set());
  const [pendingClipboardQueue, setPendingClipboardQueue] = useState<
    AgentInstallResult[]
  >([]);
  const [activeClipboard, setActiveClipboard] =
    useState<AgentInstallResult | null>(null);
  const streamHandleRef = useRef<{ close: () => void } | null>(null);

  // ESC closes only the top install surface. Capture + stopPropagation keeps
  // the underlying detail/settings dialogs from also handling the same key.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (activeClipboard) return;
      e.preventDefault();
      e.stopPropagation();
      if (phase === "installing") return;
      onClose();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [activeClipboard, phase, onClose]);

  // Fetch supported agents on mount.
  useEffect(() => {
    let cancelled = false;
    const fetcher = fetchSupportedAgentsImpl ?? fetchSupportedAgents;
    fetcher()
      .then((list) => {
        if (cancelled) return;
        setAgents(list);
        // AC-US2-03: only the currently-active tool is pre-checked.
        // The optional preCheckedAgentIds list (from the `+ Install here`
        // CTA) is unioned in so the AgentScopePicker can pre-select a
        // specific target without losing the active-tool default.
        const initial = new Set<string>();
        const normalizedActiveAgentId = normalizeActiveInstallAgentId(activeAgentId);
        if (
          normalizedActiveAgentId &&
          list.some((a) => a.id === normalizedActiveAgentId)
        ) {
          initial.add(normalizedActiveAgentId);
        }
        for (const id of preCheckedAgentIds ?? []) {
          const normalizedId = normalizeActiveInstallAgentId(id);
          if (normalizedId && list.some((a) => a.id === normalizedId)) {
            initial.add(normalizedId);
          }
        }
        if (initial.size === 0) {
          const fallbackAgentId = firstDetectedFilesystemAgentId(list);
          if (fallbackAgentId) initial.add(fallbackAgentId);
        }
        setSelected(initial);
        setPhase("select");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [fetchSupportedAgentsImpl, activeAgentId, preCheckedAgentIds]);

  // Cleanup any active SSE stream on unmount.
  useEffect(() => {
    return () => {
      try {
        streamHandleRef.current?.close();
      } catch {
        // ignore
      }
    };
  }, []);

  // 0850 — fetch install-state on mount and after install/remove operations.
  useEffect(() => {
    let cancelled = false;
    const fetcher = fetchInstallStateImpl ?? ((s: string) => api.getSkillInstallState(s));
    fetcher(skill).then(
      (resp) => { if (!cancelled) setInstallState(resp); },
      () => { if (!cancelled) setInstallState(null); },
    );
    return () => { cancelled = true; };
  }, [skill, fetchInstallStateImpl, installStateNonce]);

  const tiered = useMemo(() => groupSupportedAgentsByTier(agents), [agents]);

  const toggleAgent = useCallback((agentId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const selectAllDetected = useCallback(() => {
    setSelected(() => {
      const next = new Set<string>();
      for (const a of agents) {
        if (a.detected) next.add(a.id);
      }
      return next;
    });
  }, [agents]);

  const clearAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleCancel = useCallback(() => {
    if (phase === "installing") return; // wait until the stream finishes
    try {
      streamHandleRef.current?.close();
    } catch {
      // ignore
    }
    onClose();
  }, [phase, onClose]);

  const handleInstall = useCallback(async () => {
    if (selected.size === 0) return;
    setInstallError(null);
    setResults({});
    setPhase("installing");

    const agentIds = Array.from(selected);
    const installFn = installToAgentsImpl ?? installToAgents;
    const streamFn = startInstallStreamImpl ?? startInstallStream;

    try {
      const { jobId, streamPath } = await installFn({ skill, agentIds, scope });
      streamHandleRef.current = streamFn(streamPath ?? jobId, {
        onResult: (r) => {
          setResults((prev) => ({ ...prev, [r.agentId]: r }));
        },
        onDone: (summary: MultiInstallResult) => {
          // Merge: prefer authoritative per-agent results from the done
          // payload, fall back to the live results we accumulated.
          const merged: LiveResultMap = {};
          const summaryError =
            summary.success === false
              ? (typeof summary.error === "string" && summary.error.trim())
                || "Install failed before any target reported a result."
              : null;
          for (const id of agentIds) {
            merged[id] = summaryError
              ? { agentId: id, status: "error", detail: summaryError }
              : { agentId: id, status: "skipped" };
          }
          if (!summaryError) {
            for (const r of summary.results ?? []) {
              merged[r.agentId] = r;
            }
          } else {
            setInstallError(summaryError);
          }
          // Live updates take precedence if the summary is sparse.
          setResults((prev) => {
            const next: LiveResultMap = { ...merged };
            for (const [id, r] of Object.entries(prev)) {
              if (next[id]?.status === "skipped" && r.status !== "skipped") {
                next[id] = r;
              }
            }
            const finalList = Object.values(next);
            const hasWritableOutcome = finalList.some(
              (r) => r.status === "installed" || r.status === "exported" || r.status === "error",
            );
            if (!hasWritableOutcome) {
              const message = "Install finished without writing any selected target.";
              for (const id of agentIds) {
                next[id] = { agentId: id, status: "error", detail: message };
              }
              setInstallError(message);
            }
            // AC-US5-08: open the ClipboardExportDialog for every Tier 3
            // export, sequentially. The dialog mounts AFTER the SSE
            // stream closes (we are inside onDone here — stream is done).
            const visibleList = Object.values(next);
            const exportRows = visibleList.filter(
              (r) => r.status === "exported" && typeof r.blob === "string",
            );
            if (exportRows.length > 0) {
              setPendingClipboardQueue(exportRows);
              setActiveClipboard(exportRows[0] ?? null);
            }
            globalThis.setTimeout(() => {
              try {
                onSuccess?.(visibleList);
              } catch {
                // non-fatal
              }
            }, 0);
            return next;
          });
          // 0850 — re-fetch install-state so badges flip to Installed v<X>.
          setInstallStateNonce((n) => n + 1);
          setPhase("done");
        },
        onError: (err) => {
          setInstallError(err.message);
          setPhase("error");
        },
      });
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [
    selected,
    skill,
    scope,
    installToAgentsImpl,
    startInstallStreamImpl,
    onSuccess,
  ]);

  // 0850 — per-agent remove. Posts to /api/studio/remove-skill, then
  // re-fetches install-state so the badge flips back to "Not installed".
  const handleRemoveAgent = useCallback(async (agentId: string) => {
    const removeFn = removeSkillImpl ?? removeSkillFromAgents;
    setRemovingAgents((prev) => {
      const next = new Set(prev);
      next.add(agentId);
      return next;
    });
    try {
      const resp: RemoveSkillResponse = await removeFn({ skill, agentIds: [agentId], scope });
      if (typeof window !== "undefined") {
        try {
          window.dispatchEvent(
            new CustomEvent("studio:skill-installed", { detail: { skill, scope } }),
          );
        } catch { /* non-fatal */ }
      }
      // Trigger install-state re-fetch so the row badge updates.
      setInstallStateNonce((n) => n + 1);
      if (resp.errors.length > 0) {
        setInstallError(`Remove failed for ${resp.errors[0].agentId}: ${resp.errors[0].message}`);
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingAgents((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });
    }
  }, [removeSkillImpl, skill, scope]);

  const advanceClipboardQueue = useCallback(() => {
    setPendingClipboardQueue((prev) => {
      const next = prev.slice(1);
      setActiveClipboard(next[0] ?? null);
      return next;
    });
  }, []);

  const detectedCount = useMemo(
    () => agents.filter((a) => a.detected).length,
    [agents],
  );

  if (typeof document === "undefined") return null;

  const installDisabled = selected.size === 0 || phase === "installing";
  const installButtonTitle =
    selected.size === 0 ? "Select at least one target" : undefined;

  const titleText = `Install ${skillDisplayName ?? skill} to:`;
  const scopeSubLine = scope === "project"
    ? "Project scope — writes under <project>/.claude/skills (or each tool's local dir)"
    : "User scope — writes under ~/.claude/skills (or each tool's global dir)";

  return createPortal(
    <>
      <div
        data-testid="install-targets-modal-backdrop"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleCancel();
        }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          paddingTop: "min(8vh, 64px)",
          zIndex: 10020,
        }}
      >
        <div
          ref={dialogRef}
          data-testid="install-targets-modal"
          role="dialog"
          aria-modal="true"
          aria-label={titleText}
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 640,
            margin: "0 1rem",
            background: "var(--bg-surface, #FFFFFF)",
            color: "var(--text-primary, #191919)",
            borderRadius: 8,
            border: "1px solid var(--color-rule, #E8E1D6)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
            overflow: "hidden",
            maxHeight: "84vh",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "0.875rem 1.125rem",
              borderBottom: "1px solid var(--color-rule, #E8E1D6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <div
                data-testid="install-targets-modal-title"
                style={{
                  fontFamily: "var(--font-serif, serif)",
                  fontSize: 16,
                  fontWeight: 500,
                }}
              >
                {titleText}
              </div>
              <div
                data-testid="install-targets-modal-scope-line"
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {scopeSubLine}
              </div>
            </div>
            <button
              type="button"
              data-testid="install-targets-modal-close"
              onClick={handleCancel}
              aria-label="Close"
              disabled={phase === "installing"}
              style={{
                background: "transparent",
                border: "none",
                cursor: phase === "installing" ? "not-allowed" : "pointer",
                fontSize: 18,
                color: "var(--text-secondary, #5A5651)",
                padding: "0 4px",
                lineHeight: 1,
                opacity: phase === "installing" ? 0.4 : 1,
              }}
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div
            style={{
              padding: "0.75rem 1.125rem",
              overflowY: "auto",
              flex: 1,
            }}
          >
            {phase === "loading" && (
              <div
                data-testid="install-targets-modal-loading"
                style={{ fontSize: 12, color: "var(--text-secondary)" }}
              >
                Loading agents…
              </div>
            )}
            {loadError && phase === "error" && agents.length === 0 && (
              <div
                data-testid="install-targets-modal-load-error"
                role="alert"
                style={{
                  fontSize: 12,
                  color: "var(--color-error, #dc2626)",
                }}
              >
                Failed to load agents: {loadError}
              </div>
            )}
            {(phase === "select" ||
              phase === "installing" ||
              phase === "done" ||
              (phase === "error" && agents.length > 0)) && (
              <>
                {/* Quick actions */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    marginBottom: "0.625rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {selected.size} selected · {detectedCount} detected
                  </div>
                  <div style={{ display: "flex", gap: "0.375rem" }}>
                    <button
                      type="button"
                      data-testid="install-targets-select-all-detected"
                      onClick={selectAllDetected}
                      disabled={phase === "installing" || detectedCount === 0}
                      style={quickActionStyle()}
                    >
                      Select all detected
                    </button>
                    <button
                      type="button"
                      data-testid="install-targets-clear"
                      onClick={clearAll}
                      disabled={phase === "installing" || selected.size === 0}
                      style={quickActionStyle()}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {phase === "installing" && (
                  <div
                    data-testid="install-targets-modal-installing-status"
                    role="status"
                    aria-live="polite"
                    style={{
                      margin: "0 0 0.75rem 0",
                      padding: "0.625rem 0.875rem",
                      borderRadius: 6,
                      border: "1px solid var(--color-rule, #E8E1D6)",
                      background: "var(--surface-2, #F6F4EE)",
                      color: "var(--text-primary)",
                      fontSize: 12,
                    }}
                  >
                    Installing {skillDisplayName ?? skill} to {selected.size} target{selected.size === 1 ? "" : "s"}…
                  </div>
                )}

                <TierSection
                  testId="install-targets-section-dropin"
                  title="Drop-in"
                  description="Filesystem install — Claude-style SKILL.md drops in unchanged."
                  agents={tiered.dropIn}
                  selected={selected}
                  results={results}
                  phase={phase}
                  onToggle={toggleAgent}
                  scope={scope}
                  installState={installState}
                  targetVersion={targetVersion ?? null}
                  removingAgents={removingAgents}
                  onRemove={handleRemoveAgent}
                />
                <TierSection
                  testId="install-targets-section-format-converted"
                  title="Format-converted"
                  description="Auto-converted to the tool's native format on install."
                  agents={tiered.formatConverted}
                  selected={selected}
                  results={results}
                  phase={phase}
                  onToggle={toggleAgent}
                  scope={scope}
                  installState={installState}
                  targetVersion={targetVersion ?? null}
                  removingAgents={removingAgents}
                  onRemove={handleRemoveAgent}
                />
                <TierSection
                  testId="install-targets-section-cloud"
                  title="Cloud only (paste required)"
                  description="No local filesystem — opens a paste-ready blob."
                  agents={tiered.cloud}
                  selected={selected}
                  results={results}
                  phase={phase}
                  onToggle={toggleAgent}
                  tierBadge="T3"
                  pathOverride="Copy to clipboard"
                  scope={scope}
                  installState={installState}
                  targetVersion={targetVersion ?? null}
                  removingAgents={removingAgents}
                  onRemove={handleRemoveAgent}
                />
              </>
            )}

            {phase === "done" && (
              <ResultsToast
                results={Object.values(results)}
                agents={agents}
              />
            )}

            {(phase === "error" || phase === "done") && installError && (
              <div
                data-testid="install-targets-modal-install-error"
                role="alert"
                style={{
                  marginTop: "0.75rem",
                  padding: "0.625rem 0.875rem",
                  borderRadius: 6,
                  background:
                    "color-mix(in srgb, var(--color-error, #dc2626) 12%, transparent)",
                  border:
                    "1px solid color-mix(in srgb, var(--color-error, #dc2626) 45%, transparent)",
                  color: "var(--text-primary)",
                  fontSize: 12,
                }}
              >
                {installError}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "0.75rem 1.125rem",
              borderTop: "1px solid var(--color-rule, #E8E1D6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "0.5rem",
            }}
          >
            <button
              type="button"
              data-testid="install-targets-modal-cancel"
              onClick={handleCancel}
              disabled={phase === "installing"}
              style={{
                padding: "0.5rem 0.875rem",
                borderRadius: 6,
                border: "1px solid var(--color-rule, #E8E1D6)",
                background: "transparent",
                color: "var(--text-primary)",
                cursor: phase === "installing" ? "not-allowed" : "pointer",
                fontSize: 13,
                fontFamily: "var(--font-sans)",
                opacity: phase === "installing" ? 0.5 : 1,
              }}
            >
              {phase === "done" ? "Close" : "Cancel"}
            </button>
            <button
              type="button"
              data-testid="install-targets-modal-install"
              onClick={handleInstall}
              disabled={installDisabled || phase === "done"}
              aria-disabled={installDisabled || phase === "done"}
              title={installButtonTitle}
              style={{
                padding: "0.5rem 1.125rem",
                borderRadius: 6,
                border: "1px solid var(--text-primary, #191919)",
                background:
                  installDisabled || phase === "done"
                    ? "var(--bg-surface, #FFFFFF)"
                    : "var(--text-primary, #191919)",
                color:
                  installDisabled || phase === "done"
                    ? "var(--text-secondary, #5A5651)"
                    : "var(--bg-surface, #FFFFFF)",
                cursor:
                  installDisabled || phase === "done"
                    ? "not-allowed"
                    : "pointer",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                opacity: installDisabled && phase !== "done" ? 0.6 : 1,
              }}
            >
              {phase === "installing"
                ? "Installing…"
                : phase === "done"
                  ? "Done"
                  : `Install (${selected.size})`}
            </button>
          </div>
        </div>
      </div>

      {/* AC-US5-08: clipboard dialog only mounts AFTER the SSE stream closes
          (phase === "done") and a Tier-3 export result is queued. */}
      {activeClipboard && (
        <ClipboardExportDialog
          agentId={activeClipboard.agentId}
          agentDisplayName={
            agents.find((a) => a.id === activeClipboard.agentId)
              ?.displayName ?? activeClipboard.agentId
          }
          blob={activeClipboard.blob ?? ""}
          pasteInstructionsUrl={activeClipboard.pasteInstructionsUrl}
          docsUrl={activeClipboard.docsUrl}
          scopeDowngradeWarning={
            activeClipboard.detail &&
            activeClipboard.detail.includes("project-scoped")
              ? activeClipboard.detail
              : undefined
          }
          onClose={advanceClipboardQueue}
          writeClipboardImpl={writeClipboardImpl}
        />
      )}
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Tier group renderer
// ---------------------------------------------------------------------------

function TierSection({
  testId,
  title,
  description,
  agents,
  selected,
  results,
  phase,
  onToggle,
  tierBadge,
  pathOverride,
  scope,
  installState,
  targetVersion,
  removingAgents,
  onRemove,
}: {
  testId: string;
  title: string;
  description: string;
  agents: SupportedAgent[];
  selected: Set<string>;
  results: LiveResultMap;
  phase: Phase;
  onToggle: (agentId: string) => void;
  tierBadge?: string;
  pathOverride?: string;
  scope: InstallScope;
  installState: InstallStateResponse | null;
  targetVersion: string | null;
  removingAgents: Set<string>;
  onRemove: (agentId: string) => void;
}) {
  if (agents.length === 0) return null;
  return (
    <div data-testid={testId} style={{ marginTop: "0.625rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.5rem",
          padding: "0 0 0.25rem 0",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
          }}
        >
          {description}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {agents.map((agent) => {
          const isChecked = selected.has(agent.id);
          const result = results[agent.id];
          const disabled = phase === "installing" || phase === "done";
          // 0850 (AC-US1-01/02): the path shown to the user must match the
          // selected scope. Tier-3 cloud rows always override with the
          // clipboard label.
          const path =
            pathOverride ??
            (scope === "project" ? agent.resolvedLocalDir : agent.resolvedGlobalDir);
          const badge = deriveBadge(agent.id, scope, installState, targetVersion);
          const isRemoving = removingAgents.has(agent.id);
          return (
            <label
              key={agent.id}
              data-testid={`install-targets-row-${agent.id}`}
              data-checked={isChecked ? "true" : "false"}
              data-detected={agent.detected ? "true" : "false"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                padding: "0.375rem 0.5rem",
                borderRadius: 4,
                cursor: disabled ? "default" : "pointer",
                background: isChecked
                  ? "color-mix(in srgb, var(--accent-surface) 8%, transparent)"
                  : "transparent",
              }}
            >
              <input
                type="checkbox"
                data-testid={`install-targets-checkbox-${agent.id}`}
                checked={isChecked}
                disabled={disabled}
                onChange={() => onToggle(agent.id)}
                style={{ margin: 0 }}
              />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span style={{ fontSize: 13 }}>{agent.displayName}</span>
                  {!agent.detected && (
                    <span
                      data-testid={`install-targets-undetected-badge-${agent.id}`}
                      style={{
                        fontSize: 9,
                        padding: "1px 6px",
                        borderRadius: 8,
                        background:
                          "color-mix(in srgb, var(--text-tertiary) 18%, transparent)",
                        color: "var(--text-secondary)",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                      }}
                    >
                      Not detected
                    </span>
                  )}
                  {tierBadge && (
                    <span
                      style={{
                        fontSize: 9,
                        padding: "1px 6px",
                        borderRadius: 8,
                        background:
                          "color-mix(in srgb, var(--color-own, #f59e0b) 14%, transparent)",
                        color: "var(--text-secondary)",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                      }}
                    >
                      {tierBadge}
                    </span>
                  )}
                  {/* 0850 — per-agent install-state badge (Not installed / Installed / Update / Newer / Installed elsewhere) */}
                  <InstallStateBadgePill
                    agentId={agent.id}
                    badge={badge}
                    isRemoving={isRemoving}
                    onRemove={onRemove}
                  />
                </div>
                <div
                  title={path}
                  data-testid={`install-targets-path-${agent.id}`}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-tertiary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {path}
                </div>
              </div>
              {result && (
                <span
                  data-testid={`install-targets-status-${agent.id}`}
                  data-status={result.status}
                  style={{
                    fontSize: 11,
                    padding: "1px 8px",
                    borderRadius: 10,
                    background: `color-mix(in srgb, ${statusColor(result.status)} 16%, transparent)`,
                    color: statusColor(result.status),
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {statusLabel(result.status)}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 0845 T-021 — per-target result toast
//
// Rendered inside the modal after the SSE stream closes. One row per
// selected agent with the outcome status pill + path / error / warning
// detail. Partial failures don't abort: every row appears, even if some
// errored (AC-US2-07).
// ---------------------------------------------------------------------------

function ResultsToast({
  results,
  agents,
}: {
  results: AgentInstallResult[];
  agents: SupportedAgent[];
}) {
  if (results.length === 0) return null;
  return (
    <div
      data-testid="install-targets-results-toast"
      role="status"
      aria-live="polite"
      style={{
        marginTop: "0.875rem",
        padding: "0.75rem 0.875rem",
        borderRadius: 6,
        border: "1px solid var(--color-rule, #E8E1D6)",
        background: "var(--surface-2, #F6F4EE)",
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          marginBottom: "0.125rem",
        }}
      >
        Install results
      </div>
      {results.map((r) => {
        const agent = agents.find((a) => a.id === r.agentId);
        const detail =
          r.status === "installed"
            ? (r.path ?? r.detail)
            : r.status === "exported"
              ? r.detail && r.detail.includes("project-scoped")
                ? r.detail
                : "Copied to clipboard"
              : r.status === "error"
                ? (r.detail ?? "Unknown error")
                : (r.detail ?? "");
        const icon =
          r.status === "installed"
            ? "✓"
            : r.status === "exported"
              ? "⧉"
              : r.status === "skipped"
                ? "·"
                : "✗";
        return (
          <div
            key={r.agentId}
            data-testid={`install-targets-result-row-${r.agentId}`}
            data-status={r.status}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.5rem",
              fontSize: 12,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                color: statusColor(r.status),
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
                width: "0.875rem",
                flexShrink: 0,
              }}
            >
              {icon}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>
                {agent?.displayName ?? r.agentId}
              </span>
              {detail && (
                <span
                  style={{
                    marginLeft: "0.5rem",
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    wordBreak: "break-all",
                  }}
                >
                  {detail}
                </span>
              )}
              {r.status === "exported" && r.pasteInstructionsUrl && (
                <>
                  {" "}
                  <a
                    data-testid={`install-targets-result-paste-link-${r.agentId}`}
                    href={r.pasteInstructionsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{
                      fontSize: 11,
                      color: "var(--accent-text, var(--text-primary))",
                      textDecoration: "underline",
                    }}
                  >
                    open paste instructions →
                  </a>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// 0850 — install-state badge pill + inline Remove link.
function InstallStateBadgePill({
  agentId,
  badge,
  isRemoving,
  onRemove,
}: {
  agentId: string;
  badge: InstallStateBadge;
  isRemoving: boolean;
  onRemove: (agentId: string) => void;
}) {
  if (badge.kind === "not-installed") return null;
  let label: string;
  let bg: string;
  let fg: string;
  switch (badge.kind) {
    case "installed-current":
      label = badge.version ? `Installed v${badge.version}` : "Installed";
      bg = "color-mix(in srgb, var(--color-ok, #22c55e) 14%, transparent)";
      fg = "var(--color-ok, #22c55e)";
      break;
    case "update-available":
      label = `Update v${badge.installed} → v${badge.target}`;
      bg = "color-mix(in srgb, var(--color-own, #f59e0b) 18%, transparent)";
      fg = "var(--color-own, #f59e0b)";
      break;
    case "newer-installed":
      label = `Newer v${badge.installed} (target v${badge.target})`;
      bg = "color-mix(in srgb, var(--accent-text, #3b82f6) 14%, transparent)";
      fg = "var(--accent-text, #3b82f6)";
      break;
    case "installed-other-scope":
      label = badge.version
        ? `Installed v${badge.version} (${badge.otherScope} scope)`
        : `Installed (${badge.otherScope} scope)`;
      bg = "color-mix(in srgb, var(--text-tertiary) 18%, transparent)";
      fg = "var(--text-secondary)";
      break;
  }
  const isRemovable = badge.kind !== "installed-other-scope";
  return (
    <>
      <span
        data-testid={`install-targets-status-badge-${agentId}`}
        data-badge-kind={badge.kind}
        style={{
          fontSize: 9,
          padding: "1px 6px",
          borderRadius: 8,
          background: bg,
          color: fg,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {isRemovable && (
        <button
          type="button"
          data-testid={`install-targets-remove-${agentId}`}
          disabled={isRemoving}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(agentId);
          }}
          style={{
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 8,
            background: "transparent",
            border: "1px solid var(--color-rule, #E8E1D6)",
            color: "var(--color-error, #dc2626)",
            cursor: isRemoving ? "wait" : "pointer",
            fontFamily: "var(--font-sans)",
          }}
        >
          {isRemoving ? "Removing…" : "Remove"}
        </button>
      )}
    </>
  );
}

function quickActionStyle(): React.CSSProperties {
  return {
    padding: "3px 8px",
    borderRadius: 4,
    border: "1px solid var(--color-rule, #E8E1D6)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    fontSize: 11,
    fontFamily: "var(--font-sans)",
  };
}
