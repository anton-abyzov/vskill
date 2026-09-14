import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readLockfile: vi.fn(), purge: vi.fn(), uninstall: vi.fn(), staleUninstall: vi.fn(),
  exists: vi.fn(), read: vi.fn(), remove: vi.fn(), readdir: vi.fn(), projectRoot: vi.fn(),
}));
vi.mock("node:os", () => ({ homedir: () => "/home/audit" }));
vi.mock("node:fs", async () => ({
  ...await vi.importActual("node:fs"), existsSync: mocks.exists,
  readFileSync: mocks.read, rmSync: mocks.remove, readdirSync: mocks.readdir,
}));
vi.mock("../../lockfile/index.js", () => ({ readLockfile: mocks.readLockfile }));
vi.mock("../../lockfile/project-root.js", () => ({ getProjectRoot: mocks.projectRoot }));
vi.mock("../../settings/index.js", () => ({ purgeStalePlugins: mocks.purge, listEnabledPlugins: () => [] }));
vi.mock("../../utils/claude-plugin.js", () => ({
  uninstallStalePlugins: mocks.staleUninstall, claudePluginUninstall: mocks.uninstall,
}));
vi.mock("../../marketplace/manifest-conflict.js", () => ({ healAllMarketplaceManifests: () => [] }));
import { cleanupCommand } from "../cleanup.js";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.readLockfile.mockReturnValue({ skills: {} });
  mocks.purge.mockReturnValue([]);
  mocks.exists.mockReturnValue(false);
  mocks.readdir.mockReturnValue([]);
  mocks.staleUninstall.mockReturnValue([]);
  mocks.projectRoot.mockReturnValue(process.cwd());
});

describe("0877 cleanup ownership and scope", () => {
  it("uses the resolved project root for nested invocations", async () => {
    mocks.projectRoot.mockReturnValue("/workspace/project");
    mocks.purge.mockImplementation((opts: { scope: string }) => opts.scope === "project" ? ["missing@team"] : []);

    await cleanupCommand({});

    expect(mocks.purge).toHaveBeenCalledWith({ scope: "project", projectDir: "/workspace/project" }, {});
    expect(mocks.uninstall).toHaveBeenCalledWith("missing@team", "project", { cwd: "/workspace/project" });
  });
  it("uses global ownership for user scope, project ownership for project scope", async () => {
    const global = { global: { marketplace: "personal" } };
    const project = { project: { marketplace: "team" } };
    mocks.readLockfile.mockImplementation((dir?: string) => ({ skills: dir === "/home/audit/.agents" ? global : dir === "/home/audit" ? {} : project }));

    await cleanupCommand({ dryRun: true });

    expect(mocks.purge).toHaveBeenCalledWith({ scope: "user" }, global);
    expect(mocks.purge).toHaveBeenCalledWith({ scope: "project", projectDir: process.cwd() }, project);
  });

  it("preserves installed external plugins and global caches absent from project lock", async () => {
    mocks.purge.mockReturnValue(["sw@specweave"]);
    mocks.exists.mockImplementation((p: string) => p.startsWith("/home/audit/.claude/plugins/cache"));
    mocks.readdir.mockImplementation((p: string) => p.endsWith("cache") ? ["specweave"] : ["sw"]);

    await cleanupCommand({});

    expect(mocks.uninstall).not.toHaveBeenCalled();
    expect(mocks.staleUninstall).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("preserves registry entries owned by another workspace even without cached files", async () => {
    mocks.purge.mockReturnValue(["sw@specweave"]);
    mocks.exists.mockImplementation((p: string) => p.endsWith("installed_plugins.json"));
    mocks.read.mockReturnValue(JSON.stringify({ plugins: { "sw@specweave": [{ scope: "project", projectPath: "/other" }] } }));

    await cleanupCommand({});

    expect(mocks.uninstall).not.toHaveBeenCalled();
    expect(mocks.staleUninstall).not.toHaveBeenCalled();
  });

  it("does not mutate anything when plugin registry is unreadable", async () => {
    mocks.purge.mockReturnValue(["sw@specweave"]);
    mocks.exists.mockImplementation((p: string) => p.endsWith("installed_plugins.json"));
    mocks.read.mockImplementation(() => { throw Error("permission denied"); });

    await cleanupCommand({});

    expect(mocks.uninstall).not.toHaveBeenCalled();
    expect(mocks.staleUninstall).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("only uninstalls missing registrations from the scope that owns the stale setting", async () => {
    mocks.purge.mockImplementation((opts: { scope: string }) => opts.scope === "project" ? ["missing@team"] : []);

    await cleanupCommand({});

    expect(mocks.uninstall).toHaveBeenCalledTimes(1);
    expect(mocks.uninstall).toHaveBeenCalledWith("missing@team", "project", { cwd: process.cwd() });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("reports a failed scoped uninstall without deleting caches as a fallback", async () => {
    mocks.purge.mockImplementation((opts: { scope: string }) => opts.scope === "user" ? ["missing@team"] : []);
    mocks.uninstall.mockImplementation(() => { throw Error("not registered"); });

    await cleanupCommand({});

    expect(mocks.remove).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("registration retained"));
  });
});
