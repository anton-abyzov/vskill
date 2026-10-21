// 0894 — POST /api/studio/remove-skill must not delete the shared canonical
// folder (.agents/skills/<name>) while another agent still loads it, and must
// clean up a shared reader's old per-agent link together with the canonical
// copy. Runs against a real temp project (project scope only, never $HOME).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mocks = vi.hoisted(() => ({
  sendJson: vi.fn(),
  readBody: vi.fn(),
}));

vi.mock("../router.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, sendJson: mocks.sendJson, readBody: mocks.readBody };
});

const { registerRemoveSkillRoutes } = await import("../remove-skill-routes.js");
const { writeLockfile, readLockfile } = await import("../../lockfile/lockfile.js");
const { getAgent } = await import("../../agents/agents-registry.js");

let root: string;

function handler() {
  let h: any;
  const router: any = { post: vi.fn((_p: string, fn: any) => { h = fn; }), get: vi.fn() };
  registerRemoveSkillRoutes(router, () => root);
  return h;
}

async function post(body: Record<string, unknown>) {
  mocks.readBody.mockResolvedValueOnce(body);
  const req: any = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };
  await handler()(req, {} as any);
  const call = mocks.sendJson.mock.calls.at(-1)!;
  return { body: call[1], status: call[2] };
}

function writeSkill(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: foo\ndescription: d\n---\nbody\n");
}

function link(target: string, linkPath: string) {
  mkdirSync(join(linkPath, ".."), { recursive: true });
  symlinkSync(target, linkPath, "dir");
}

function lexists(p: string) {
  try { lstatSync(p); return true; } catch { return false; }
}

function lock(agents: string[]) {
  writeLockfile({
    version: 1,
    agents,
    skills: { foo: { version: "1.0.0", sha: "x", tier: "VERIFIED", installedAt: "now", source: "github:o/r" } },
    createdAt: "now",
    updatedAt: "now",
  }, root);
}

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), "vskill-remove-route-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("0894 — remove-skill keeps the shared canonical copy other agents use", () => {
  it("refuses a Cursor-only remove while Codex and a Claude link still load .agents/skills/foo", async () => {
    const canonical = join(root, ".agents/skills/foo");
    writeSkill(canonical);
    link("../../.agents/skills/foo", join(root, ".claude/skills/foo"));
    lock(["claude-code", "cursor", "codex"]);

    const { body } = await post({ skill: "foo", agentIds: ["cursor"], scope: "project" });

    expect(body.removed).toEqual([]);
    expect(body.skipped[0].agentId).toBe("cursor");
    expect(body.skipped[0].reason).toMatch(/^shared:/);
    expect(body.skipped[0].sharedWith).toEqual(expect.arrayContaining(["claude-code", "codex"]));
    expect(existsSync(join(canonical, "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".claude/skills/foo/SKILL.md"))).toBe(true);
    expect(readLockfile(root)?.skills.foo).toBeDefined();
  });

  it("refuses a Codex remove (its skills dir IS the shared folder) while Cursor is installed", async () => {
    writeSkill(join(root, ".agents/skills/foo"));
    lock(["cursor", "codex"]);

    const { body } = await post({ skill: "foo", agentIds: ["codex"], scope: "project" });

    expect(body.removed).toEqual([]);
    expect(body.skipped[0].sharedWith).toEqual(["cursor"]);
    expect(existsSync(join(root, ".agents/skills/foo/SKILL.md"))).toBe(true);
  });

  it("deletes the canonical copy when every agent that uses it is in the request", async () => {
    writeSkill(join(root, ".agents/skills/foo"));
    link("../../.agents/skills/foo", join(root, ".windsurf/skills/foo"));
    lock(["cursor", "codex", "windsurf"]);

    const { body } = await post({ skill: "foo", agentIds: ["cursor", "codex", "windsurf"], scope: "project" });

    expect(body.skipped).toEqual([]);
    expect(lexists(join(root, ".agents/skills/foo"))).toBe(false);
    expect(lexists(join(root, ".windsurf/skills/foo"))).toBe(false);
    expect(readLockfile(root)?.skills.foo).toBeUndefined();
  });

  it("removes only a non-shared agent's own link and keeps the lock entry while others still have it", async () => {
    const canonical = join(root, ".agents/skills/foo");
    writeSkill(canonical);
    link("../../.agents/skills/foo", join(root, ".windsurf/skills/foo"));
    lock(["codex", "windsurf"]);

    const { body } = await post({ skill: "foo", agentIds: ["windsurf"], scope: "project" });

    expect(body.removed).toEqual([{ agentId: "windsurf", path: join(root, ".windsurf/skills/foo") }]);
    expect(lexists(join(root, ".windsurf/skills/foo"))).toBe(false);
    expect(existsSync(join(canonical, "SKILL.md"))).toBe(true);
    expect(readLockfile(root)?.skills.foo).toBeDefined();
  });
});

describe("0894 — remove-skill for a shared reader with an old per-agent link", () => {
  it("removes both the stale .cursor/skills link and the canonical copy", async () => {
    writeSkill(join(root, ".agents/skills/foo"));
    link("../../.agents/skills/foo", join(root, ".cursor/skills/foo"));
    lock(["cursor"]);

    const { body } = await post({ skill: "foo", agentIds: ["cursor"], scope: "project" });

    expect(body.skipped).toEqual([]);
    expect(lexists(join(root, ".cursor/skills/foo"))).toBe(false);
    expect(lexists(join(root, ".agents/skills/foo"))).toBe(false);
    expect(body.removed.map((r: { path: string }) => r.path)).toEqual([
      join(root, ".cursor/skills/foo"),
      join(root, ".agents/skills/foo"),
    ]);
  });
});

describe("0894 — remove-skill with all: true", () => {
  it("removes the canonical copy, every agent's link or copy, and the lock entry", async () => {
    writeSkill(join(root, ".agents/skills/foo"));
    link("../../.agents/skills/foo", join(root, ".windsurf/skills/foo"));
    writeSkill(join(root, ".claude/skills/foo")); // Claude's own full copy
    lock(["claude-code", "cursor", "codex", "windsurf"]);

    const { body, status } = await post({ skill: "foo", scope: "project", all: true });

    expect(status).toBe(200);
    expect(body.errors).toEqual([]);
    for (const p of [".agents/skills/foo", ".windsurf/skills/foo", ".claude/skills/foo"]) {
      expect(lexists(join(root, p))).toBe(false);
    }
    const paths = body.removed.map((r: { path: string }) => r.path);
    expect(paths).toEqual(expect.arrayContaining([
      join(root, ".agents/skills/foo"),
      join(root, ".windsurf/skills/foo"),
      join(root, ".claude/skills/foo"),
    ]));
    expect(readLockfile(root)?.skills.foo).toBeUndefined();
  });

  it("resolves a shared refusal: the Remove-from-all request deletes what the per-agent one kept", async () => {
    writeSkill(join(root, ".agents/skills/foo"));
    lock(["cursor", "codex"]);

    const refused = await post({ skill: "foo", agentIds: ["cursor"], scope: "project" });
    expect(refused.body.skipped[0].sharedWith).toEqual(["codex"]);

    const { body } = await post({ skill: "foo", agentIds: ["cursor", "codex"], scope: "project", all: true });
    expect(body.skipped).toEqual([]);
    expect(lexists(join(root, ".agents/skills/foo"))).toBe(false);
  });

  it("still rejects unknown agent ids when they are given", async () => {
    const { status } = await post({ skill: "foo", agentIds: ["nope"], scope: "project", all: true });
    expect(status).toBe(400);
  });
});

describe("0894 — remove-skill prunes the scope lockfile agents list", () => {
  it("drops an agent left with no skill in the scope, keeps agents that still have one", async () => {
    writeSkill(join(root, ".agents/skills/foo"));
    link("../../.agents/skills/foo", join(root, ".windsurf/skills/foo"));
    lock(["codex", "windsurf"]);

    await post({ skill: "foo", agentIds: ["windsurf"], scope: "project" });

    expect(readLockfile(root)?.agents).toEqual(["codex"]);
  });

  it("empties the agents list once the last skill is removed for everyone", async () => {
    writeSkill(join(root, ".agents/skills/foo"));
    link("../../.agents/skills/foo", join(root, ".claude/skills/foo"));
    lock(["claude-code", "cursor", "codex"]);

    await post({ skill: "foo", scope: "project", all: true });

    expect(readLockfile(root)?.agents).toEqual([]);
  });

  it("keeps an agent that still has another skill", async () => {
    writeSkill(join(root, ".agents/skills/foo"));
    link("../../.agents/skills/foo", join(root, ".windsurf/skills/foo"));
    writeSkill(join(root, ".windsurf/skills/bar"));
    lock(["codex", "windsurf"]);

    await post({ skill: "foo", agentIds: ["windsurf"], scope: "project" });

    expect(readLockfile(root)?.agents).toEqual(["codex", "windsurf"]);
  });
});


describe("0850 AC-US4-02/03 — remove-skill input guards", () => {
  it.each(["chatgpt", "replit"])("keeps %s cloud/remote files untouched", async (agentId) => {
    const dir = join(root, getAgent(agentId)!.localSkillsDir, "foo");
    writeSkill(dir);
    const { body } = await post({ skill: "foo", agentIds: [agentId], scope: "project" });
    expect(body.removed).toEqual([]);
    expect(body.skipped).toEqual([{ agentId, reason: "cloud agent — nothing to remove on disk" }]);
    expect(existsSync(join(dir, "SKILL.md"))).toBe(true);
  });

  for (const skill of ["foo/..", "..", ".", "o/r/..", "o/./foo", "o//foo", "../foo"]) {
    it(`rejects the path segment in ${JSON.stringify(skill)} and deletes nothing`, async () => {
      writeSkill(join(root, ".claude/skills/foo"));
      const { status } = await post({ skill, agentIds: ["claude-code"], scope: "project" });
      expect(status).toBe(400);
      expect(lexists(join(root, ".claude/skills/foo"))).toBe(true);
    });
  }

  it("rejects a non-localhost caller with 403", async () => {
    writeSkill(join(root, ".claude/skills/foo"));
    mocks.readBody.mockResolvedValueOnce({ skill: "foo", agentIds: ["claude-code"], scope: "project" });
    const req: any = { socket: { remoteAddress: "10.0.0.5" }, headers: {} };
    await handler()(req, {} as any);
    expect(mocks.sendJson.mock.calls.at(-1)![2]).toBe(403);
    expect(lexists(join(root, ".claude/skills/foo"))).toBe(true);
  });

  it("rejects an invalid agent id with 400", async () => {
    const { status } = await post({ skill: "foo", agentIds: ["Bad Agent"], scope: "project" });
    expect(status).toBe(400);
  });
});
