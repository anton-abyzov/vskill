import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useStudio } from "../StudioContext";

interface Props {
  plugin: string;
  skill: string;
  /**
   * AC-US6-03: server-reported tracking state. The button renders only when
   * `trackedForUpdates === true` (AC-US8-04). `undefined` is treated as
   * "tracked" to avoid hiding the button for payloads that predate 0708.
   */
  trackedForUpdates?: boolean;
  /**
   * AC-US8-04: if the skill is in discovery backoff (US-006) we hide the
   * button to avoid confusing users about why the rescan "isn't firing".
   */
  discoveryBackedOff?: boolean;
}

const RESCAN_TIMEOUT_MS = 30_000;

/**
 * 0708 T-073/T-074 — "Check now" button.
 *
 * - AC-US8-03: clicking disables the button and shows a spinner. The spinner
 *   clears when a matching `skill.updated` push entry arrives (via
 *   `StudioContext.updatesById`) OR after `RESCAN_TIMEOUT_MS` with no event.
 * - AC-US8-04: hidden when `trackedForUpdates === false`, or when
 *   `discoveryBackedOff === true`.
 */
export function CheckNowButton({
  plugin,
  skill,
  trackedForUpdates = true,
  discoveryBackedOff = false,
}: Props) {
  const studio = useStudio();
  const [loading, setLoading] = useState(false);
  const [showNoChanges, setShowNoChanges] = useState(false);
  const [, forceTick] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const skillId = `${plugin}/${skill}`;
  const entry = studio.updatesById.get(skillId);

  // While loading, poll updatesById for a matching entry. The poll exists
  // because `useStudio` exposes the push map directly from the provider —
  // callers that keep the map reference stable won't trigger a re-render
  // on entry arrival. A 250ms tick bounds the clear latency well under the
  // 30s timeout. The tick stops the instant we clear the spinner.
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => forceTick((v) => (v + 1) % 1_000_000), 250);
    return () => clearInterval(id);
  }, [loading]);

  // Clear spinner when a matching push entry lands AFTER we started.
  useEffect(() => {
    if (!loading || !entry) return;
    const startedAt = startedAtRef.current ?? 0;
    if (entry.receivedAt < startedAt) return;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setLoading(false);
    setShowNoChanges(false);
    startedAtRef.current = null;
  }, [loading, entry]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (trackedForUpdates === false) return null;
  if (discoveryBackedOff) return null;

  const onClick = async () => {
    if (loading) return;
    setShowNoChanges(false);
    setLoading(true);
    startedAtRef.current = Date.now();
    timeoutRef.current = setTimeout(() => {
      setLoading(false);
      setShowNoChanges(true);
      timeoutRef.current = null;
      startedAtRef.current = null;
    }, RESCAN_TIMEOUT_MS);
    try {
      await api.rescanSkill(plugin, skill);
      // 0823 F-001: clear spinner on POST success. The rescan endpoint is
      // synchronous (does the upstream fetch + emits the bus event before
      // returning), so its resolution IS the "we're done" signal — waiting
      // for an SSE push that may never arrive (the platform stream is upstream-
      // sourced) would always hit the 30s timeout fallback.
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Read the push map directly (not via the stale `loading` closure) to
      // decide whether to surface the "no changes detected" tip.
      const entryNow = studio.updatesById.get(skillId);
      const startedAt = startedAtRef.current ?? 0;
      const hadPush = !!entryNow && entryNow.receivedAt >= startedAt;
      setLoading(false);
      if (!hadPush) setShowNoChanges(true);
      startedAtRef.current = null;
    } catch {
      // Abort the timeout — AC-US8-03 treats failures as "no spinner, no
      // toast" per the minimal tooltip contract. The surrounding RightPanel
      // may render a broader error path; we just reset our own state here.
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setLoading(false);
      startedAtRef.current = null;
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        data-testid="check-now-button"
        onClick={onClick}
        disabled={loading}
        style={{
          height: 26,
          padding: "0 10px",
          background: "transparent",
          border: "1px solid var(--border-default)",
          borderRadius: 4,
          color: "var(--text-secondary)",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        Check now
      </button>
      {loading && (
        <span
          data-testid="check-now-spinner"
          aria-label="Checking for updates"
          role="status"
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            border: "2px solid var(--text-secondary)",
            borderTopColor: "transparent",
            animation: "check-now-spin 800ms linear infinite",
          }}
        />
      )}
      {showNoChanges && (
        <span
          data-testid="check-now-no-changes"
          style={{
            fontSize: 11,
            color: "var(--text-secondary)",
            fontFamily: "var(--font-sans)",
          }}
        >
          No changes detected
        </span>
      )}
    </span>
  );
}
