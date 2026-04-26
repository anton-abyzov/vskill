// ---------------------------------------------------------------------------
// 0759 Phase 6 — useDirtySkills.
//
// Polls /api/git/status on a configurable interval (default 5s) and resolves
// the dirty paths against the current skill list to produce a Set of
// "<plugin>/<skill>" IDs the sidebar should mark as dirty.
//
// Re-fires immediately on `studio:content-saved` events so the indicator
// disappears within ~1 frame after Save (which clears the textarea diff
// against the saved file but leaves the git-tree diff in place — the next
// poll catches it). Fail-silent: any API/network error → empty set, no UI
// surface beyond "no dot shown".
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SkillInfo } from "../types";
import { getDirtySkillIds } from "../utils/getDirtySkillIds";

const DEFAULT_POLL_MS = 5_000;

export function useDirtySkills(
  skills: readonly SkillInfo[],
  workspaceRoot: string | null | undefined,
  pollMs: number = DEFAULT_POLL_MS,
): Set<string> {
  const [dirtyPaths, setDirtyPaths] = useState<readonly string[]>([]);
  const skillsRef = useRef(skills);
  skillsRef.current = skills;

  useEffect(() => {
    if (!workspaceRoot) {
      setDirtyPaths([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const result = await api.gitStatus();
        if (!cancelled) setDirtyPaths(result.paths ?? []);
      } catch {
        if (!cancelled) setDirtyPaths([]);
      }
      if (!cancelled) timer = setTimeout(tick, pollMs);
    };

    tick();

    const onSaved = () => { void tick(); };
    if (typeof window !== "undefined") {
      window.addEventListener("studio:content-saved", onSaved);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (typeof window !== "undefined") {
        window.removeEventListener("studio:content-saved", onSaved);
      }
    };
  }, [workspaceRoot, pollMs]);

  // Resolve to skill IDs on every render (cheap — N×M with small N and M).
  if (!workspaceRoot) return new Set();
  return getDirtySkillIds(skillsRef.current, dirtyPaths, workspaceRoot);
}
