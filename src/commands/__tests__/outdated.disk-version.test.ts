// ---------------------------------------------------------------------------
// 0740 T-009 — outdated reports DISK version, not lockfile pin
// ---------------------------------------------------------------------------
// Bug: bell/toast says "1.0.0 → 1.0.6" while sidebar shows the on-disk
// 1.3.0 because outdated.ts reads `currentVersion` from the lockfile. After
// 0740, the command reads from the SKILL.md frontmatter at the resolved
// install path, falling back to the lockfile only when disk is unreadable.
// When disk version >= latest, `updateAvailable` is forced to false.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tmpRoot: string;
let exitCode: number | null;
let logBuf: string[];

const checkUpdatesMock = vi.hoisted(() => vi.fn());
const readLockfileMock = vi.hoisted(() => vi.fn());
const getProjectRootMock = vi.hoisted(() => vi.fn());

vi.mock("../../api/client.js", () => ({
  checkUpdates: checkUpdatesMock,
}));
vi.mock("../../lockfile/lockfile.js", () => ({
  readLockfile: readLockfileMock,
  writeLockfile: vi.fn(),
}));
vi.mock("../../lockfile/project-root.js", () => ({
  getProjectRoot: getProjectRootMock,
}));

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-0740-outdated-"));
  exitCode = null;
  logBuf = [];
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    return undefined as never;
  }) as never);
  vi.spyOn(console, "log").mockImplementation((m: string) => {
    logBuf.push(String(m));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  checkUpdatesMock.mockReset();
  readLockfileMock.mockReset();
  getProjectRootMock.mockReset().mockReturnValue(tmpRoot);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeInstalledSkillMd(name: string, version: string): void {
  const dir = join(tmpRoot, ".claude", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\nmetadata:\n  version: ${version}\n---\n# ${name}\n`);
}

describe("0740 outdatedCommand — disk version reconcile", () => {
  it("emits disk version as `installed` when disk drifts from lockfile", async () => {
    // Disk says 1.3.0, lockfile says 1.0.0. Platform `latest` is 1.0.6.
    writeInstalledSkillMd("obsidian-brain", "1.3.0");
    readLockfileMock.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        "obsidian-brain": {
          version: "1.0.0",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-04-15T00:00:00Z",
          source: "github:anton-abyzov/vskill",
        },
      },
      createdAt: "",
      updatedAt: "",
    });
    checkUpdatesMock.mockImplementation(async (items) => [
      {
        name: items[0].name,
        installed: items[0].currentVersion,
        latest: "1.0.6",
        updateAvailable: true,
      },
    ]);

    const { outdatedCommand } = await import("../outdated.js");
    await outdatedCommand({ json: true });

    // Platform was called with disk version, not lockfile pin
    expect(checkUpdatesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "anton-abyzov/vskill/obsidian-brain",
        currentVersion: "1.3.0",
      }),
    ]);

    // Output JSON has `installed: "1.3.0"` and `updateAvailable: false`
    // (because disk 1.3.0 >= latest 1.0.6).
    const json = JSON.parse(logBuf[logBuf.length - 1]);
    expect(json[0].installed).toBe("1.3.0");
    expect(json[0].updateAvailable).toBe(false);
    expect(exitCode === 0 || exitCode === null).toBe(true); // no outdated → no exit-1
  });

  it("falls back to lockfile version with warning when SKILL.md is missing", async () => {
    // No file written — disk read fails.
    readLockfileMock.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        "obsidian-brain": {
          version: "1.0.0",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-04-15T00:00:00Z",
          source: "github:anton-abyzov/vskill",
        },
      },
      createdAt: "",
      updatedAt: "",
    });
    checkUpdatesMock.mockImplementation(async (items) => [
      {
        name: items[0].name,
        installed: items[0].currentVersion,
        latest: "1.0.6",
        updateAvailable: true,
      },
    ]);

    const { outdatedCommand } = await import("../outdated.js");
    await outdatedCommand({ json: true });

    // Platform got the lockfile fallback
    expect(checkUpdatesMock).toHaveBeenCalledWith([
      expect.objectContaining({ currentVersion: "1.0.0" }),
    ]);

    const json = JSON.parse(logBuf[logBuf.length - 1]);
    expect(json[0].installed).toBe("1.0.0");
    expect(json[0].updateAvailable).toBe(true); // 1.0.0 < 1.0.6, real update
    expect(json[0].warning).toMatch(/disk version unreadable/);
    expect(exitCode).toBe(1); // outdated rows present
  });

  it("when disk version equals latest, updateAvailable is false (no spurious arrow)", async () => {
    writeInstalledSkillMd("foo", "1.0.6");
    readLockfileMock.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        foo: {
          version: "1.0.0",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-04-15T00:00:00Z",
          source: "github:anton-abyzov/vskill",
        },
      },
      createdAt: "",
      updatedAt: "",
    });
    checkUpdatesMock.mockImplementation(async (items) => [
      {
        name: items[0].name,
        installed: items[0].currentVersion,
        latest: "1.0.6",
        updateAvailable: true, // platform thinks update is needed
      },
    ]);

    const { outdatedCommand } = await import("../outdated.js");
    await outdatedCommand({ json: true });

    const json = JSON.parse(logBuf[logBuf.length - 1]);
    expect(json[0].installed).toBe("1.0.6");
    expect(json[0].updateAvailable).toBe(false);
    expect(exitCode === 0 || exitCode === null).toBe(true);
  });

  it("when disk version equals lockfile, no warning, no override", async () => {
    writeInstalledSkillMd("foo", "1.0.0");
    readLockfileMock.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        foo: {
          version: "1.0.0",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-04-15T00:00:00Z",
          source: "github:anton-abyzov/vskill",
        },
      },
      createdAt: "",
      updatedAt: "",
    });
    checkUpdatesMock.mockImplementation(async (items) => [
      {
        name: items[0].name,
        installed: items[0].currentVersion,
        latest: "1.0.6",
        updateAvailable: true,
      },
    ]);

    const { outdatedCommand } = await import("../outdated.js");
    await outdatedCommand({ json: true });

    const json = JSON.parse(logBuf[logBuf.length - 1]);
    expect(json[0].installed).toBe("1.0.0");
    expect(json[0].updateAvailable).toBe(true);
    expect(json[0].warning).toBeUndefined();
  });
});
