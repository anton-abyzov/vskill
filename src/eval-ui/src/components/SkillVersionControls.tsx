import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { FleetMachineResult, FleetStatus, SkillPinState } from "../api";
import { emitSkillPinChanged, onSkillPinChanged } from "../api-skill-pins";
import type { SkillInfo, VersionEntry } from "../types";

interface Props {
  skill: SkillInfo | null;
}

/**
 * 1126 AC-02 / AC-03: pin state and "Push to all machines" for an installed
 * skill, shown under the Update action in the skill detail.
 *
 * - Pin / Unpin edits the vskill.lock entry Studio resolves for the root.
 * - "Push to all machines" appears only when the SpecWithCode CLI
 *   (`specweave-studio`) is on this machine. It installs the chosen version on
 *   every fleet machine through `specweave-studio fleet skills --all` and
 *   lists each machine's result.
 */
export function SkillVersionControls({ skill }: Props) {
  const [pin, setPin] = useState<SkillPinState | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [fleet, setFleet] = useState<FleetStatus | null>(null);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [pushVersion, setPushVersion] = useState<string>("");
  const [pushPin, setPushPin] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushResults, setPushResults] = useState<FleetMachineResult[] | null>(null);

  const plugin = skill?.plugin ?? "";
  const name = skill?.skill ?? "";
  const eligible = Boolean(skill && skill.origin === "installed" && skill.scopeV2 !== "available-plugin");

  useEffect(() => {
    // Per-skill state must not carry over to the next skill: a stale
    // pushVersion would push skill A's version of B to every machine.
    setPin(null);
    setPinError(null);
    setVersions([]);
    setPushVersion("");
    setPushPin(true);
    setPushResults(null);
    setPushError(null);
    if (!eligible) return;
    let cancelled = false;
    // Promise.resolve().then: a missing/mocked api method becomes a rejection.
    Promise.resolve().then(() => api.getSkillPinState(plugin, name))
      .then((s) => { if (!cancelled) setPin(s); })
      .catch(() => { if (!cancelled) setPin(null); });
    Promise.resolve().then(() => api.getFleetStatus())
      .then((s) => { if (!cancelled) setFleet(s); })
      .catch(() => { if (!cancelled) setFleet(null); });
    return () => { cancelled = true; };
  }, [eligible, plugin, name]);

  // Versions for the push picker, only once the fleet CLI is known to exist.
  useEffect(() => {
    if (!eligible || !fleet?.available) return;
    let cancelled = false;
    Promise.resolve().then(() => api.getSkillVersions(plugin, name))
      .then((v) => { if (!cancelled) setVersions(v); })
      .catch(() => { if (!cancelled) setVersions([]); });
    return () => { cancelled = true; };
  }, [eligible, fleet?.available, plugin, name]);

  useEffect(() => {
    if (!pushVersion && pin?.installedVersion) setPushVersion(pin.installedVersion);
  }, [pin?.installedVersion, pushVersion]);

  // A pin changed elsewhere (Versions tab): re-read it.
  useEffect(() => {
    if (!eligible) return;
    return onSkillPinChanged((d) => {
      if (d.source === "controls" || d.plugin !== plugin || d.skill !== name) return;
      Promise.resolve().then(() => api.getSkillPinState(plugin, name))
        .then((s) => setPin(s))
        .catch(() => { /* keep the last known state */ });
    });
  }, [eligible, plugin, name]);

  const togglePin = useCallback(async () => {
    if (!pin?.found) return;
    setPinBusy(true);
    setPinError(null);
    try {
      const next = pin.pinned ? await api.unpinSkill(plugin, name) : await api.pinSkill(plugin, name);
      setPin(next);
      emitSkillPinChanged({
        plugin,
        skill: name,
        pinned: Boolean(next?.pinned),
        pinnedVersion: next?.pinnedVersion ?? null,
        source: "controls",
      });
    } catch (err) {
      setPinError(err instanceof Error ? err.message : String(err));
    } finally {
      setPinBusy(false);
    }
  }, [pin, plugin, name]);

  const push = useCallback(async () => {
    if (!pushVersion) return;
    // One click changes every machine: name the version and the machines first.
    const machines = fleet?.machines ?? null;
    const where = machines && machines.length > 0
      ? `${machines.length} machine${machines.length === 1 ? "" : "s"} (${machines.join(", ")})`
      : "every fleet machine";
    const question = `Install ${pin?.fullName ?? name}@${pushVersion} on ${where}${pushPin ? ", pinned" : ""}?`;
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(question)) return;
    setPushing(true);
    setPushError(null);
    setPushResults(null);
    const out = await api.pushSkillToFleet(plugin, name, pushVersion, pushPin, pin?.fullName ?? null);
    setPushing(false);
    if (out.results) setPushResults(out.results);
    if (!out.ok) setPushError(out.error ?? (out.results ? "Some machines did not install it." : "Push failed"));
  }, [plugin, name, pushVersion, pushPin, pin?.fullName, fleet?.machines]);

  if (!eligible || !pin?.found) return null;

  const versionOptions = Array.from(
    new Set([pin.installedVersion, ...versions.map((v) => v.version)].filter((v): v is string => !!v)),
  );
  const canPush = Boolean(fleet?.available && pin.fullName);

  return (
    <div
      data-testid="skill-version-controls"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 16px",
        borderBottom: "1px solid var(--border-default)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-secondary)" }} data-testid="skill-version-controls-state">
          Installed {pin.installedVersion}
          {pin.pinned ? ` · 📌 pinned at ${pin.pinnedVersion}` : " · not pinned"}
          {pin.scope === "global" ? " · user-level" : " · this project"}
        </span>
        <button
          type="button"
          className="btn btn-secondary text-[11px]"
          onClick={() => { void togglePin(); }}
          disabled={pinBusy}
          data-testid="skill-pin-toggle"
          title={pin.pinned ? "Unpin so updates apply again" : `Pin at ${pin.installedVersion}; updates skip it`}
        >
          {pinBusy ? "Saving…" : pin.pinned ? "Unpin" : "Pin this version"}
        </button>
      </div>
      {pinError && (
        <div role="alert" style={{ color: "var(--red)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{pinError}</div>
      )}

      {canPush && (
        <div data-testid="skill-push-fleet" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select
              value={pushVersion}
              onChange={(e) => setPushVersion(e.target.value)}
              disabled={pushing}
              aria-label="Version to push"
              data-testid="skill-push-fleet-version"
              style={{
                height: 28,
                fontSize: 12,
                background: "var(--surface-1)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-default)",
                borderRadius: 4,
              }}
            >
              {versionOptions.map((v) => (
                <option key={v} value={v}>{v}{v === pin.installedVersion ? " (installed here)" : ""}</option>
              ))}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-tertiary)" }}>
              <input type="checkbox" checked={pushPin} onChange={(e) => setPushPin(e.target.checked)} disabled={pushing} />
              pin on each machine
            </label>
            <button
              type="button"
              className="btn btn-primary text-[11px]"
              onClick={() => { void push(); }}
              disabled={pushing || !pushVersion}
              data-testid="skill-push-fleet-button"
            >
              {pushing ? "Pushing…" : "Push to all machines"}
            </button>
          </div>
          {fleet && !fleet.skillsSupported && !pushResults && !pushError && (
            <div style={{ color: "var(--text-tertiary)", fontSize: 11 }} data-testid="skill-push-fleet-note">
              {fleet.message ?? "This SpecWithCode may not support fleet skills yet."}
            </div>
          )}
          {pushError && (
            <div role="alert" data-testid="skill-push-fleet-error" style={{ color: "var(--red)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
              {pushError}
            </div>
          )}
          {pushResults && pushResults.length > 0 && (
            <ul data-testid="skill-push-fleet-results" style={{ margin: 0, paddingLeft: 16, fontFamily: "var(--font-mono)", fontSize: 11 }}>
              {pushResults.map((r) => (
                <li key={r.machine} style={{ color: r.ok ? "var(--green)" : "var(--red)" }}>
                  {r.machine}: {r.ok ? `installed ${r.installedVersion ?? pushVersion}` : r.reason ?? "failed"}
                  {r.error ? ` (${r.error})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
