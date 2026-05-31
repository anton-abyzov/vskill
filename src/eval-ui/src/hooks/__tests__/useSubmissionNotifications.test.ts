// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0856 — submission notification routing tests.
//
// Covers the PURE routing decision (planSubmissionNotification): approved vs
// rejected vs non-terminal, and the correct click target for rejections. The
// side-effecting notifySubmissionOutcome is verified to NO-OP in a non-Tauri
// (browser / jsdom) context — no window.__TAURI_INTERNALS__, so it never
// imports the plugin and returns false.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tauri notification plugin — mocked so the dynamic import inside
// notifySubmissionOutcome resolves without a real Tauri runtime.
const mockSendNotification = vi.fn();
const mockIsPermissionGranted = vi.fn(async () => true);
const mockRequestPermission = vi.fn(async () => "granted");
let onActionCb: (() => void) | null = null;
const mockOnAction = vi.fn(async (cb: () => void) => {
  onActionCb = cb;
  return () => {};
});
vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: (...a: unknown[]) => mockSendNotification(...a),
  isPermissionGranted: (...a: unknown[]) => mockIsPermissionGranted(...a),
  requestPermission: (...a: unknown[]) => mockRequestPermission(...a),
  onAction: (cb: () => void) => mockOnAction(cb),
}));

const mockOpenExternal = vi.fn(async () => {});
vi.mock("../../preferences/lib/useDesktopBridge", () => ({
  openExternalUrlViaDesktop: (...a: unknown[]) => mockOpenExternal(...a),
}));

import {
  planSubmissionNotification,
  notifySubmissionOutcome,
  submitDetailUrl,
  APPROVED_STATES,
  REJECTED_STATES,
} from "../useSubmissionNotifications";

describe("planSubmissionNotification — approved states", () => {
  for (const state of [...APPROVED_STATES]) {
    it(`routes ${state} to an informational (non-clickable) approval`, () => {
      const plan = planSubmissionNotification("s1", "greet", state);
      expect(plan).not.toBeNull();
      expect(plan!.outcome).toBe("approved");
      expect(plan!.clickUrl).toBeUndefined();
      expect(plan!.title.toLowerCase()).toContain("approved");
      expect(plan!.body).toContain("greet");
    });
  }
});

describe("planSubmissionNotification — rejected states", () => {
  for (const state of [...REJECTED_STATES]) {
    it(`routes ${state} to a clickable rejection opening submit/<id>`, () => {
      const plan = planSubmissionNotification("sub-42", "greet", state);
      expect(plan).not.toBeNull();
      expect(plan!.outcome).toBe("rejected");
      expect(plan!.clickUrl).toBe("https://verified-skill.com/submit/sub-42");
      expect(plan!.title.toLowerCase()).toContain("reject");
    });
  }

  it("uses 'blocked' wording for the BLOCKED state", () => {
    const plan = planSubmissionNotification("s1", "evil", "BLOCKED");
    expect(plan!.body.toLowerCase()).toContain("blocked");
    expect(plan!.clickUrl).toBe(submitDetailUrl("s1"));
  });
});

describe("planSubmissionNotification — non-terminal states", () => {
  for (const state of ["RECEIVED", "TIER1_SCANNING", "TIER2_SCANNING", "DEQUEUED", "RESCAN_REQUIRED"]) {
    it(`returns null for the in-flight state ${state} (no notification)`, () => {
      expect(planSubmissionNotification("s1", "greet", state)).toBeNull();
    });
  }

  it("falls back to a generic skill name when none is given", () => {
    const plan = planSubmissionNotification("s1", "", "PUBLISHED");
    expect(plan!.body).toContain("Your skill");
  });
});

describe("submitDetailUrl", () => {
  it("encodes the submission id", () => {
    expect(submitDetailUrl("a/b")).toBe("https://verified-skill.com/submit/a%2Fb");
  });
});

describe("notifySubmissionOutcome — non-Tauri context", () => {
  it("no-ops (returns false) when there is no Tauri host", async () => {
    // jsdom window has no __TAURI_INTERNALS__ → must not attempt to import the
    // plugin and must resolve false even for a terminal state.
    expect("__TAURI_INTERNALS__" in window).toBe(false);
    await expect(notifySubmissionOutcome("s1", "greet", "PUBLISHED")).resolves.toBe(false);
    await expect(notifySubmissionOutcome("s1", "greet", "REJECTED")).resolves.toBe(false);
  });

  it("no-ops for a non-terminal state regardless of context", async () => {
    await expect(notifySubmissionOutcome("s1", "greet", "RECEIVED")).resolves.toBe(false);
  });
});

describe("notifySubmissionOutcome — Tauri host", () => {
  beforeEach(() => {
    mockSendNotification.mockClear();
    mockIsPermissionGranted.mockClear();
    mockRequestPermission.mockClear();
    mockOnAction.mockClear();
    mockOpenExternal.mockClear();
    onActionCb = null;
    // Simulate a desktop (Tauri) host.
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("approved: sends an informational notification (no action listener)", async () => {
    const sent = await notifySubmissionOutcome("s1", "greet", "PUBLISHED");
    expect(sent).toBe(true);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const arg = mockSendNotification.mock.calls[0][0];
    expect(arg.title.toLowerCase()).toContain("approved");
    expect(mockOnAction).not.toHaveBeenCalled();
  });

  it("rejected: sends a clickable notification whose action opens submit/<id>", async () => {
    const sent = await notifySubmissionOutcome("sub-7", "greet", "REJECTED");
    expect(sent).toBe(true);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockOnAction).toHaveBeenCalledTimes(1);
    // Simulate the user tapping the notification.
    expect(onActionCb).toBeTypeOf("function");
    onActionCb!();
    expect(mockOpenExternal).toHaveBeenCalledWith("https://verified-skill.com/submit/sub-7");
  });

  it("does not notify when permission is denied", async () => {
    mockIsPermissionGranted.mockResolvedValueOnce(false);
    mockRequestPermission.mockResolvedValueOnce("denied");
    const sent = await notifySubmissionOutcome("s1", "greet", "PUBLISHED");
    expect(sent).toBe(false);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
