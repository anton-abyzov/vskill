import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BlocklistCache, BlocklistEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted for ESM compatibility
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
  mkdirSync: mocks.mkdirSync,
  existsSync: mocks.existsSync,
}));

// Mock global fetch
const originalFetch = globalThis.fetch;

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------
const {
  checkBlocklist,
  syncBlocklist,
  getCachedBlocklist,
  isBlocklistStale,
} = await import("./blocklist.js");

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
  globalThis.fetch = mocks.fetch as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.VSKILL_API_URL;
});

describe("getCachedBlocklist", () => {
  it("returns null when cache file does not exist", () => {
    mocks.existsSync.mockReturnValue(false);
    expect(getCachedBlocklist()).toBeNull();
  });

  it("returns parsed cache when file exists", () => {
    const cache = makeCache();
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(cache));
    const result = getCachedBlocklist();
    expect(result).toEqual(cache);
  });

  it("returns null when cache file is corrupted", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue("not json{{{");
    expect(getCachedBlocklist()).toBeNull();
  });
});

describe("isBlocklistStale", () => {
  it("returns true when cache is older than 1 hour", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const cache = makeCache({ fetchedAt: twoHoursAgo });
    expect(isBlocklistStale(cache)).toBe(true);
  });

  it("returns false when cache is less than 1 hour old", () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const cache = makeCache({ fetchedAt: tenMinutesAgo });
    expect(isBlocklistStale(cache)).toBe(false);
  });

  it("returns true when fetchedAt is invalid", () => {
    const cache = makeCache({ fetchedAt: "invalid-date" });
    expect(isBlocklistStale(cache)).toBe(true);
  });
});

describe("syncBlocklist", () => {
  it("fetches from API and writes cache file", async () => {
    const apiResponse = {
      entries: [makeEntry()],
      count: 1,
      lastUpdated: "2026-02-01T00:00:00Z",
    };

    mocks.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => apiResponse,
    });

    mocks.existsSync.mockReturnValue(true);

    const result = await syncBlocklist();

    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://verified-skill.com/api/v1/blocklist",
      expect.any(Object),
    );
    expect(mocks.writeFileSync).toHaveBeenCalled();
    expect(result.entries).toEqual(apiResponse.entries);
    expect(result.count).toBe(1);
    expect(result.fetchedAt).toBeDefined();
  });

  it("uses VSKILL_API_URL environment variable when set", async () => {
    process.env.VSKILL_API_URL = "https://custom-api.example.com";

    const apiResponse = {
      entries: [],
      count: 0,
      lastUpdated: "2026-02-01T00:00:00Z",
    };

    mocks.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => apiResponse,
    });

    mocks.existsSync.mockReturnValue(true);

    await syncBlocklist();

    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://custom-api.example.com/api/v1/blocklist",
      expect.any(Object),
    );
  });

  it("creates ~/.vskill directory if it doesn't exist", async () => {
    const apiResponse = {
      entries: [],
      count: 0,
      lastUpdated: "2026-02-01T00:00:00Z",
    };

    mocks.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => apiResponse,
    });

    mocks.existsSync.mockReturnValue(false);

    await syncBlocklist();

    expect(mocks.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".vskill"),
      { recursive: true },
    );
  });

  it("stores etag from response headers", async () => {
    const apiResponse = {
      entries: [],
      count: 0,
      lastUpdated: "2026-02-01T00:00:00Z",
    };

    mocks.fetch.mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => (h === "etag" ? '"abc123"' : null) },
      json: async () => apiResponse,
    });

    mocks.existsSync.mockReturnValue(true);

    const result = await syncBlocklist();
    expect(result.etag).toBe('"abc123"');
  });

  it("throws when API returns non-ok response", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(syncBlocklist()).rejects.toThrow("Blocklist API error: 500");
  });
});

describe("checkBlocklist", () => {
  it("returns matching entry from fresh cache", async () => {
    const entry = makeEntry({ skillName: "evil-skill" });
    const cache = makeCache({
      entries: [entry],
      fetchedAt: new Date().toISOString(),
    });

    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(cache));

    const result = await checkBlocklist("evil-skill");
    expect(result).toEqual(entry);
  });

  it("returns null when skill is not in blocklist", async () => {
    const cache = makeCache({
      entries: [makeEntry({ skillName: "evil-skill" })],
      fetchedAt: new Date().toISOString(),
    });

    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(cache));

    const result = await checkBlocklist("safe-skill");
    expect(result).toBeNull();
  });

  it("refreshes cache when stale and API is available", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const staleCache = makeCache({
      entries: [makeEntry({ skillName: "old-evil" })],
      fetchedAt: twoHoursAgo,
    });

    const freshEntry = makeEntry({ skillName: "new-evil" });

    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(staleCache));

    mocks.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        entries: [freshEntry],
        count: 1,
        lastUpdated: "2026-02-19T00:00:00Z",
      }),
    });

    const result = await checkBlocklist("new-evil");
    expect(result).toEqual(freshEntry);
    expect(mocks.fetch).toHaveBeenCalled();
  });

  it("falls back to stale cache when API is unreachable", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const entry = makeEntry({ skillName: "evil-skill" });
    const staleCache = makeCache({
      entries: [entry],
      fetchedAt: twoHoursAgo,
    });

    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(staleCache));

    mocks.fetch.mockRejectedValue(new Error("Network error"));

    const result = await checkBlocklist("evil-skill");
    expect(result).toEqual(entry);
  });

  it("returns null when no cache exists and API is unreachable", async () => {
    mocks.existsSync.mockReturnValue(false);
    mocks.fetch.mockRejectedValue(new Error("Network error"));

    const result = await checkBlocklist("evil-skill");
    expect(result).toBeNull();
  });

  it("matches by contentHash when provided", async () => {
    const entry = makeEntry({
      skillName: "evil-skill",
      contentHash: "sha256:abc123",
    });
    const cache = makeCache({
      entries: [entry],
      fetchedAt: new Date().toISOString(),
    });

    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(cache));

    const result = await checkBlocklist("different-name", "sha256:abc123");
    expect(result).toEqual(entry);
  });

  it("matches by name even when contentHash doesn't match", async () => {
    const entry = makeEntry({
      skillName: "evil-skill",
      contentHash: "sha256:different",
    });
    const cache = makeCache({
      entries: [entry],
      fetchedAt: new Date().toISOString(),
    });

    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(cache));

    const result = await checkBlocklist("evil-skill", "sha256:nomatch");
    expect(result).toEqual(entry);
  });
});
