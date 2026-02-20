import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BlocklistCache, BlocklistEntry } from "../blocklist/types.js";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted for ESM compatibility
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getCachedBlocklist: vi.fn(),
  syncBlocklist: vi.fn(),
  checkBlocklist: vi.fn(),
}));

vi.mock("../blocklist/blocklist.js", () => ({
  getCachedBlocklist: (...args: unknown[]) => mocks.getCachedBlocklist(...args),
  syncBlocklist: (...args: unknown[]) => mocks.syncBlocklist(...args),
  checkBlocklist: (...args: unknown[]) => mocks.checkBlocklist(...args),
}));

vi.mock("../utils/output.js", () => ({
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
  table: (headers: string[], rows: string[][]) => {
    return [headers.join("  "), ...rows.map((r: string[]) => r.join("  "))].join("\n");
  },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------
const { blocklistCommand } = await import("./blocklist.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<BlocklistEntry> = {}): BlocklistEntry {
  return {
    skillName: "evil-skill",
    threatType: "credential-theft",
    severity: "critical",
    reason: "Steals AWS credentials",
    evidenceUrls: ["https://example.com/report"],
    discoveredAt: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function makeCache(overrides: Partial<BlocklistCache> = {}): BlocklistCache {
  return {
    entries: [makeEntry()],
    count: 1,
    lastUpdated: "2026-02-01T00:00:00Z",
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("blocklist list", () => {
  it("shows cached entries in a table", async () => {
    const cache = makeCache({
      entries: [
        makeEntry({ skillName: "evil-bot", threatType: "credential-theft", severity: "critical", sourceRegistry: "clawhub" }),
        makeEntry({ skillName: "bad-agent", threatType: "prompt-injection", severity: "high", sourceRegistry: "github" }),
      ],
      count: 2,
    });

    mocks.getCachedBlocklist.mockReturnValue(cache);

    await blocklistCommand("list");

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");

    expect(output).toContain("evil-bot");
    expect(output).toContain("bad-agent");
    expect(output).toContain("2 entries");
  });

  it("shows message when no cache exists", async () => {
    mocks.getCachedBlocklist.mockReturnValue(null);

    await blocklistCommand("list");

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");

    expect(output).toContain("No cached blocklist");
    expect(output).toContain("vskill blocklist sync");
  });

  it("defaults to list when no subcommand given", async () => {
    mocks.getCachedBlocklist.mockReturnValue(null);

    await blocklistCommand("list");

    expect(mocks.getCachedBlocklist).toHaveBeenCalled();
  });
});

describe("blocklist sync", () => {
  it("fetches from API and reports success", async () => {
    const cache = makeCache({ count: 22 });
    mocks.syncBlocklist.mockResolvedValue(cache);

    await blocklistCommand("sync");

    expect(mocks.syncBlocklist).toHaveBeenCalled();

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");

    expect(output).toContain("Synced");
    expect(output).toContain("22");
  });

  it("reports error when API fails", async () => {
    mocks.syncBlocklist.mockRejectedValue(new Error("Network error"));

    await blocklistCommand("sync");

    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");

    expect(output).toContain("Failed");
  });
});

describe("blocklist check", () => {
  it("reports when skill is blocked", async () => {
    mocks.checkBlocklist.mockResolvedValue(
      makeEntry({
        skillName: "evil-bot",
        threatType: "credential-theft",
        severity: "critical",
        reason: "Steals credentials",
        sourceRegistry: "clawhub",
      }),
    );

    await blocklistCommand("check", "evil-bot");

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");

    expect(output).toContain("BLOCKED");
    expect(output).toContain("evil-bot");
    expect(output).toContain("credential-theft");
  });

  it("reports when skill is not blocked", async () => {
    mocks.checkBlocklist.mockResolvedValue(null);

    await blocklistCommand("check", "safe-skill");

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");

    expect(output).toContain("safe-skill");
    expect(output).toContain("not blocklisted");
  });

  it("shows error when no name provided", async () => {
    await blocklistCommand("check");

    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");

    expect(output).toContain("Usage");
  });
});

describe("blocklist unknown subcommand", () => {
  it("shows usage hint for unknown subcommand", async () => {
    await blocklistCommand("foobar");

    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");

    expect(output).toContain("Unknown subcommand");
  });
});
