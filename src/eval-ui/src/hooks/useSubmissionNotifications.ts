// ---------------------------------------------------------------------------
// 0856 — Native submission notifications.
//
// When an in-app submission reaches a TERMINAL state (detected via the queue
// SSE stream), fire a native macOS notification through the Tauri
// notification plugin:
//
//   • Approved  (PUBLISHED / AUTO_APPROVED / VENDOR_APPROVED) → informational.
//   • Rejected  (REJECTED / TIER1_FAILED / BLOCKED)           → CLICKABLE; the
//     click opens verified-skill.com/submit/<id> via the desktop shell so the
//     user can read the rejection reason.
//
// Everything here is guarded for the non-Tauri (plain browser / vitest jsdom)
// context: with no `__TAURI_INTERNALS__` on `window` we no-op gracefully and
// never import the plugin. The notification:default capability + the Rust
// crate are already wired in src-tauri, so no Rust change is required.
// ---------------------------------------------------------------------------

import { openExternalUrlViaDesktop } from "../preferences/lib/useDesktopBridge";

/** States we treat as a successful, user-facing approval. */
export const APPROVED_STATES = new Set<string>([
  "PUBLISHED",
  "AUTO_APPROVED",
  "VENDOR_APPROVED",
]);

/** States we treat as a rejection the user should be able to inspect. */
export const REJECTED_STATES = new Set<string>([
  "REJECTED",
  "TIER1_FAILED",
  "BLOCKED",
]);

export type TerminalOutcome = "approved" | "rejected";

// ── Cross-transport single-fire dedupe (0859 T-006) ────────────────────────
// A submission decision can arrive via BOTH transports at once:
//   • the reliable UpdateHub `usr_<userId>` skills-stream (useSkillUpdates), and
//   • the best-effort `/api/v1/submissions/stream?mine=1` panel stream
//     (SubmissionQueuePanel).
// Before this guard each consumer kept its OWN dedupe set, so a decision that
// landed while the queue panel was open fired TWO native notifications. Both
// consumers now consult this single module-level guard, so a decision notifies
// exactly once per session. Keyed by `submissionId::state` so a genuinely new
// decision (e.g. a requeue resolving to a different terminal state) can still
// notify once.
const notifiedDecisions = new Set<string>();

function decisionKey(submissionId: string, state: string): string {
  return `${submissionId}::${state}`;
}

/**
 * Check-and-claim. Returns `true` exactly ONCE per (submissionId, state) per
 * session, `false` thereafter. Synchronous + atomic, so two near-simultaneous
 * callers (the two streams) can never both win the race. Callers should only
 * fire the notification when this returns `true`.
 */
export function claimDecisionNotification(
  submissionId: string,
  state: string,
): boolean {
  const key = decisionKey(submissionId, state);
  if (notifiedDecisions.has(key)) return false;
  notifiedDecisions.add(key);
  return true;
}

/**
 * Seed a decision as already-notified WITHOUT firing — used for rows that were
 * already terminal before the panel opened, so a later replay/redelivery of
 * that same outcome does not produce a stale notification.
 */
export function markDecisionNotified(submissionId: string, state: string): void {
  notifiedDecisions.add(decisionKey(submissionId, state));
}

/** Test-only: clear the session dedupe guard between cases. */
export function resetDecisionDedupe(): void {
  notifiedDecisions.clear();
}

export interface SubmissionNotificationPlan {
  outcome: TerminalOutcome;
  title: string;
  body: string;
  /** Present only for rejected outcomes — the URL the click should open. */
  clickUrl?: string;
}

/** Canonical submit-detail URL used as the rejected-notification click target. */
export function submitDetailUrl(submissionId: string): string {
  return `https://verified-skill.com/submit/${encodeURIComponent(submissionId)}`;
}

/**
 * Pure routing: given a terminal state, decide whether/how to notify.
 * Returns `null` for non-terminal states (no notification fires).
 *
 * Exported separately from the side-effecting {@link notifySubmissionOutcome}
 * so the routing decision (approved vs rejected, correct click target) can be
 * unit-tested without any Tauri runtime.
 */
export function planSubmissionNotification(
  submissionId: string,
  skillName: string,
  state: string,
): SubmissionNotificationPlan | null {
  const name = skillName || "Your skill";
  if (APPROVED_STATES.has(state)) {
    return {
      outcome: "approved",
      title: "Skill approved",
      body: `${name} is now published on verified-skill.com`,
    };
  }
  if (REJECTED_STATES.has(state)) {
    const reason = state === "BLOCKED" ? "was blocked" : "was rejected";
    return {
      outcome: "rejected",
      title: "Skill rejected",
      body: `${name} ${reason}. Tap to see why.`,
      clickUrl: submitDetailUrl(submissionId),
    };
  }
  return null;
}

// ── Tauri context detection ────────────────────────────────────────────────
function isTauriHost(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

// Minimal shape of the bits of @tauri-apps/plugin-notification we use. Loaded
// lazily so the bundle stays free of the plugin in the browser build and the
// import never resolves in jsdom tests.
interface NotificationPluginLike {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<string>;
  sendNotification: (opts: { title: string; body?: string }) => void;
  onAction?: (cb: (n: unknown) => void) => Promise<() => void>;
}

async function loadNotificationPlugin(): Promise<NotificationPluginLike | null> {
  try {
    // Dynamic import keeps this out of the browser build and out of test
    // resolution unless an actual Tauri host triggers it.
    const mod = (await import(
      "@tauri-apps/plugin-notification"
    )) as unknown as NotificationPluginLike;
    return mod;
  } catch {
    return null;
  }
}

async function ensurePermission(
  plugin: NotificationPluginLike,
): Promise<boolean> {
  try {
    let granted = await plugin.isPermissionGranted();
    if (!granted) {
      const result = await plugin.requestPermission();
      granted = result === "granted";
    }
    return granted;
  } catch {
    return false;
  }
}

/**
 * Side-effecting entry point. Plans the notification, then — in a Tauri host
 * only — requests permission, sends the native notification, and (for
 * rejections) wires the click to open the submit-detail page in the system
 * browser. In a plain browser context this resolves to `false` (no-op).
 *
 * Returns `true` when a native notification was actually dispatched.
 */
export async function notifySubmissionOutcome(
  submissionId: string,
  skillName: string,
  state: string,
): Promise<boolean> {
  const plan = planSubmissionNotification(submissionId, skillName, state);
  if (!plan) return false;
  if (!isTauriHost()) return false;

  const plugin = await loadNotificationPlugin();
  if (!plugin) return false;

  const granted = await ensurePermission(plugin);
  if (!granted) return false;

  // For rejections, register a one-shot action listener that opens the submit
  // page when the notification is tapped. plugin.onAction fires for taps on
  // platforms that support it; the body copy ("Tap to see why") cues the user.
  if (plan.outcome === "rejected" && plan.clickUrl && typeof plugin.onAction === "function") {
    try {
      const url = plan.clickUrl;
      let unlisten: (() => void) | null = null;
      unlisten = await plugin.onAction(() => {
        void openExternalUrlViaDesktop(url);
        try {
          unlisten?.();
        } catch {
          /* best-effort cleanup */
        }
      });
    } catch {
      // onAction is unavailable on some platforms; the notification still
      // fires (informational) — the user can open the queue panel manually.
    }
  }

  try {
    plugin.sendNotification({ title: plan.title, body: plan.body });
    return true;
  } catch {
    return false;
  }
}
