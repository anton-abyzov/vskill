// ---------------------------------------------------------------------------
// PendingActionsContext (0786 US-001) — bridges App.tsx's usePendingDeletion
// instances to deeper components like CreateSkillPage / CreateSkillInline.
//
// Why a separate context? StudioContext is created in StudioContext.tsx and
// has no awareness of the pendingDeletion / pendingUninstall hooks (those
// live in App.tsx because they own optimisticHide / optimisticRestore /
// refreshSkills callbacks specific to App-level state). This thin context
// surface exposes only the flushBySkillName escape hatch the create flow
// needs, without leaking the whole pending-deletion API.
// ---------------------------------------------------------------------------

import { createContext, useContext } from "react";

export interface PendingActionsContextValue {
  /**
   * Flush every pending delete AND pending uninstall whose skill name
   * matches `skillName`, awaiting all `apiCall`s to settle. Used by the
   * Create Skill flow before submitting `api.createSkill` so a skill
   * that's still on disk inside the 10s Undo buffer gets removed before
   * the server's `existsSync` check runs.
   */
  flushBySkillName: (skillName: string) => Promise<void>;
}

const noopFlush: PendingActionsContextValue = {
  flushBySkillName: async () => { /* no-op default */ },
};

export const PendingActionsContext = createContext<PendingActionsContextValue>(noopFlush);

/**
 * Hook for components that need to flush pending deletes/uninstalls before
 * a name-conflict-sensitive operation (currently: Create Skill). Falls back
 * to a no-op when used outside the provider so unit tests can mount the
 * consuming component without a wrapper.
 */
export function usePendingActions(): PendingActionsContextValue {
  return useContext(PendingActionsContext);
}
