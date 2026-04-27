// ---------------------------------------------------------------------------
// 0792 T-011: HistoryShell — thin wrapper for the new "History" tab.
//
// The previous IA scattered evidence across three places: a History sub-tab
// under Run, a separate Models leaderboard sub-tab, and a top-level Versions
// tab. The new History tab unifies all three behind one URL with three views:
//
//   - timeline → existing HistoryPanel (chronological run list)
//   - models   → existing LeaderboardPanel (per-model aggregate)
//   - versions → existing VersionHistoryPanel (skill version churn)
//
// This wrapper only owns the visible view + dispatches. No panel internals
// change.
// ---------------------------------------------------------------------------

import { HistoryPanel } from "./HistoryPanel";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { VersionHistoryPanel } from "./VersionHistoryPanel";

export type HistoryView = "timeline" | "models" | "versions";

export const HISTORY_VIEWS: ReadonlyArray<{ id: HistoryView; label: string }> = [
  { id: "timeline", label: "Timeline" },
  { id: "models", label: "Models" },
  { id: "versions", label: "Versions" },
];

export function isValidHistoryView(value: unknown): value is HistoryView {
  return value === "timeline" || value === "models" || value === "versions";
}

interface Props {
  /** Current view — provided by RightPanel via the `?view=` URL param. */
  view: HistoryView;
}

export function HistoryShell({ view }: Props) {
  if (view === "models") return <LeaderboardPanel />;
  if (view === "versions") return <VersionHistoryPanel />;
  return <HistoryPanel />;
}
