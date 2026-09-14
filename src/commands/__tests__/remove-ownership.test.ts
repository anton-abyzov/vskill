import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ uninstall: vi.fn(), purge: vi.fn() }));
vi.mock("node:os", async () => ({
  ...await vi.importActual("node:os"), homedir: () => "/nonexistent-vskill-ownership-test-home",
}));
vi.mock("../../agents/agents-registry.js", () => ({ detectInstalledAgents: async () => [] }));
vi.mock("../../settings/index.js", () => ({
  isPluginEnabled: () => true,
  purgeStalePlugins: mocks.purge,
}));
vi.mock("../../utils/claude-plugin.js", () => ({ claudePluginUninstall: mocks.uninstall }));
import { removeCommand } from "../remove.js";
import { cleanupCommand } from "../cleanup.js";

let root: string;
let child: string;
const name = "nested-owned-skill";
function install(dir: string, marketplace = "team") {
  mkdirSync(join(dir, ".agents", "skills", name), { recursive: true });
  writeFileSync(join(dir, ".agents", "skills", name, "SKILL.md"), `# ${marketplace}`);
  writeFileSync(join(dir, "vskill.lock"), JSON.stringify({
    version: 1, agents: [], skills: { [name]: {
      version: "1.0.0", sha: "fixture", tier: "VERIFIED", installedAt: new Date().toISOString(),
      scope: "project", marketplace,
    } },
  }));
}
function locked(dir: string) {
  return Boolean(JSON.parse(readFileSync(join(dir, "vskill.lock"), "utf8")).skills[name]);
}
beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), "vskill-ownership-"));
  child = join(root, "packages", "child");
  mkdirSync(join(root, ".specweave"));
  writeFileSync(join(root, ".specweave", "config.json"), "{}");
  mkdirSync(child, { recursive: true });
  vi.spyOn(process, "cwd").mockReturnValue(child);
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.purge.mockReturnValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("0877 nested installation ownership", () => {
  it("removes a child's own install without deleting the same-named parent install", async () => {
    install(root, "parent-market");
    install(child, "child-market");
    await removeCommand(name, { local: true, force: true });
    expect(existsSync(join(root, ".agents", "skills", name))).toBe(true);
    expect(locked(root)).toBe(true);
    expect(existsSync(join(child, ".agents", "skills", name))).toBe(false);
    expect(locked(child)).toBe(false);
    expect(mocks.uninstall).toHaveBeenCalledExactlyOnceWith(`${name}@child-market`, "project", { cwd: child });
  });

  it("uses the nearest owning install from a directory below it", async () => {
    install(root, "parent-market");
    install(child, "child-market");
    const sourceDir = join(child, "src");
    mkdirSync(sourceDir);
    vi.mocked(process.cwd).mockReturnValue(sourceDir);
    await removeCommand(name, { local: true, force: true });
    expect(locked(root)).toBe(true);
    expect(locked(child)).toBe(false);
    expect(mocks.uninstall).toHaveBeenCalledExactlyOnceWith(`${name}@child-market`, "project", { cwd: child });
  });

  it("still removes the umbrella install when a nested source directory owns no lock", async () => {
    install(root);
    await removeCommand(name, { local: true, force: true });
    expect(locked(root)).toBe(false);
    expect(existsSync(join(root, ".agents", "skills", name))).toBe(false);
    expect(mocks.uninstall).toHaveBeenCalledExactlyOnceWith(`${name}@team`, "project", { cwd: root });
  });

  it("checks cleanup ownership and settings in the same nested project", async () => {
    install(root, "parent-market");
    install(child, "child-market");
    await cleanupCommand({ dryRun: true });
    expect(mocks.purge).toHaveBeenCalledWith({ scope: "project", projectDir: child }, expect.objectContaining({
      [name]: expect.objectContaining({ marketplace: "child-market" }),
    }));
    expect(mocks.uninstall).not.toHaveBeenCalled();
  });
});
