/**
 * 0838 T-005 — bounded localStorage-backed FIFO toast queue with TTL.
 *
 * Used by `useSkillUpdates` to hold `studio:toast` payloads that arrive
 * while the Studio window is in the background (`document.visibilityState
 * === "hidden"`) so they can be replayed on the next `visibilitychange →
 * "visible"` transition rather than being dropped silently.
 *
 * Contract (AC-US3-01..AC-US3-06):
 *   - localStorage-backed (key: `vskill:toast-queue`) so a backgrounded
 *     window that is reloaded still surfaces pending toasts.
 *   - Bounded at 10 entries; FIFO eviction when full.
 *   - Entries older than 30 minutes at drain time are dropped silently.
 *   - SSR-safe: when `typeof window === "undefined"` every operation is a
 *     no-op (writes ignored, reads return empty).
 *   - Dedupes by `eventId` — re-enqueue of the same eventId leaves the
 *     queue unchanged.
 *   - Malformed storage is treated as an empty queue (defensive recovery).
 *
 * Cross-window dedupe is the responsibility of the consumer
 * (`useSkillUpdates` checks `updateStore.seenEventIds` before dispatching
 * a replayed `studio:toast`). This module is intentionally storage-only.
 */

export const STORAGE_KEY = "vskill:toast-queue";
export const MAX_ENTRIES = 10;
export const STALE_AFTER_MS = 30 * 60 * 1000; // 30 min

export interface QueuedToast {
  message: string;
  severity: "info" | "success" | "warn" | "error";
  skillId: string;
  version: string;
  eventId: string;
  /** Wall-clock ms-since-epoch at the time of `enqueue()`. */
  enqueuedAt: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readAll(): QueuedToast[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Light shape validation — drop entries we can't reason about.
    return parsed.filter(
      (e): e is QueuedToast =>
        e &&
        typeof e === "object" &&
        typeof e.eventId === "string" &&
        typeof e.skillId === "string" &&
        typeof e.version === "string" &&
        typeof e.enqueuedAt === "number" &&
        typeof e.message === "string",
    );
  } catch {
    return [];
  }
}

function writeAll(entries: QueuedToast[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota or private-mode errors are non-fatal — the live `studio:toast`
    // path keeps working; we just lose persistence for this one entry.
  }
}

/**
 * Add a toast payload to the queue. Dedupes by `eventId` — re-enqueueing
 * the same id is a silent no-op. When the queue is at capacity, the
 * oldest entry is evicted (FIFO).
 *
 * Returns `"enqueued"`, `"deduped"`, or `"dropped"` (oldest evicted to
 * make room) so callers can log eviction counts under a debug flag.
 */
export function enqueue(entry: QueuedToast): "enqueued" | "deduped" | "evicted" {
  if (!isBrowser()) return "enqueued";
  const current = readAll();
  if (current.some((e) => e.eventId === entry.eventId)) {
    return "deduped";
  }
  let evicted = false;
  const next = [...current, entry];
  while (next.length > MAX_ENTRIES) {
    next.shift();
    evicted = true;
  }
  writeAll(next);
  return evicted ? "evicted" : "enqueued";
}

/**
 * Read the queue without mutating it. Useful for tests + debug logging.
 * Stale entries are returned as-is — staleness is enforced only on
 * `drain()` (which is the hot path that actually surfaces toasts).
 */
export function peek(): QueuedToast[] {
  return readAll();
}

/**
 * Atomically remove all entries from the queue and return the
 * non-stale ones. Stale entries (older than `STALE_AFTER_MS`) are
 * dropped silently — they're considered already reconciled by the
 * polling fallback (5-min cadence) and would just spam the user.
 */
export function drain(): QueuedToast[] {
  if (!isBrowser()) return [];
  const all = readAll();
  if (all.length === 0) {
    return [];
  }
  // Atomic clear before we hand entries to the caller — prevents the
  // (unlikely) double-replay if `drain()` is invoked twice in a microtask
  // race.
  writeAll([]);
  const cutoff = Date.now() - STALE_AFTER_MS;
  return all.filter((e) => e.enqueuedAt >= cutoff);
}

/** Drop all entries (used by tests + a manual "reset" affordance). */
export function clear(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
