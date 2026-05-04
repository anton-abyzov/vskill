// ---------------------------------------------------------------------------
// usePendingDeletion (0722) — owns the 10s Undo buffer for skill deletion.
//
// On enqueueDelete, a timer is started; if the timer fires the pending
// api.deleteSkill is invoked. cancelDelete clears the timer (no API call).
// flushPending fires every queued delete immediately — used by the
// beforeunload listener to avoid silent loss of pending deletes when the
// user closes the tab.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

export type PendingSkill = { plugin: string; skill: string };

export interface PendingDeletionOptions {
  delayMs?: number;
  onCommit?: (skill: PendingSkill) => void;
  onFailure?: (skill: PendingSkill, err: Error) => void;
  /**
   * 0780: override the API call invoked when the timer fires. Defaults to
   * `api.deleteSkill` (source-skill trash flow). Pass `api.uninstallSkill`
   * for the installed-skill uninstall flow. The hook is otherwise identical
   * — same buffer semantics, same undo, same flushPending.
   */
  apiCall?: (plugin: string, skill: string) => Promise<unknown>;
}

export interface UsePendingDeletionReturn {
  enqueueDelete: (skill: PendingSkill) => void;
  cancelDelete: (skillKey: string) => void;
  flushPending: () => Promise<void>;
  isPending: (skillKey: string) => boolean;
  /**
   * 0786 AC-US1-04: fire a single pending entry's apiCall immediately by
   * fully-qualified `${plugin}/${skill}` key. Idempotent — resolves with no
   * apiCall if no entry exists for the key.
   */
  flushKey: (skillKey: string) => Promise<void>;
  /**
   * 0786: client-friendly variant for the create-skill submit path, which
   * doesn't always know the resolved plugin at submit time. Flushes any
   * pending entry whose `skill` matches `skillName` regardless of plugin.
   */
  flushBySkillName: (skillName: string) => Promise<void>;
}

const keyOf = (s: PendingSkill) => `${s.plugin}/${s.skill}`;

interface Entry {
  skill: PendingSkill;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export function usePendingDeletion(
  opts?: PendingDeletionOptions,
): UsePendingDeletionReturn {
  const delayMs = opts?.delayMs ?? 10_000;
  const onCommit = opts?.onCommit;
  const onFailure = opts?.onFailure;
  const apiCall = opts?.apiCall ?? api.deleteSkill.bind(api);

  // Latest callbacks via ref so the timer closure always sees fresh handlers
  // without re-creating timers when the parent re-renders.
  const onCommitRef = useRef(onCommit);
  const onFailureRef = useRef(onFailure);
  const apiCallRef = useRef(apiCall);
  onCommitRef.current = onCommit;
  onFailureRef.current = onFailure;
  apiCallRef.current = apiCall;

  const entriesRef = useRef<Map<string, Entry>>(new Map());
  // Bump to force re-render when pending state changes (so isPending reflects).
  const [, force] = useState(0);
  const bump = useCallback(() => force((n) => n + 1), []);

  const commit = useCallback(async (entry: Entry) => {
    try {
      await apiCallRef.current(entry.skill.plugin, entry.skill.skill);
      onCommitRef.current?.(entry.skill);
    } catch (err) {
      onFailureRef.current?.(entry.skill, err as Error);
    } finally {
      entriesRef.current.delete(keyOf(entry.skill));
      bump();
    }
  }, [bump]);

  const enqueueDelete = useCallback((skill: PendingSkill) => {
    const k = keyOf(skill);
    // Cancel any prior pending entry for the same key (idempotent re-enqueue).
    const prior = entriesRef.current.get(k);
    if (prior?.timeoutId) clearTimeout(prior.timeoutId);

    const entry: Entry = { skill, timeoutId: null };
    entry.timeoutId = setTimeout(() => {
      entry.timeoutId = null;
      void commit(entry);
    }, delayMs);
    entriesRef.current.set(k, entry);
    bump();
  }, [delayMs, commit, bump]);

  const cancelDelete = useCallback((skillKey: string) => {
    const entry = entriesRef.current.get(skillKey);
    if (!entry) return;
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    entriesRef.current.delete(skillKey);
    bump();
  }, [bump]);

  const flushPending = useCallback(async () => {
    const pending = Array.from(entriesRef.current.values());
    for (const entry of pending) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
        entry.timeoutId = null;
      }
    }
    await Promise.all(pending.map((entry) => commit(entry)));
  }, [commit]);

  const isPending = useCallback(
    (skillKey: string) => entriesRef.current.has(skillKey),
    // bump triggers re-render so React calls this fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // 0786 AC-US1-04: flush a single entry by fully-qualified key. Used by
  // useCreateSkill's submit path so a same-name re-create after a delete
  // doesn't race with the still-on-disk folder.
  const flushKey = useCallback(async (skillKey: string) => {
    const entry = entriesRef.current.get(skillKey);
    if (!entry) return;
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
      entry.timeoutId = null;
    }
    await commit(entry);
  }, [commit]);

  // 0786: client-side helper for the create-skill submit path. The client
  // doesn't always know the resolved plugin at submit time (the server
  // computes it via skill-create-routes.ts:1259-1280), so we match by
  // skill name across all pending entries.
  const flushBySkillName = useCallback(async (skillName: string) => {
    const matching = Array.from(entriesRef.current.values()).filter(
      (entry) => entry.skill.skill === skillName,
    );
    for (const entry of matching) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
        entry.timeoutId = null;
      }
    }
    await Promise.all(matching.map((entry) => commit(entry)));
  }, [commit]);

  // beforeunload — flush pending deletes so the user doesn't lose intent.
  useEffect(() => {
    const handler = () => {
      // Best-effort. Synchronous flush via the existing fetch; relies on
      // browser keepalive semantics in the underlying api wrapper.
      void flushPending();
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [flushPending]);

  // 0784 hotfix: on unmount, AUTO-COMMIT pending operations.
  //
  // The original behavior cancelled timers without committing — the
  // rationale was "ambiguous user intent on component unmount". In
  // practice this silently dropped uninstall/delete operations whenever
  // the user navigated, refreshed, or the parent component re-mounted
  // before the debounce window elapsed. The user clicked Uninstall, saw
  // the toast claim success, and the file stayed on disk.
  //
  // The user's intent at click-time was unambiguous: they confirmed the
  // operation. Honor it. flushPending() commits via the same fetch
  // pipeline used in the timer path; browsers honor keepalive on
  // navigation/unload so the request lands.
  useEffect(() => {
    const entries = entriesRef.current;
    return () => {
      for (const entry of entries.values()) {
        if (entry.timeoutId) {
          clearTimeout(entry.timeoutId);
          entry.timeoutId = null;
          // Fire-and-forget commit so unmount doesn't drop the operation.
          void commit(entry);
        }
      }
      entries.clear();
    };
    // commit is stable via useCallback in the parent; intentionally exclude
    // to keep the unmount handler running once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { enqueueDelete, cancelDelete, flushPending, isPending, flushKey, flushBySkillName };
}
