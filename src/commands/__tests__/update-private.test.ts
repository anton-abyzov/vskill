import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillLockEntry } from "../../lockfile/types.js";
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), update: vi.fn(), fetch: vi.fn(), publicLookup: vi.fn() }));
vi.mock("../../lockfile/index.js", () => ({ readLockfile: mocks.read, writeLockfile: mocks.write, getProjectRoot: () => "/synthetic/project" }));
vi.mock("../install-private.js", () => ({ updateHostedPrivateSkill: mocks.update }));
vi.mock("../../api/client.js", () => ({ getSkill: mocks.publicLookup }));
vi.mock("../../updater/source-fetcher.js", () => ({ fetchFromSource: mocks.fetch, computeSha: vi.fn() }));
vi.mock("../../agents/agents-registry.js", () => ({ detectInstalledAgents: async () => [{ id: "codex", localSkillsDir: ".agents/skills" }] }));
vi.mock("../../lib/private-source.js", () => ({ isPrivateSource: async () => true, unconfirmedSkipNote: () => null }));
import { updateCommand } from "../update.js";
let entry: SkillLockEntry;
beforeEach(() => {
  vi.clearAllMocks(); process.exitCode = 0;
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  entry = { version: "1.0.0", source: "hosted-private:tenant1/private:helpful-123", sourceType: "hosted-private", sourcePrivate: true, sha: "a", installedAt: "now", tier: "SCANNED", scope: "project", hostedPrivate: { tenantId: "tenant1", tenantSlug: "team", skillId: "skill1", skillSlug: "private:helpful-123", treeHash: "tree", agents: ["codex"], copy: false } };
  mocks.read.mockImplementation(() => ({ skills: { helpful: entry }, agents: ["codex"], version: 1 }));
  mocks.update.mockImplementation(async (_name, old) => ({ ...old, version: "1.1.0" }));
});
afterEach(() => { process.exitCode = 0; vi.restoreAllMocks(); });
describe("private update dispatch", () => {
  it("routes by provenance before source parsing and persists the authenticated update", async () => {
    await updateCommand("helpful", {});
    expect(mocks.update).toHaveBeenCalledWith("helpful", entry, expect.any(Array), "/synthetic/project");
    expect(mocks.write.mock.calls[0][0].skills.helpful).toMatchObject({ version: "1.1.0", sourcePrivate: true });
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.publicLookup).not.toHaveBeenCalled();
  });
  it("skips an exact pin without network; force explicitly overrides the skip", async () => {
    entry.pinnedVersion = "1.0.0";
    await updateCommand("helpful", {});
    expect(mocks.update).not.toHaveBeenCalled();
    await updateCommand("helpful", { force: true });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.publicLookup).not.toHaveBeenCalled();
  });
  it("keeps private errors private and signals failure without fallback", async () => {
    mocks.update.mockRejectedValue(new Error("not_found"));
    await updateCommand("helpful", {});
    expect(process.exitCode).toBe(1);
    expect(mocks.write.mock.calls[0][0].skills.helpful.version).toBe("1.0.0");
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.publicLookup).not.toHaveBeenCalled();
  });
  it("reads and writes the same global lock location", async () => {
    entry.scope = "user";
    await updateCommand("helpful", { global: true });
    const dir = mocks.read.mock.calls[0][0];
    expect(dir).toMatch(/[/\\]\.agents$/);
    expect(mocks.write.mock.calls[0][1]).toBe(dir);
  });
  it("never falls back if a legacy hosted entry is missing sourceType", async () => {
    delete entry.sourceType;
    await updateCommand("helpful", {});
    expect(mocks.update).toHaveBeenCalled(); expect(mocks.publicLookup).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
