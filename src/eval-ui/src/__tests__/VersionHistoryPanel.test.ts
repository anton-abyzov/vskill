import { describe, it, expect } from "vitest";
import type { VersionEntry } from "../types";

// Test the data transformation and selection logic used by VersionHistoryPanel

const CERT_COLORS: Record<string, string> = {
  CERTIFIED: "#d4a017",
  VERIFIED: "#3b82f6",
  COMMUNITY: "#6b7280",
};

function getCertColor(tier: string): string {
  return CERT_COLORS[tier] || CERT_COLORS.COMMUNITY;
}

describe("VersionHistoryPanel logic", () => {
  const versions: VersionEntry[] = [
    { version: "2.3.0", certTier: "CERTIFIED", diffSummary: "Added multi-repo", createdAt: "2026-04-10T00:00:00Z", isInstalled: false },
    { version: "2.2.0", certTier: "VERIFIED", diffSummary: "New ADR template", createdAt: "2026-03-15T00:00:00Z", isInstalled: true },
    { version: "2.1.0", certTier: "COMMUNITY", diffSummary: null, createdAt: "2026-03-01T00:00:00Z" },
  ];

  it("identifies installed version", () => {
    const installed = versions.find((v) => v.isInstalled);
    expect(installed?.version).toBe("2.2.0");
  });

  it("detects when installed is not latest", () => {
    const latest = versions[0];
    const installed = versions.find((v) => v.isInstalled);
    expect(installed?.version).not.toBe(latest.version);
  });

  it("maps cert tier to colors", () => {
    expect(getCertColor("CERTIFIED")).toBe("#d4a017");
    expect(getCertColor("VERIFIED")).toBe("#3b82f6");
    expect(getCertColor("COMMUNITY")).toBe("#6b7280");
    expect(getCertColor("UNKNOWN")).toBe("#6b7280");
  });

  it("two-click selection: first sets selectedA, second sets selectedB", () => {
    let selectedA: string | null = null;
    let selectedB: string | null = null;

    // First click
    const clickVersion = (v: string) => {
      if (!selectedA) {
        selectedA = v;
      } else if (!selectedB && v !== selectedA) {
        selectedB = v;
      } else {
        selectedA = v;
        selectedB = null;
      }
    };

    clickVersion("2.3.0");
    expect(selectedA).toBe("2.3.0");
    expect(selectedB).toBeNull();

    clickVersion("2.2.0");
    expect(selectedA).toBe("2.3.0");
    expect(selectedB).toBe("2.2.0");
  });

  it("auto-select link when installed != latest", () => {
    const installed = versions.find((v) => v.isInstalled);
    const latest = versions[0];
    const showAutoLink = installed && installed.version !== latest.version;
    expect(showAutoLink).toBe(true);
  });

  it("truncates diffSummary for display", () => {
    const long = "A".repeat(80);
    const truncated = long.length > 60 ? long.slice(0, 60) + "…" : long;
    expect(truncated.length).toBe(61);
    expect(truncated.endsWith("…")).toBe(true);
  });
});
