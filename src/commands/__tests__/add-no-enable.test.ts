// ---------------------------------------------------------------------------
// Tests for the 0724 T-006 helpers added to add.ts:
//   - enableAfterInstall()  (--no-enable, --scope, --dry-run, auto-discovered)
//   - rollbackInstall()     (AC-US1-05 rollback on claude CLI failure)
//
// Note: add.ts is a 2.6kloc monolith. Rather than try to drive the whole
// addCommand() wormhole through mocks, we exercise the new helpers
// directly. The integration of the helper into the marketplace install
// path is covered by the e2e suite (T-010) and the idempotency-rollback
// suite (T-012).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ---------------------------------------------------------------

const mockClaudePluginInstall = vi.fn();

vi.mock("../../utils/claude-plugin.js", () => ({
  claudePluginInstall: (...args: unknown[]) => mockClaudePluginInstall(...args),
}));

const mockExistsSync = vi.fn(() => true);
const mockRmSync = vi.fn();

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
  };
});

const mockRemoveSkillFromLock = vi.fn();

vi.mock("../../lockfile/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../lockfile/index.js")>(
      "../../lockfile/index.js",
    );
  return {
    ...actual,
    removeSkillFromLock: (...args: unknown[]) => mockRemoveSkillFromLock(...args),
  };
});

// ---- import the SUT (drives helpers via the exported wrappers) ----------

// We can't import `enableAfterInstall` / `rollbackInstall` because they're
// internal to add.ts. Instead, we re-import the symbols via a tiny shim
// that re-exports them for tests. To keep this self-contained, we use a
// dedicated test fixture file.

// In practice we drive both helpers by importing add.ts and invoking via
// a local re-export (added below in the test fixture). To keep the change
// small we test the observable behaviour through the helper signatures
// directly, by importing them off `add.js` *after* exporting them.

import {
  enableAfterInstall,
  rollbackInstall,
} from "../add.js";
import type { AgentDefinition } from "../../agents/agents-registry.js";

// ---- fixtures ------------------------------------------------------------

const CLAUDE_AGENT: AgentDefinition = {
  id: "claude-code",
  displayName: "Claude Code",
  localSkillsDir: ".claude/skills",
  globalSkillsDir: "~/.claude/skills",
  isUniversal: false,
  detectInstalled: () => Promise.resolve(true),
  parentCompany: "Anthropic",
  featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
};

const ENTRY_MARKETPLACE = { marketplace: "m" } as const;
const ENTRY_AUTO = {} as const; // no marketplace

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

// ---- enableAfterInstall --------------------------------------------------

describe("enableAfterInstall", () => {
  it("AC-US1-01: marketplace plugin + default --enable -> calls claudePluginInstall once", () => {
    const r = enableAfterInstall("foo", ENTRY_MARKETPLACE, { enable: true });
    expect(mockClaudePluginInstall).toHaveBeenCalledTimes(1);
    expect(mockClaudePluginInstall).toHaveBeenCalledWith(
      "foo@m",
      "project",
      expect.objectContaining({ cwd: expect.any(String) }),
    );
    expect(r.invoked).toBe(true);
    expect(r.pluginId).toBe("foo@m");
  });

  it("AC-US1-02: --no-enable (enable === false) -> no subprocess; returns invoked=false", () => {
    const r = enableAfterInstall("foo", ENTRY_MARKETPLACE, { enable: false });
    expect(mockClaudePluginInstall).not.toHaveBeenCalled();
    expect(r.invoked).toBe(false);
    expect(r.pluginId).toBe("foo@m");
  });

  it("AC-US1-03: --scope user routes to user scope, no cwd", () => {
    enableAfterInstall("foo", ENTRY_MARKETPLACE, { enable: true, scope: "user" });
    expect(mockClaudePluginInstall).toHaveBeenCalledWith("foo@m", "user", undefined);
  });

  it("AC-US1-03: --scope project routes to project scope with cwd", () => {
    enableAfterInstall("foo", ENTRY_MARKETPLACE, {
      enable: true,
      scope: "project",
    });
    expect(mockClaudePluginInstall).toHaveBeenCalledWith(
      "foo@m",
      "project",
      expect.objectContaining({ cwd: expect.any(String) }),
    );
  });

  it("AC-US1-03: --global maps to user scope when no explicit --scope", () => {
    enableAfterInstall("foo", ENTRY_MARKETPLACE, { enable: true, global: true });
    expect(mockClaudePluginInstall).toHaveBeenCalledWith("foo@m", "user", undefined);
  });

  it("AC-US1-04: non-marketplace entry -> never invoked, prints auto-discovered message", () => {
    const r = enableAfterInstall("foo", ENTRY_AUTO, { enable: true });
    expect(mockClaudePluginInstall).not.toHaveBeenCalled();
    expect(r.invoked).toBe(false);
    expect(r.pluginId).toBeNull();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Auto-discovered/i);
  });

  it("AC-US6-01: --dry-run prints the would-be invocation, no subprocess", () => {
    enableAfterInstall("foo", ENTRY_MARKETPLACE, { enable: true, dryRun: true });
    expect(mockClaudePluginInstall).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/claude plugin install/);
    expect(out).toMatch(/foo@m/);
  });

  it("AC-US1-05: throws are propagated to caller (caller does the rollback)", () => {
    mockClaudePluginInstall.mockImplementation(() => {
      throw new Error("claude CLI exit 1");
    });
    expect(() =>
      enableAfterInstall("foo", ENTRY_MARKETPLACE, { enable: true }),
    ).toThrow(/claude CLI exit 1/);
  });
});

// ---- rollbackInstall -----------------------------------------------------

describe("rollbackInstall", () => {
  it("AC-US1-05: removes the skill dir for every agent and removes lockfile entry", () => {
    rollbackInstall("foo", [CLAUDE_AGENT], { enable: true });
    expect(mockRmSync).toHaveBeenCalled();
    const removed = mockRmSync.mock.calls.map((c) => c[0] as string).join("\n");
    expect(removed).toMatch(/foo$/);
    expect(mockRemoveSkillFromLock).toHaveBeenCalledWith("foo");
  });

  it("is best-effort: a single rm failure does not suppress lockfile removal", () => {
    mockRmSync.mockImplementationOnce(() => {
      throw new Error("permission denied");
    });
    expect(() => rollbackInstall("foo", [CLAUDE_AGENT], {})).not.toThrow();
    expect(mockRemoveSkillFromLock).toHaveBeenCalledWith("foo");
  });
});
