/**
 * 0708 T-029/T-030/T-056/T-057: Update store keyed by skillId.
 *
 * Plain external store + seenEventIds FIFO Set (500 cap, localStorage-backed
 * `seenLastId`). Consumed by `useSkillUpdates` and via `useSyncExternalStore`
 * by UI components that want a live read of "which skills have updates".
 *
 * No zustand dependency — the Studio does not ship one and we do not want to
 * add a new runtime dep for ~80 lines of code.
 */

import type { SkillUpdateEvent, UpdateStoreEntry } from "../types/skill-update";

export const SEEN_IDS_CAP = 500;
export const SEEN_LAST_ID_KEY = "vskill.updates.seenLastId";

export interface UpdateStore {
  /** Immutable snapshot of the current keyed update map. */
  getSnapshot(): ReadonlyMap<string, UpdateStoreEntry>;
  /** Subscribe to store changes (returns unsubscribe). */
  subscribe(listener: () => void): () => void;
  /**
   * Ingest a skill.updated event. Returns:
   *   - `"duplicate"` if the eventId was already seen (dedup).
   *   - `"stored"`    if the event was new and landed in the store.
   * Side effects: advances seenEventIds FIFO, persists seenLastId.
   */
  ingest(event: SkillUpdateEvent): "duplicate" | "stored";
  /** Remove a skillId entry (e.g. after user dismisses or installs the update). */
  dismiss(skillId: string): void;
  /** Clear seenEventIds — used by gone-frame reconciliation (AC-US5-11). */
  clearSeen(): void;
  /** Bulk merge — used by /check-updates fallback responses. */
  mergeBulk(entries: UpdateStoreEntry[]): void;
  /** Read the persisted last-event-id (for EventSource reconnect replay). */
  getSeenLastId(): string | null;
  /** Test-only: reset all state. */
  reset(): void;
}

function readPersistedLastId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SEEN_LAST_ID_KEY);
  } catch {
    return null;
  }
}

function writePersistedLastId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id == null) {
      window.localStorage.removeItem(SEEN_LAST_ID_KEY);
    } else {
      window.localStorage.setItem(SEEN_LAST_ID_KEY, id);
    }
  } catch {
    // Private-mode or quota errors are non-fatal; dedup still works in-memory.
  }
}

export function createUpdateStore(): UpdateStore {
  let state: Map<string, UpdateStoreEntry> = new Map();
  const listeners = new Set<() => void>();

  // Dedup structures — FIFO via a parallel queue so eviction is O(1) amortized.
  const seenIds = new Set<string>();
  const seenQueue: string[] = [];
  let seenLastId: string | null = readPersistedLastId();
  if (seenLastId) {
    seenIds.add(seenLastId);
    seenQueue.push(seenLastId);
  }

  function notify(): void {
    // Replace the reference so React's identity-equality check fires.
    state = new Map(state);
    for (const l of Array.from(listeners)) l();
  }

  function recordSeen(eventId: string): void {
    if (seenIds.has(eventId)) return;
    seenIds.add(eventId);
    seenQueue.push(eventId);
    if (seenQueue.length > SEEN_IDS_CAP) {
      const evicted = seenQueue.shift();
      if (evicted) seenIds.delete(evicted);
    }
    seenLastId = eventId;
    writePersistedLastId(eventId);
  }

  return {
    getSnapshot() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ingest(event) {
      if (seenIds.has(event.eventId)) return "duplicate";
      recordSeen(event.eventId);
      state.set(event.skillId, {
        skillId: event.skillId,
        version: event.version,
        diffSummary: event.diffSummary,
        eventId: event.eventId,
        publishedAt: event.publishedAt,
        receivedAt: Date.now(),
      });
      notify();
      return "stored";
    },
    dismiss(skillId) {
      if (!state.has(skillId)) return;
      state.delete(skillId);
      notify();
    },
    clearSeen() {
      seenIds.clear();
      seenQueue.length = 0;
      seenLastId = null;
      writePersistedLastId(null);
    },
    mergeBulk(entries) {
      if (entries.length === 0) return;
      for (const e of entries) {
        state.set(e.skillId, e);
      }
      notify();
    },
    getSeenLastId() {
      return seenLastId;
    },
    reset() {
      state = new Map();
      seenIds.clear();
      seenQueue.length = 0;
      seenLastId = null;
      writePersistedLastId(null);
      notify();
    },
  };
}

/** Singleton store used by `useSkillUpdates` + UI consumers. */
export const updateStore: UpdateStore = createUpdateStore();
