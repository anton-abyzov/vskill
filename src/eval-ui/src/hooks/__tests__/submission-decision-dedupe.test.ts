// ---------------------------------------------------------------------------
// 0859 T-006 — cross-transport single-fire dedupe.
//
// A submission decision can arrive via BOTH transports concurrently:
//   • the reliable UpdateHub `usr_<userId>` skills-stream (useSkillUpdates), and
//   • the best-effort `/api/v1/submissions/stream?mine=1` panel stream.
// The shared module-level guard must guarantee exactly ONE notification per
// (submissionId, state) per session, no matter how many consumers report it.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach } from "vitest";
import {
  claimDecisionNotification,
  markDecisionNotified,
  resetDecisionDedupe,
} from "../useSubmissionNotifications";

beforeEach(() => resetDecisionDedupe());

describe("submission-decision shared dedupe (T-006)", () => {
  it("claims a (submissionId, state) exactly once", () => {
    expect(claimDecisionNotification("sub_1", "PUBLISHED")).toBe(true);
    expect(claimDecisionNotification("sub_1", "PUBLISHED")).toBe(false);
    expect(claimDecisionNotification("sub_1", "PUBLISHED")).toBe(false);
  });

  it("dual delivery (panel + skills-stream) fires exactly one notification", () => {
    // Simulate both consumers each gating their notify() on the shared claim
    // for the SAME decision. Only the winner should actually notify.
    let notifications = 0;
    const deliverFromPanelStream = () => {
      if (claimDecisionNotification("sub_42", "REJECTED")) notifications += 1;
    };
    const deliverFromSkillsStream = () => {
      if (claimDecisionNotification("sub_42", "REJECTED")) notifications += 1;
    };
    deliverFromSkillsStream(); // reliable transport arrives first
    deliverFromPanelStream(); // best-effort transport arrives second
    expect(notifications).toBe(1);
  });

  it("a genuinely different terminal state for the same submission can still notify", () => {
    expect(claimDecisionNotification("sub_7", "REJECTED")).toBe(true);
    // e.g. requeued and re-resolved to a different terminal state
    expect(claimDecisionNotification("sub_7", "PUBLISHED")).toBe(true);
  });

  it("markDecisionNotified seeds a decision so a later delivery does NOT notify", () => {
    // Rows already terminal when the panel opened are seeded, not notified.
    markDecisionNotified("sub_old", "PUBLISHED");
    expect(claimDecisionNotification("sub_old", "PUBLISHED")).toBe(false);
  });

  it("resetDecisionDedupe clears the session guard", () => {
    expect(claimDecisionNotification("sub_x", "BLOCKED")).toBe(true);
    resetDecisionDedupe();
    expect(claimDecisionNotification("sub_x", "BLOCKED")).toBe(true);
  });
});
