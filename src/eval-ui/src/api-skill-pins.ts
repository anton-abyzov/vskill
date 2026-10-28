// 1126: client for pin / unpin, install-this-version and fleet push.
// Server routes: src/eval-server/skill-pin-routes.ts.

const BASE = "";

export interface SkillPinState {
  found: boolean;
  lockName?: string;
  /** owner/repo/skill, or null when the source has none (local, plugin). */
  fullName?: string | null;
  scope?: "project" | "global";
  installedVersion?: string;
  pinned?: boolean;
  pinnedVersion?: string | null;
  canInstallVersion?: boolean;
}

export interface FleetStatus {
  available: boolean;
  skillsSupported: boolean;
  machines: string[] | null;
  message?: string;
}

export interface FleetMachineResult {
  machine: string;
  ok: boolean;
  installedVersion?: string;
  pinnedVersion?: string | null;
  reason?: string;
  error?: string;
}

export interface FleetPushResult {
  ok: boolean;
  error?: string;
  notAvailable?: boolean;
  results?: FleetMachineResult[];
}

/**
 * Window event fired after a pin changes, so the views showing that skill
 * (Update button, pin row, Versions tab) can drop stale "pinned" state.
 */
export const SKILL_PIN_CHANGED_EVENT = "studio:skill-pin-changed";

export interface SkillPinChangedDetail {
  plugin: string;
  skill: string;
  pinned: boolean;
  pinnedVersion: string | null;
  /** Which view made the change, so it can ignore its own event. */
  source?: string;
}

export function emitSkillPinChanged(detail: SkillPinChangedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SkillPinChangedDetail>(SKILL_PIN_CHANGED_EVENT, { detail }));
}

/** Subscribe to pin changes; returns the unsubscribe function. */
export function onSkillPinChanged(handler: (detail: SkillPinChangedDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<SkillPinChangedDetail>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(SKILL_PIN_CHANGED_EVENT, listener);
  return () => window.removeEventListener(SKILL_PIN_CHANGED_EVENT, listener);
}

/** JSON body with `error` turned into a thrown Error carrying the server's text. */
async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return (body ?? {}) as T;
}

function skillUrl(plugin: string, skill: string, tail: string): string {
  return `${BASE}/api/skills/${encodeURIComponent(plugin)}/${encodeURIComponent(skill)}/${tail}`;
}

export function createSkillPinsApi() {
  return {
    async getSkillPinState(plugin: string, skill: string): Promise<SkillPinState> {
      return json<SkillPinState>(await fetch(skillUrl(plugin, skill, "pin")));
    },

    async pinSkill(plugin: string, skill: string, version?: string): Promise<SkillPinState> {
      return json<SkillPinState>(
        await fetch(skillUrl(plugin, skill, "pin"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(version ? { version } : {}),
        }),
      );
    },

    async unpinSkill(plugin: string, skill: string): Promise<SkillPinState> {
      return json<SkillPinState>(await fetch(skillUrl(plugin, skill, "pin"), { method: "DELETE" }));
    },

    /** Install an exact version (vskill install owner/repo/skill@X). Pins unless `pin` is false. */
    async installSkillVersion(
      plugin: string,
      skill: string,
      version: string,
      pin = true,
    ): Promise<SkillPinState & { ok: boolean; version?: string }> {
      return json(
        await fetch(skillUrl(plugin, skill, "install-version"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version, pin }),
        }),
      );
    },

    /** Never throws: an unreachable server reads as "fleet CLI absent". */
    async getFleetStatus(): Promise<FleetStatus> {
      try {
        const res = await fetch(`${BASE}/api/fleet/status`);
        if (!res.ok) return { available: false, skillsSupported: false, machines: null };
        return (await res.json()) as FleetStatus;
      } catch {
        return { available: false, skillsSupported: false, machines: null };
      }
    },

    /** Push a version to every fleet machine. Errors come back in the result. */
    async pushSkillToFleet(
      plugin: string,
      skill: string,
      version: string,
      pin: boolean,
      fullName?: string | null,
    ): Promise<FleetPushResult> {
      try {
        const res = await fetch(skillUrl(plugin, skill, "push-fleet"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version, pin, ...(fullName ? { skill: fullName } : {}) }),
        });
        const body = (await res.json().catch(() => null)) as FleetPushResult | null;
        if (!body) return { ok: false, error: `HTTP ${res.status}` };
        return res.ok ? body : { ...body, ok: false, error: body.error || `HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
