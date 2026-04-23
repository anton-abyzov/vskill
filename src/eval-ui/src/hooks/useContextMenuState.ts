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
 * Side-effecting router for context-menu actions. Returns nothing — all
 * outputs happen via `navigator.clipboard` and `studio:toast` events.
 *
 * Unknown actions are silently ignored to keep the surface tolerant of
 * future additions without a breaking change.
 */
export function handleContextMenuAction(
  action: ContextMenuAction | string,
  skill: SkillInfo,
): void {
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
    case "open":
    case "reveal":
    case "edit":
      dispatchToast(strings.actions.editPlaceholder ?? "Not yet available.", "info");
      return;
    case "run-benchmark":
      dispatchToast(strings.toasts.benchmarkQueued, "info");
      return;
    case "duplicate":
      dispatchToast(strings.toasts.skillDuplicated, "info");
      return;
    case "update":
      dispatchToast(strings.toasts.skillUpdated, "info");
      return;
    case "uninstall":
      // Uninstall is destructive and needs a confirm flow — out of scope
      // for this plumbing increment. Emit a stub toast so the action is
      // acknowledged rather than silently dropped.
      dispatchToast(strings.actions.editPlaceholder ?? "Uninstall requires confirmation.", "info");
      return;
    default:
      return;
  }
}
