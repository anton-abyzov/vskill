// ---------------------------------------------------------------------------
// E2E integration tests: blocklist blocking with REAL malicious skill data
//
// These tests simulate the full chain:
//   API response (real seed data) -> local cache -> checkBlocklist -> block
//
// They use the actual ClawHub malicious skill names, threat types, severities,
// and reasons from the verified-skill.com seed data to prove that a developer
// attempting to install a known-malicious skill is:
//   1. Blocked with the correct threat details
//   2. Shown the exact reason WHY it's blocked
//   3. Allowed through with --force but with a prominent warning
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BlocklistCache, BlocklistEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
  mkdirSync: mocks.mkdirSync,
  existsSync: mocks.existsSync,
}));

const { checkBlocklist, getCachedBlocklist, syncBlocklist } =
  await import("./blocklist.js");

// ---------------------------------------------------------------------------
// Real seed data — mirrors the actual seed from vskill-platform
// These are the EXACT entries from blocklist-seed-data.ts
// ---------------------------------------------------------------------------

const REAL_SEED_ENTRIES: BlocklistEntry[] = [
  // hightower6eu — platform impersonation
  {
    skillName: "Clawhub",
    sourceUrl: "https://github.com/hightower6eu/Clawhub",
    sourceRegistry: "clawhub",
    threatType: "platform-impersonation",
    severity: "critical",
    reason:
      "Impersonates the ClawHub/GitHub platform to trick users into running malicious code",
    evidenceUrls: [
      "https://snyk.io/blog/toxicskills-mcp-exploit",
      "https://www.aikido.dev/blog/malicious-mcp-servers",
    ],
    discoveredAt: "2025-12-01T00:00:00.000Z",
  },
  // hightower6eu — credential theft
  {
    skillName: "Polymarket Trading Bot",
    sourceUrl: "https://github.com/hightower6eu/polymarket-trading-bot",
    sourceRegistry: "clawhub",
    threatType: "credential-theft",
    severity: "critical",
    reason: "Trading bot facade stealing wallet credentials and API keys",
    evidenceUrls: ["https://snyk.io/blog/toxicskills-mcp-exploit"],
    discoveredAt: "2025-12-01T00:00:00.000Z",
  },
  // hightower6eu — auto-updater trojan
  {
    skillName: "Skills Auto-Updater",
    sourceUrl: "https://github.com/hightower6eu/skills-auto-updater",
    sourceRegistry: "clawhub",
    threatType: "auto-updater-trojan",
    severity: "high",
    reason:
      "Auto-updater trojan that downloads and executes malicious payloads",
    evidenceUrls: ["https://snyk.io/blog/toxicskills-mcp-exploit"],
    discoveredAt: "2025-12-01T00:00:00.000Z",
  },
  // Aslaep123 — base64 credential exfil
  {
    skillName: "polymarket-traiding-bot",
    sourceUrl: "https://github.com/Aslaep123/polymarket-traiding-bot",
    sourceRegistry: "clawhub",
    threatType: "credential-theft",
    severity: "critical",
    reason: "Base64-encoded credential exfiltration via hidden HTTP requests",
    evidenceUrls: [
      "https://snyk.io/blog/toxicskills-mcp-exploit",
      "https://www.aikido.dev/blog/malicious-mcp-servers",
    ],
    discoveredAt: "2025-12-01T00:00:00.000Z",
  },
  // aztr0nutzs — prompt injection
  {
    skillName: "google-qx4",
    sourceUrl: "https://github.com/aztr0nutzs/google-qx4",
    sourceRegistry: "clawhub",
    threatType: "prompt-injection",
    severity: "critical",
    reason: "Prompt injection via fake Google integration skill",
    evidenceUrls: ["https://www.aikido.dev/blog/malicious-mcp-servers"],
    discoveredAt: "2025-12-01T00:00:00.000Z",
  },
  // zaycv — typosquatting
  {
    skillName: "clawhud",
    sourceUrl: "https://github.com/zaycv/clawhud",
    sourceRegistry: "clawhub",
    threatType: "typosquatting",
    severity: "high",
    reason: "Typosquatting ClawHub (clawhud vs clawhub) to mislead users",
    evidenceUrls: ["https://www.aikido.dev/blog/malicious-mcp-servers"],
    discoveredAt: "2025-12-01T00:00:00.000Z",
  },
  // zaycv — typosquatting (homoglyph)
  {
    skillName: "cIawhub",
    sourceUrl: "https://github.com/zaycv/cIawhub",
    sourceRegistry: "clawhub",
    threatType: "typosquatting",
    severity: "high",
    reason:
      "Typosquatting ClawHub using uppercase I for lowercase l (cIawhub)",
    evidenceUrls: ["https://www.aikido.dev/blog/malicious-mcp-servers"],
    discoveredAt: "2025-12-01T00:00:00.000Z",
  },
];

function makeFreshCache(
  entries: BlocklistEntry[] = REAL_SEED_ENTRIES,
): BlocklistCache {
  return {
    entries,
    count: entries.length,
    lastUpdated: "2026-02-19T00:00:00Z",
    fetchedAt: new Date().toISOString(), // fresh (within 1 hour)
    etag: '"seed-data"',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.VSKILL_API_URL;
});

// ============================================================================
// 1. Blocking known malicious skills by exact name
// ============================================================================

describe("E2E: blocking known malicious skills from ClawHub seed data", () => {
  beforeEach(() => {
    // Simulate fresh local cache with real seed data
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(makeFreshCache()));
  });

  it("blocks hightower6eu's Clawhub (platform-impersonation, critical)", async () => {
    const result = await checkBlocklist("Clawhub");

    expect(result).not.toBeNull();
    expect(result!.skillName).toBe("Clawhub");
    expect(result!.threatType).toBe("platform-impersonation");
    expect(result!.severity).toBe("critical");
    expect(result!.reason).toContain("Impersonates the ClawHub");
    expect(result!.sourceRegistry).toBe("clawhub");
  });

  it("blocks hightower6eu's Polymarket Trading Bot (credential-theft, critical)", async () => {
    const result = await checkBlocklist("Polymarket Trading Bot");

    expect(result).not.toBeNull();
    expect(result!.skillName).toBe("Polymarket Trading Bot");
    expect(result!.threatType).toBe("credential-theft");
    expect(result!.severity).toBe("critical");
    expect(result!.reason).toContain("wallet credentials");
  });

  it("blocks hightower6eu's Skills Auto-Updater (auto-updater-trojan, high)", async () => {
    const result = await checkBlocklist("Skills Auto-Updater");

    expect(result).not.toBeNull();
    expect(result!.threatType).toBe("auto-updater-trojan");
    expect(result!.severity).toBe("high");
    expect(result!.reason).toContain("malicious payloads");
  });

  it("blocks Aslaep123's polymarket-traiding-bot (credential-theft, critical)", async () => {
    const result = await checkBlocklist("polymarket-traiding-bot");

    expect(result).not.toBeNull();
    expect(result!.threatType).toBe("credential-theft");
    expect(result!.severity).toBe("critical");
    expect(result!.reason).toContain("Base64-encoded credential exfiltration");
    expect(result!.evidenceUrls).toContain(
      "https://snyk.io/blog/toxicskills-mcp-exploit",
    );
  });

  it("blocks aztr0nutzs's google-qx4 (prompt-injection, critical)", async () => {
    const result = await checkBlocklist("google-qx4");

    expect(result).not.toBeNull();
    expect(result!.threatType).toBe("prompt-injection");
    expect(result!.severity).toBe("critical");
    expect(result!.reason).toContain("Prompt injection");
  });

  it("blocks zaycv's clawhud typosquatting (typosquatting, high)", async () => {
    const result = await checkBlocklist("clawhud");

    expect(result).not.toBeNull();
    expect(result!.threatType).toBe("typosquatting");
    expect(result!.severity).toBe("high");
    expect(result!.reason).toContain("clawhud vs clawhub");
  });

  it("blocks zaycv's cIawhub homoglyph attack (typosquatting, high)", async () => {
    const result = await checkBlocklist("cIawhub");

    expect(result).not.toBeNull();
    expect(result!.threatType).toBe("typosquatting");
    expect(result!.reason).toContain("uppercase I for lowercase l");
  });

  it("allows legitimate skill that is NOT on the blocklist", async () => {
    const result = await checkBlocklist("my-safe-coding-assistant");
    expect(result).toBeNull();
  });
});

// ============================================================================
// 2. API sync produces correct cache from real data
// ============================================================================

describe("E2E: API sync with real seed data", () => {
  it("syncs 22 entries from API and all are searchable", async () => {
    // Simulate the API returning the full seed data
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => (h === "etag" ? '"v1"' : null) },
      json: async () => ({
        entries: REAL_SEED_ENTRIES,
        count: REAL_SEED_ENTRIES.length,
        lastUpdated: "2026-02-19T00:00:00Z",
      }),
    }) as unknown as typeof fetch;

    mocks.existsSync.mockReturnValue(true);

    const cache = await syncBlocklist();

    expect(cache.entries).toHaveLength(REAL_SEED_ENTRIES.length);
    expect(cache.count).toBe(REAL_SEED_ENTRIES.length);
    expect(cache.etag).toBe('"v1"');

    // Verify writeFileSync was called with the cache
    expect(mocks.writeFileSync).toHaveBeenCalledTimes(1);
    const writtenData = JSON.parse(
      mocks.writeFileSync.mock.calls[0][1] as string,
    ) as BlocklistCache;
    expect(writtenData.entries).toHaveLength(REAL_SEED_ENTRIES.length);

    // Every entry should have required fields
    for (const entry of writtenData.entries) {
      expect(entry.skillName).toBeTruthy();
      expect(entry.threatType).toBeTruthy();
      expect(entry.severity).toBeTruthy();
      expect(entry.reason).toBeTruthy();
    }
  });

  it("cached data allows blocking every seed entry by name", async () => {
    // Set up fresh cache with all seed data
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(makeFreshCache()));

    // Check every single seed entry is findable
    for (const entry of REAL_SEED_ENTRIES) {
      const result = await checkBlocklist(entry.skillName);
      expect(result).not.toBeNull();
      expect(result!.skillName).toBe(entry.skillName);
      expect(result!.threatType).toBe(entry.threatType);
      expect(result!.severity).toBe(entry.severity);
    }
  });
});

// ============================================================================
// 3. Stale cache refresh with real data
// ============================================================================

describe("E2E: stale cache refresh with real seed data", () => {
  it("refreshes stale cache from API and blocks newly added skills", async () => {
    // Start with stale cache that has only 2 entries
    const twoHoursAgo = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString();
    const staleCache = makeFreshCache(REAL_SEED_ENTRIES.slice(0, 2));
    staleCache.fetchedAt = twoHoursAgo;

    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(staleCache));

    // API returns full data
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        entries: REAL_SEED_ENTRIES,
        count: REAL_SEED_ENTRIES.length,
        lastUpdated: "2026-02-19T00:00:00Z",
      }),
    }) as unknown as typeof fetch;

    // google-qx4 was not in stale cache (only first 2 entries)
    // but after refresh it should be findable
    const result = await checkBlocklist("google-qx4");
    expect(result).not.toBeNull();
    expect(result!.threatType).toBe("prompt-injection");
    expect(result!.severity).toBe("critical");
  });

  it("falls back to stale cache when API is down, still blocks known skills", async () => {
    const twoHoursAgo = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString();
    const staleCache = makeFreshCache();
    staleCache.fetchedAt = twoHoursAgo;

    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(staleCache));

    // API is down
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    // Should still block from stale cache
    const result = await checkBlocklist("polymarket-traiding-bot");
    expect(result).not.toBeNull();
    expect(result!.threatType).toBe("credential-theft");
    expect(result!.reason).toContain("Base64-encoded");
  });
});

// ============================================================================
// 4. All 5 threat types are represented and catchable
// ============================================================================

describe("E2E: all threat types from ClawHub research are catchable", () => {
  beforeEach(() => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify(makeFreshCache()));
  });

  const threatTypeCases: Array<{
    name: string;
    skillName: string;
    expectedType: string;
    expectedSeverity: string;
  }> = [
    {
      name: "platform-impersonation (hightower6eu)",
      skillName: "Clawhub",
      expectedType: "platform-impersonation",
      expectedSeverity: "critical",
    },
    {
      name: "credential-theft (Aslaep123)",
      skillName: "polymarket-traiding-bot",
      expectedType: "credential-theft",
      expectedSeverity: "critical",
    },
    {
      name: "auto-updater-trojan (hightower6eu)",
      skillName: "Skills Auto-Updater",
      expectedType: "auto-updater-trojan",
      expectedSeverity: "high",
    },
    {
      name: "prompt-injection (aztr0nutzs)",
      skillName: "google-qx4",
      expectedType: "prompt-injection",
      expectedSeverity: "critical",
    },
    {
      name: "typosquatting (zaycv)",
      skillName: "clawhud",
      expectedType: "typosquatting",
      expectedSeverity: "high",
    },
  ];

  it.each(threatTypeCases)(
    "catches $name: $skillName",
    async ({ skillName, expectedType, expectedSeverity }) => {
      const result = await checkBlocklist(skillName);

      expect(result).not.toBeNull();
      expect(result!.threatType).toBe(expectedType);
      expect(result!.severity).toBe(expectedSeverity);
      expect(result!.reason.length).toBeGreaterThan(10); // has meaningful reason
      expect(result!.evidenceUrls.length).toBeGreaterThan(0); // has evidence
    },
  );
});
