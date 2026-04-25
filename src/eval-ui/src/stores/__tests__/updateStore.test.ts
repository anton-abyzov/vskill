// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createUpdateStore, SEEN_IDS_CAP, SEEN_LAST_ID_KEY } from "../updateStore";
import type { SkillUpdateEvent, UpdateStoreEntry } from "../../types/skill-update";

function mkEvent(n: number, skillId = `skill-${n}`): SkillUpdateEvent {
  return {
    type: "skill.updated",
    eventId: `evt_${n.toString().padStart(4, "0")}`,
    skillId,
    version: `1.${n}.0`,
    gitSha: `sha${n}`,
    publishedAt: new Date(1_700_000_000_000 + n).toISOString(),
  };
}

describe("updateStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("T-029/T-030: ingest + snapshot", () => {
    it("stores a new event keyed by skillId and returns 'stored'", () => {
      const store = createUpdateStore();
      const r = store.ingest(mkEvent(1, "skill-A"));
      expect(r).toBe("stored");
      const snap = store.getSnapshot();
      expect(snap.get("skill-A")?.version).toBe("1.1.0");
      expect(snap.get("skill-A")?.eventId).toBe("evt_0001");
    });

    it("notifies subscribers on ingest", () => {
      const store = createUpdateStore();
      let calls = 0;
      store.subscribe(() => calls++);
      store.ingest(mkEvent(1));
      store.ingest(mkEvent(2));
      expect(calls).toBe(2);
    });

    it("exposes a fresh Map identity per change (React-compatible)", () => {
      const store = createUpdateStore();
      const a = store.getSnapshot();
      store.ingest(mkEvent(1));
      const b = store.getSnapshot();
      expect(b).not.toBe(a);
    });

    it("dismiss removes an entry and notifies", () => {
      const store = createUpdateStore();
      let calls = 0;
      store.subscribe(() => calls++);
      store.ingest(mkEvent(1, "skill-A"));
      expect(store.getSnapshot().has("skill-A")).toBe(true);
      store.dismiss("skill-A");
      expect(store.getSnapshot().has("skill-A")).toBe(false);
      expect(calls).toBe(2);
    });
  });

  describe("T-056/T-057: seenEventIds FIFO dedup (AC-US5-10)", () => {
    it("drops a duplicate eventId silently without notifying", () => {
      const store = createUpdateStore();
      let calls = 0;
      store.subscribe(() => calls++);
      const evt = mkEvent(1, "skill-A");
      expect(store.ingest(evt)).toBe("stored");
      expect(store.ingest(evt)).toBe("duplicate");
      expect(calls).toBe(1);
    });

    it("evicts oldest entries when the 500 cap is exceeded", () => {
      const store = createUpdateStore();
      // Ingest cap + overflow entries with distinct eventIds.
      for (let i = 0; i < SEEN_IDS_CAP + 10; i++) {
        store.ingest(mkEvent(i, `skill-${i}`));
      }
      // The very first eventId (evt_0000) should have been evicted —
      // re-ingesting it now should be treated as NEW ("stored") again.
      const replay = store.ingest({
        ...mkEvent(0, "skill-0"),
        eventId: "evt_0000",
        version: "9.9.9",
      });
      expect(replay).toBe("stored");
      // A recent eventId (within the cap) should still dedup.
      const recentReplay = store.ingest({
        ...mkEvent(SEEN_IDS_CAP + 5, `skill-${SEEN_IDS_CAP + 5}`),
      });
      expect(recentReplay).toBe("duplicate");
    });

    it("persists the most recent eventId as seenLastId in localStorage", () => {
      const store = createUpdateStore();
      store.ingest(mkEvent(1));
      store.ingest(mkEvent(2));
      expect(window.localStorage.getItem(SEEN_LAST_ID_KEY)).toBe("evt_0002");
      expect(store.getSeenLastId()).toBe("evt_0002");
    });

    it("rehydrates seenLastId from localStorage on construction", () => {
      window.localStorage.setItem(SEEN_LAST_ID_KEY, "evt_9999");
      const store = createUpdateStore();
      expect(store.getSeenLastId()).toBe("evt_9999");
      // A replay of that persisted eventId must be deduped.
      const r = store.ingest({
        ...mkEvent(9999, "skill-9999"),
        eventId: "evt_9999",
      });
      expect(r).toBe("duplicate");
    });
  });

  describe("T-058/T-059: gone-frame reconciliation (AC-US5-11)", () => {
    it("clearSeen wipes the dedup set and seenLastId but not the store entries", () => {
      const store = createUpdateStore();
      store.ingest(mkEvent(1, "skill-A"));
      expect(store.getSeenLastId()).toBe("evt_0001");
      store.clearSeen();
      expect(store.getSeenLastId()).toBeNull();
      expect(window.localStorage.getItem(SEEN_LAST_ID_KEY)).toBeNull();
      // Store entries are preserved — only dedup state resets.
      expect(store.getSnapshot().get("skill-A")?.eventId).toBe("evt_0001");
      // Same eventId is now treated as new (as if a gone-frame replay arrived).
      const r = store.ingest(mkEvent(1, "skill-A"));
      expect(r).toBe("stored");
    });

    it("mergeBulk overwrites entries and notifies once", () => {
      const store = createUpdateStore();
      let calls = 0;
      store.subscribe(() => calls++);
      const bulk: UpdateStoreEntry[] = [
        {
          skillId: "skill-A",
          version: "2.0.0",
          eventId: "evt_A",
          publishedAt: "2026-01-01T00:00:00Z",
          receivedAt: 1,
        },
        {
          skillId: "skill-B",
          version: "3.0.0",
          eventId: "evt_B",
          publishedAt: "2026-01-02T00:00:00Z",
          receivedAt: 2,
        },
      ];
      store.mergeBulk(bulk);
      expect(store.getSnapshot().get("skill-A")?.version).toBe("2.0.0");
      expect(store.getSnapshot().get("skill-B")?.version).toBe("3.0.0");
      expect(calls).toBe(1);
    });

    it("mergeBulk with empty list is a no-op", () => {
      const store = createUpdateStore();
      let calls = 0;
      store.subscribe(() => calls++);
      store.mergeBulk([]);
      expect(calls).toBe(0);
    });
  });
});
