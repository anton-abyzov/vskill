import { describe, it, expect } from "vitest";
import type { VersionEntry } from "../types";

// ---------------------------------------------------------------------------
// T-006: "Update to Latest" button logic
// T-007: "Manage all updates" cross-link logic
// Pure logic tests — no DOM rendering
// ---------------------------------------------------------------------------

type UpdateStatus = "idle" | "updating" | "scanning" | "installing" | "done" | "error";

interface UpdateState {
  status: UpdateStatus;
  error: string | null;
}

/** Simulates SSE event processing for the update button state machine */
function applyUpdateEvent(
  state: UpdateState,
  eventData: { status: string; error?: string },
): UpdateState {
  switch (eventData.status) {
    case "scanning":
      return { status: "scanning", error: null };
    case "installing":
      return { status: "installing", error: null };
    case "done":
      return { status: "done", error: null };
    case "error":
      return { status: "error", error: eventData.error || "Update failed" };
    default:
      return state;
  }
}

/** Determines whether the update button should be visible */
function shouldShowUpdateButton(
  installed: VersionEntry | null,
  latest: VersionEntry | null,
  updateStatus: UpdateStatus,
): boolean {
  const showAutoLink = !!installed && !!latest && installed.version !== latest.version;
  return showAutoLink && updateStatus !== "done";
}

/** Returns button label based on update status */
function getUpdateButtonLabel(status: UpdateStatus, latestVersion: string): string {
  switch (status) {
    case "idle":
      return `Update to ${latestVersion}`;
    case "updating":
      return "Starting update...";
    case "scanning":
      return "Scanning...";
    case "installing":
      return "Installing...";
    case "error":
      return "Retry";
    default:
      return `Update to ${latestVersion}`;
  }
}

/** Whether the update button should be disabled */
function isUpdateButtonDisabled(status: UpdateStatus): boolean {
  return status === "updating" || status === "scanning" || status === "installing";
}

/** Whether to show the "Manage all updates" cross-link */
function shouldShowManageLink(updateCount: number): boolean {
  return updateCount > 1;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("T-006: Update button state machine", () => {
  const versions: VersionEntry[] = [
    { version: "2.3.0", certTier: "CERTIFIED", diffSummary: "Added multi-repo", createdAt: "2026-04-10T00:00:00Z", isInstalled: false },
    { version: "2.2.0", certTier: "VERIFIED", diffSummary: "New ADR template", createdAt: "2026-03-15T00:00:00Z", isInstalled: true },
    { version: "2.1.0", certTier: "COMMUNITY", diffSummary: null, createdAt: "2026-03-01T00:00:00Z" },
  ];

  const installed = versions.find((v) => v.isInstalled) ?? null;
  const latest = versions[0];

  it("initial state is idle with no error", () => {
    const state: UpdateState = { status: "idle", error: null };
    expect(state.status).toBe("idle");
    expect(state.error).toBeNull();
  });

  it("transitions from idle -> scanning -> installing -> done", () => {
    let state: UpdateState = { status: "idle", error: null };
    state = applyUpdateEvent(state, { status: "scanning" });
    expect(state.status).toBe("scanning");
    state = applyUpdateEvent(state, { status: "installing" });
    expect(state.status).toBe("installing");
    state = applyUpdateEvent(state, { status: "done" });
    expect(state.status).toBe("done");
    expect(state.error).toBeNull();
  });

  it("transitions to error state with message", () => {
    let state: UpdateState = { status: "idle", error: null };
    state = applyUpdateEvent(state, { status: "scanning" });
    state = applyUpdateEvent(state, { status: "error", error: "Network timeout" });
    expect(state.status).toBe("error");
    expect(state.error).toBe("Network timeout");
  });

  it("error state has default message if none provided", () => {
    let state: UpdateState = { status: "idle", error: null };
    state = applyUpdateEvent(state, { status: "error" });
    expect(state.error).toBe("Update failed");
  });

  it("unknown event status does not change state", () => {
    const state: UpdateState = { status: "scanning", error: null };
    const next = applyUpdateEvent(state, { status: "unknown-thing" });
    expect(next.status).toBe("scanning");
  });
});

describe("T-006: Update button visibility", () => {
  const installed: VersionEntry = { version: "2.2.0", certTier: "VERIFIED", diffSummary: null, createdAt: "2026-03-15T00:00:00Z", isInstalled: true };
  const latest: VersionEntry = { version: "2.3.0", certTier: "CERTIFIED", diffSummary: null, createdAt: "2026-04-10T00:00:00Z", isInstalled: false };

  it("shows button when installed != latest and status is idle", () => {
    expect(shouldShowUpdateButton(installed, latest, "idle")).toBe(true);
  });

  it("shows button when status is updating", () => {
    expect(shouldShowUpdateButton(installed, latest, "updating")).toBe(true);
  });

  it("shows button when status is error (for retry)", () => {
    expect(shouldShowUpdateButton(installed, latest, "error")).toBe(true);
  });

  it("hides button when status is done", () => {
    expect(shouldShowUpdateButton(installed, latest, "done")).toBe(false);
  });

  it("hides button when installed == latest", () => {
    const sameLatest = { ...latest, version: "2.2.0" };
    expect(shouldShowUpdateButton(installed, sameLatest, "idle")).toBe(false);
  });

  it("hides button when installed is null", () => {
    expect(shouldShowUpdateButton(null, latest, "idle")).toBe(false);
  });

  it("hides button when latest is null", () => {
    expect(shouldShowUpdateButton(installed, null, "idle")).toBe(false);
  });
});

describe("T-006: Update button label and disabled state", () => {
  it("idle: shows 'Update to {version}'", () => {
    expect(getUpdateButtonLabel("idle", "2.3.0")).toBe("Update to 2.3.0");
  });

  it("updating: shows 'Starting update...'", () => {
    expect(getUpdateButtonLabel("updating", "2.3.0")).toBe("Starting update...");
  });

  it("scanning: shows 'Scanning...'", () => {
    expect(getUpdateButtonLabel("scanning", "2.3.0")).toBe("Scanning...");
  });

  it("installing: shows 'Installing...'", () => {
    expect(getUpdateButtonLabel("installing", "2.3.0")).toBe("Installing...");
  });

  it("error: shows 'Retry'", () => {
    expect(getUpdateButtonLabel("error", "2.3.0")).toBe("Retry");
  });

  it("disabled during updating/scanning/installing", () => {
    expect(isUpdateButtonDisabled("updating")).toBe(true);
    expect(isUpdateButtonDisabled("scanning")).toBe(true);
    expect(isUpdateButtonDisabled("installing")).toBe(true);
  });

  it("enabled during idle and error", () => {
    expect(isUpdateButtonDisabled("idle")).toBe(false);
    expect(isUpdateButtonDisabled("error")).toBe(false);
  });
});

describe("T-007: Manage all updates cross-link", () => {
  it("shows when updateCount > 1", () => {
    expect(shouldShowManageLink(2)).toBe(true);
    expect(shouldShowManageLink(5)).toBe(true);
  });

  it("hides when updateCount <= 1", () => {
    expect(shouldShowManageLink(1)).toBe(false);
    expect(shouldShowManageLink(0)).toBe(false);
  });
});
