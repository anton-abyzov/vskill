// ---------------------------------------------------------------------------
// T-064: useContextMenuState — plumbing for the shared sidebar context menu.
//
// The heavy lifting (ContextMenu.tsx) already exists. What we add here:
//   1. A small value module describing the state shape + reducers so App.tsx
//      can lift the anchor into a single useState hook without pulling in
//      the entire ContextMenu component.
//   2. A side-effecting action router (handleContextMenuAction) that maps
//      menu actions to clipboard writes and toast CustomEvents. The router
//      is hook-free so it can be unit-tested without React's render context.
//
// Toast mechanism: we dispatch a `studio:toast` CustomEvent on `window`.
// App.tsx attaches a single listener that forwards into the real
// ToastProvider (T-065). This indirection keeps MetadataTab, DetailHeader,
// and this router hook-free.
// ---------------------------------------------------------------------------

import type { SkillInfo } from "../types";
import type { ContextMenuAction, ContextMenuState } from "../components/ContextMenu";
import { strings } from "../strings";
import { api, ApiError } from "../api";

export const closedContextMenuState: ContextMenuState = {
  open: false,
  x: 0,
  y: 0,
  skill: null,
};

/** Build a new open-at-cursor state from a mouse-like event and a skill. */
export function openContextMenuAt(
  evt: { clientX: number; clientY: number },
  skill: SkillInfo,
): ContextMenuState {
  return {
    open: true,
    x: evt.clientX,
    y: evt.clientY,
    skill,
  };
}

function dispatchToast(message: string, severity: "info" | "error" = "info"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("studio:toast", { detail: { message, severity } }),
  );
}

/**
 * 0722: ask the App to open the delete-confirmation dialog. App.tsx owns the
 * actual ConfirmDialog + usePendingDeletion wiring; this router stays
 * hook-free so it can be unit-tested without React.
 */
function dispatchRequestDelete(skill: SkillInfo): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("studio:request-delete", { detail: { skill } }),
  );
}

/**
 * 0820 — invoke /api/skills/reveal-in-editor and surface the outcome via
 * toast. Pure async helper so tests can await it.
 */
async function revealInEditor(skill: SkillInfo, file?: string): Promise<void> {
  try {
    await api.revealInEditor(skill.plugin, skill.skill, file);
    dispatchToast(strings.toasts.openingInEditor, "info");
  } catch (err) {
    if (err instanceof ApiError) {
      const code = (err.details as { error?: string } | undefined)?.error;
      if (err.status === 404) {
        dispatchToast(strings.toasts.skillNotFound, "error");
        return;
      }
      if (err.status === 500 && code === "no_editor") {
        dispatchToast(strings.toasts.noEditor, "error");
        return;
      }
    }
    dispatchToast(strings.toasts.openFailed, "error");
  }
}

/**
 * Side-effecting router for context-menu actions. Returns a Promise so
 * callers (production and tests) can await async branches uniformly;
 * sync branches resolve immediately.
 *
 * Unknown actions are silently ignored to keep the surface tolerant of
 * future additions without a breaking change.
 */
export async function handleContextMenuAction(
  action: ContextMenuAction | string,
  skill: SkillInfo,
): Promise<void> {
  switch (action) {
    case "copy-path":
      try {
        navigator.clipboard?.writeText(skill.dir);
      } catch {
        // Clipboard blocked — still fire a toast so the user sees feedback.
        dispatchToast(strings.toasts.permissionDenied, "error");
        return;
      }
      dispatchToast(strings.toasts.pathCopied, "info");
      return;
    case "reveal":
    case "edit":
      await revealInEditor(skill, "SKILL.md");
      return;
    case "open":
      await revealInEditor(skill);
      return;
    case "run-benchmark":
      dispatchToast(strings.toasts.benchmarkQueued, "info");
      return;
    case "duplicate":
      dispatchToast(strings.toasts.skillDuplicated, "info");
      return;
    case "clone":
      // 0828: fork an installed skill into the authoring scope.
      // Opens the CloneToAuthoringDialog (3 targets: standalone / existing
      // plugin / new plugin). App.tsx listens for `studio:request-clone` and
      // renders the dialog with state. The dialog itself POSTs to
      // /api/skills/clone and dispatches success / failure toasts +
      // `studio:skills-changed` so the sidebar refreshes.
      try {
        window.dispatchEvent(new CustomEvent("studio:request-clone", { detail: { skill } }));
      } catch {
        /* JSDOM/test envs without dispatchEvent — non-fatal */
      }
      return;
    case "update":
      dispatchToast(strings.toasts.skillUpdated, "info");
      return;
    case "uninstall":
      // Uninstall is destructive and needs a confirm flow — out of scope
      // for this plumbing increment. Emit a non-error info toast so the
      // user knows the action exists but hasn't landed yet.
      dispatchToast(strings.toasts.uninstallNotImplemented, "info");
      return;
    case "delete":
      // 0722: open the ConfirmDialog. App.tsx listens for studio:request-delete.
      dispatchRequestDelete(skill);
      return;
    default:
      return;
  }
}
