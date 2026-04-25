// ---------------------------------------------------------------------------
// 0724 T-010: enable / disable / list round-trip integration test.
//
// Drives `enableCommand` and `disableCommand` end-to-end through a real
// vskill.lock and a real (mocked-binary) claude CLI, then asserts the
// observable state at each step:
//   - lockfile entry survives the round-trip
//   - on-disk skill files survive the round-trip
//   - settings.json `enabledPlugins` returns to the post-install state
//
// `claude` itself is mocked at the `claudePluginInstall` /
// `claudePluginUninstall` boundary so the test runs without a claude
// binary installed. The mocks mutate a shared in-memory settings.json
// so the assertions exercise the real readers in `settings/settings.ts`.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---- in-memory settings.json simulation ---------------------------------

let userSettings: { enabledPlugins?: Record<string, boolean> } = {};

function writeUserSettings(): void {
  // simulate what `claude plugin install` would write to ~/.claude/settings.json
  const dir = join(fakeHome, ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify(userSettings), "utf-8");
}

const mockClaudePluginInstall = vi.fn((id: string) => {
  userSettings.enabledPlugins = { ...(userSettings.enabledPlugins ?? {}), [id]: true };
  writeUserSettings();
});

const mockClaudePluginUninstall = vi.fn((id: string) => {
  if (userSettings.enabledPlugins) {
    delete userSettings.enabledPlugins[id];
  }
  writeUserSettings();
});

vi.mock("../utils/claude-plugin.js", () => ({
  claudePluginInstall: (...args: unknown[]) => mockClaudePluginInstall(...(args as [string])),
  claudePluginUninstall: (...args: unknown[]) => mockClaudePluginUninstall(...(args as [string])),
}));

// ---- mock detectInstalledAgents to return claude-code only --------------

vi.mock("../agents/agents-registry.js", () => ({
  detectInstalledAgents: vi.fn(async () => [
    {
      id: "claude-code",
      displayName: "Claude Code",
      localSkillsDir: ".claude/skills",
      globalSkillsDir: "~/.claude/skills",
      isUniversal: false,
      detectInstalled: () => Promise.resolve(true),
      parentCompany: "Anthropic",
      featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
    },
  ]),
  AGENTS_REGISTRY: [],
}));

// ---- redirect homedir() so settings.ts reads our temp dir ---------------

let fakeHome: string;

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    default: { ...actual, homedir: () => fakeHome },
    homedir: () => fakeHome,
    tmpdir: actual.tmpdir,
  };
});

// ---- redirect lockfile to a temp-dir pinned project root -----------------

let projectRoot: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

vi.mock("../lockfile/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../lockfile/index.js")>(
      "../lockfile/index.js",
    );
  return actual;
});

// ---- imports (after mocks) ----------------------------------------------

const { enableCommand } = await import("../commands/enable.js");
const { disableCommand } = await import("../commands/disable.js");
const { listCommand } = await import("../commands/list.js");
const { writeLockfile } = await import("../lockfile/index.js");

// ---- helpers ------------------------------------------------------------

function readSettingsRaw(): { enabledPlugins?: Record<string, boolean> } {
  const p = join(fakeHome, ".claude", "settings.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf-8"));
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-0724-home-"));
  projectRoot = mkdtempSync(join(tmpdir(), "vskill-0724-proj-"));
  userSettings = {};
  writeUserSettings();
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
  // seed lockfile with foo
  writeLockfile(
    {
      version: 1,
      agents: ["claude-code"],
      skills: {
        foo: {
          version: "1.0.0",
          sha: "deadbeef",
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "marketplace:o/r#foo",
          marketplace: "m",
          pluginDir: true,
          scope: "user",
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    projectRoot,
  );
  // seed on-disk skill dir (simulates a successful prior install)
  const skillDir = join(fakeHome, ".claude", "skills", "foo");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: foo\n---\n", "utf-8");
});

afterEach(() => {
  cwdSpy.mockRestore();
  try {
    rmSync(fakeHome, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  try {
    rmSync(projectRoot, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// ---- AC-US6-03: enable / disable / enable returns settings to post-install state

describe("enable-disable round-trip (T-010)", () => {
  it("AC-US6-03: enable -> disable -> enable returns enabledPlugins to byte-equal state", async () => {
    // Pre-condition: settings.json starts empty (skill on disk but disabled).
    expect(readSettingsRaw().enabledPlugins ?? {}).toEqual({});

    // Step 1: enable foo. Capture post-install state.
    await enableCommand("foo", { scope: "user" });
    const postEnable = JSON.stringify(readSettingsRaw().enabledPlugins);
    expect(JSON.parse(postEnable)).toEqual({ "foo@m": true });

    // Step 2: disable foo. Capture post-disable state.
    await disableCommand("foo", { scope: "user" });
    expect(readSettingsRaw().enabledPlugins ?? {}).toEqual({});

    // Step 3: enable foo again. Compare against postEnable.
    await enableCommand("foo", { scope: "user" });
    const postReEnable = JSON.stringify(readSettingsRaw().enabledPlugins);
    expect(postReEnable).toBe(postEnable);
  });

  it("on-disk skill dir survives the round-trip", async () => {
    const skillDir = join(fakeHome, ".claude", "skills", "foo");
    expect(existsSync(skillDir)).toBe(true);
    await enableCommand("foo", { scope: "user" });
    expect(existsSync(skillDir)).toBe(true);
    await disableCommand("foo", { scope: "user" });
    expect(existsSync(skillDir)).toBe(true);
  });

  it("vskill.lock entry survives the round-trip", async () => {
    const lockPath = join(projectRoot, "vskill.lock");
    expect(existsSync(lockPath)).toBe(true);
    await enableCommand("foo", { scope: "user" });
    expect(JSON.parse(readFileSync(lockPath, "utf-8")).skills.foo).toBeDefined();
    await disableCommand("foo", { scope: "user" });
    expect(JSON.parse(readFileSync(lockPath, "utf-8")).skills.foo).toBeDefined();
  });

  it("list --installed reflects state after enable then disable", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await enableCommand("foo", { scope: "user" });
    logSpy.mockClear();
    await listCommand({ installed: true, json: true });
    let json = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1].join(" "));
    expect(json[0].enabledUser).toBe(true);

    await disableCommand("foo", { scope: "user" });
    logSpy.mockClear();
    await listCommand({ installed: true, json: true });
    json = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1].join(" "));
    expect(json[0].enabledUser).toBe(false);

    logSpy.mockRestore();
  });
});
