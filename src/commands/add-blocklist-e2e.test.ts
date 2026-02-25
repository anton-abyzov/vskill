// ---------------------------------------------------------------------------
// E2E integration tests: vskill install with blocklist enforcement
//
// Tests the FULL error output chain when a user tries to install
// known-malicious skills from the ClawHub research. Verifies:
//   1. Installation is REFUSED with exit code 1
//   2. Error message shows exact threat type, severity, and reason
//   3. --force override shows prominent WARNING box with full details
//   4. Tier 1 scan is NEVER reached for blocked skills (without --force)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockCpSync = vi.fn();
const mockChmodSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();

vi.mock("node:fs", () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  cpSync: (...args: unknown[]) => mockCpSync(...args),
  chmodSync: (...args: unknown[]) => mockChmodSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  copyFileSync: vi.fn(),
}));

vi.mock("node:path", async () => {
  const actual =
    await vi.importActual<typeof import("node:path")>("node:path");
  return { ...actual, join: (...args: string[]) => actual.join(...args) };
});

const mockDigest = vi.fn().mockReturnValue("abcdef123456xxxx");
const mockUpdate = vi.fn().mockReturnValue({ digest: mockDigest });
vi.mock("node:crypto", () => ({
  createHash: () => ({ update: mockUpdate }),
}));

const mockDetectInstalledAgents = vi.fn();
vi.mock("../agents/agents-registry.js", () => ({
  detectInstalledAgents: (...args: unknown[]) =>
    mockDetectInstalledAgents(...args),
}));

const mockEnsureLockfile = vi.fn();
const mockWriteLockfile = vi.fn();
vi.mock("../lockfile/index.js", () => ({
  ensureLockfile: (...args: unknown[]) => mockEnsureLockfile(...args),
  writeLockfile: (...args: unknown[]) => mockWriteLockfile(...args),
}));

const mockRunTier1Scan = vi.fn();
vi.mock("../scanner/index.js", () => ({
  runTier1Scan: (...args: unknown[]) => mockRunTier1Scan(...args),
}));

const mockCheckPlatformSecurity = vi.fn();
vi.mock("../security/index.js", () => ({
  checkPlatformSecurity: (...args: unknown[]) =>
    mockCheckPlatformSecurity(...args),
}));

// ---- REAL blocklist module (not mocked!) ----
// We mock only the filesystem layer so checkBlocklist reads from our test cache.
// The blocklist module itself runs its real logic.

// Mock output utilities to capture colored output as plain text
vi.mock("../utils/output.js", () => ({
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
  spinner: () => ({ stop: vi.fn() }),
}));

const { addCommand } = await import("./add.js");

// ---------------------------------------------------------------------------
// Seed data cache — same data that the API would return
// ---------------------------------------------------------------------------

const SEED_CACHE = {
  entries: [
    {
      skillName: "Clawhub",
      sourceUrl: "https://github.com/hightower6eu/Clawhub",
      sourceRegistry: "clawhub",
      threatType: "platform-impersonation",
      severity: "critical",
      reason:
        "Impersonates the ClawHub/GitHub platform to trick users into running malicious code",
      evidenceUrls: ["https://snyk.io/blog/toxicskills-mcp-exploit"],
      discoveredAt: "2025-12-01T00:00:00.000Z",
    },
    {
      skillName: "polymarket-traiding-bot",
      sourceUrl: "https://github.com/Aslaep123/polymarket-traiding-bot",
      sourceRegistry: "clawhub",
      threatType: "credential-theft",
      severity: "critical",
      reason: "Base64-encoded credential exfiltration via hidden HTTP requests",
      evidenceUrls: ["https://snyk.io/blog/toxicskills-mcp-exploit"],
      discoveredAt: "2025-12-01T00:00:00.000Z",
    },
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
  ],
  count: 5,
  lastUpdated: "2026-02-19T00:00:00Z",
  fetchedAt: new Date().toISOString(),
  etag: '"seed"',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupBlocklistCache() {
  // The blocklist module reads from ~/.vskill/blocklist.json
  // We intercept existsSync and readFileSync to serve our seed cache
  const originalExistsSync = mockExistsSync.getMockImplementation();
  mockExistsSync.mockImplementation((p: string) => {
    if (p.includes("blocklist.json")) return true;
    if (originalExistsSync) return originalExistsSync(p);
    return false;
  });

  const originalReadFileSync = mockReadFileSync.getMockImplementation();
  mockReadFileSync.mockImplementation((p: string, ...args: unknown[]) => {
    if (p.includes("blocklist.json")) return JSON.stringify(SEED_CACHE);
    if (originalReadFileSync) return originalReadFileSync(p, ...args);
    return "";
  });
}

function collectOutput(
  spy: ReturnType<typeof vi.spyOn>,
): string {
  return spy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockCheckPlatformSecurity.mockResolvedValue(null);

  // Mock fetch: blocklist check API returns 503 (forcing fallback to local cache),
  // all other requests (e.g. fetching SKILL.md from GitHub) succeed normally.
  globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes("/api/v1/blocklist/check")) {
      return { ok: false, status: 503, statusText: "Service Unavailable" };
    }
    return {
      ok: true,
      text: async () => "# Safe Skill\nNormal content",
      json: async () => ({ entries: [], count: 0, lastUpdated: null }),
      headers: { get: () => null },
    };
  }) as unknown as typeof fetch;

  setupBlocklistCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ============================================================================
// 1. GitHub path — blocking with exact error details
// ============================================================================

describe("E2E: vskill install blocks ClawHub malicious skills (GitHub path)", () => {
  it("refuses to install hightower6eu's Clawhub with full threat details", async () => {
    const mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => {
        throw new Error("process.exit");
      });

    await expect(
      addCommand("hightower6eu/Clawhub", {}),
    ).rejects.toThrow("process.exit");

    const errorOutput = collectOutput(
      console.error as ReturnType<typeof vi.fn>,
    );

    // Must show BLOCKED status
    expect(errorOutput).toContain("BLOCKED");

    // Must show the exact skill name
    expect(errorOutput).toContain("Clawhub");

    // Must show the threat type
    expect(errorOutput).toContain("platform-impersonation");

    // Must show the severity
    expect(errorOutput).toContain("critical");

    // Must show the reason WHY
    expect(errorOutput).toContain("Impersonates the ClawHub");

    // Must show how to override
    expect(errorOutput).toContain("--force");

    // Exit code must be 1
    expect(mockExit).toHaveBeenCalledWith(1);

    // Tier 1 scan must NEVER be called (blocked before scan)
    expect(mockRunTier1Scan).not.toHaveBeenCalled();

    mockExit.mockRestore();
  });

  it("refuses to install Aslaep123's credential-stealing bot with Base64 exfil details", async () => {
    const mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => {
        throw new Error("process.exit");
      });

    await expect(
      addCommand("Aslaep123/polymarket-traiding-bot", {}),
    ).rejects.toThrow("process.exit");

    const errorOutput = collectOutput(
      console.error as ReturnType<typeof vi.fn>,
    );

    expect(errorOutput).toContain("BLOCKED");
    expect(errorOutput).toContain("polymarket-traiding-bot");
    expect(errorOutput).toContain("credential-theft");
    expect(errorOutput).toContain("critical");
    expect(errorOutput).toContain("Base64-encoded credential exfiltration");
    expect(mockRunTier1Scan).not.toHaveBeenCalled();

    mockExit.mockRestore();
  });

  it("refuses to install aztr0nutzs's prompt injection skill", async () => {
    const mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => {
        throw new Error("process.exit");
      });

    await expect(
      addCommand("aztr0nutzs/google-qx4", {}),
    ).rejects.toThrow("process.exit");

    const errorOutput = collectOutput(
      console.error as ReturnType<typeof vi.fn>,
    );

    expect(errorOutput).toContain("BLOCKED");
    expect(errorOutput).toContain("google-qx4");
    expect(errorOutput).toContain("prompt-injection");
    expect(errorOutput).toContain("critical");
    expect(errorOutput).toContain("Prompt injection");
    expect(mockRunTier1Scan).not.toHaveBeenCalled();

    mockExit.mockRestore();
  });

  it("refuses to install zaycv's typosquatting skill", async () => {
    const mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => {
        throw new Error("process.exit");
      });

    await expect(
      addCommand("zaycv/clawhud", {}),
    ).rejects.toThrow("process.exit");

    const errorOutput = collectOutput(
      console.error as ReturnType<typeof vi.fn>,
    );

    expect(errorOutput).toContain("BLOCKED");
    expect(errorOutput).toContain("clawhud");
    expect(errorOutput).toContain("typosquatting");
    expect(errorOutput).toContain("high");
    expect(errorOutput).toContain("clawhud vs clawhub");

    mockExit.mockRestore();
  });
});

// ============================================================================
// 2. --force override shows WARNING with full details
// ============================================================================

describe("E2E: --force override shows warning box with threat details", () => {
  it("shows credential-theft warning box but continues for polymarket-traiding-bot", async () => {
    mockRunTier1Scan.mockReturnValue({
      verdict: "PASS",
      findings: [],
      score: 100,
      patternsChecked: 37,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      durationMs: 1,
    });
    mockDetectInstalledAgents.mockResolvedValue([
      {
        id: "claude-code",
        displayName: "Claude Code",
        localSkillsDir: ".claude/commands",
        globalSkillsDir: "~/.claude/commands",
      },
    ]);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await addCommand("Aslaep123/polymarket-traiding-bot", { force: true });

    const errorOutput = collectOutput(
      console.error as ReturnType<typeof vi.fn>,
    );

    // WARNING box must be shown
    expect(errorOutput).toContain("WARNING");
    expect(errorOutput).toContain("known-malicious");

    // Must show full threat details in the warning
    expect(errorOutput).toContain("polymarket-traiding-bot");
    expect(errorOutput).toContain("credential-theft");
    expect(errorOutput).toContain("critical");
    expect(errorOutput).toContain("Base64-encoded credential exfiltration");

    // Must show --force was used
    expect(errorOutput).toContain("--force");

    // Despite the warning, Tier 1 scan MUST proceed
    expect(mockRunTier1Scan).toHaveBeenCalled();
  });

  it("shows platform-impersonation warning for Clawhub with --force", async () => {
    mockRunTier1Scan.mockReturnValue({
      verdict: "PASS",
      findings: [],
      score: 100,
      patternsChecked: 37,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      durationMs: 1,
    });
    mockDetectInstalledAgents.mockResolvedValue([
      {
        id: "claude-code",
        displayName: "Claude Code",
        localSkillsDir: ".claude/commands",
        globalSkillsDir: "~/.claude/commands",
      },
    ]);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await addCommand("hightower6eu/Clawhub", { force: true });

    const errorOutput = collectOutput(
      console.error as ReturnType<typeof vi.fn>,
    );

    expect(errorOutput).toContain("WARNING");
    expect(errorOutput).toContain("Clawhub");
    expect(errorOutput).toContain("platform-impersonation");
    expect(errorOutput).toContain("critical");
    expect(errorOutput).toContain("Impersonates the ClawHub");

    expect(mockRunTier1Scan).toHaveBeenCalled();
  });
});

// ============================================================================
// 3. Safe skills pass through without blocklist interference
// ============================================================================

describe("E2E: safe skills are not affected by blocklist", () => {
  it("installs legitimate skill without any BLOCKED or WARNING output", async () => {
    mockRunTier1Scan.mockReturnValue({
      verdict: "PASS",
      findings: [],
      score: 100,
      patternsChecked: 37,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      durationMs: 1,
    });
    mockDetectInstalledAgents.mockResolvedValue([
      {
        id: "claude-code",
        displayName: "Claude Code",
        localSkillsDir: ".claude/commands",
        globalSkillsDir: "~/.claude/commands",
      },
    ]);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await addCommand("anthropic/code-review-assistant", {});

    const allErrorOutput = collectOutput(
      console.error as ReturnType<typeof vi.fn>,
    );

    // No BLOCKED or WARNING messages
    expect(allErrorOutput).not.toContain("BLOCKED");
    expect(allErrorOutput).not.toContain("WARNING");
    expect(allErrorOutput).not.toContain("malicious");

    // Tier 1 scan MUST proceed
    expect(mockRunTier1Scan).toHaveBeenCalled();

    // Lockfile MUST be updated
    expect(mockEnsureLockfile).toHaveBeenCalled();
  });
});
