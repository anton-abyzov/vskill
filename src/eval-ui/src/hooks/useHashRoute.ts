// ---------------------------------------------------------------------------
// 0740 useHashRoute — hash-based route detection for the studio
// ---------------------------------------------------------------------------
// CONTRACT (do not regress):
//   The studio uses ad-hoc hash-based routing (no react-router). Each route
//   gets a small `useIs<Route>Route()` hook here. `App.tsx` reads the hook
//   results and chooses what to render in the main slot.
//
//   Routes currently handled:
//     #/create   → CreateSkillPage  (added 0703)
//     #/updates  → UpdatesPanel     (added 0740 — was a dead route causing
//                  the "View Updates" button to drop the user on an empty
//                  page after vskill@0.5.116 shipped)
//
//   When adding a new hash route:
//     1. Add a pure predicate `is<Route>Hash(hash: string): boolean` here.
//     2. Add a `useIs<Route>Route()` hook that subscribes to `hashchange`.
//     3. Add a corresponding branch in App.tsx's mainContent ternary.
//     4. Add unit tests in __tests__/useHashRoute.test.ts.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";

export function isCreateHash(hash: string): boolean {
  return hash.startsWith("#/create");
}

export function isUpdatesHash(hash: string): boolean {
  return hash.startsWith("#/updates");
}

function useHashMatch(predicate: (hash: string) => boolean): boolean {
  const [match, setMatch] = useState<boolean>(() =>
    typeof window !== "undefined" && predicate(window.location.hash),
  );
  useEffect(() => {
    function onHashChange(): void {
      setMatch(predicate(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    // Fire once on mount — Vite HMR + some navigation paths
    // (window.location.assign before listener attach) need the sync read.
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return match;
}

export function useIsCreateRoute(): boolean {
  return useHashMatch(isCreateHash);
}

export function useIsUpdatesRoute(): boolean {
  return useHashMatch(isUpdatesHash);
}
