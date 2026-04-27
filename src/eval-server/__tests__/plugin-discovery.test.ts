// 0795 — `discoverInstalledPlugins` (replaces dead `claude plugin list` shell-out).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

import { discoverInstalledPlugins } from "../plugin-discovery.js";

let cacheRoot: string;
let projectDir: string;
// We mutate the user-scope settings.json under HOME during these tests; back up
// the existing file (if any) so we don't trash the developer's real config.
let userSettingsPath: string;
let backupSettings: string | null;

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), "vskill-discovery-cache-"));
  projectDir = mkdtempSync(join(tmpdir(), "vskill-discovery-proj-"));
  userSettingsPath = join(homedir(), ".claude", "settings.json");
  if (existsSync(userSettingsPath)) {
    backupSettings = require("node:fs").readFileSync(userSettingsPath, "utf-8");
  } else {
    backupSettings = null;
  }
});

afterEach(() => {
  rmSync(cacheRoot, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  if (backupSettings !== null) {
    writeFileSync(userSettingsPath, backupSettings, "utf-8");
  } else if (existsSync(userSettingsPath)) {
    require("node:fs").unlinkSync(userSettingsPath);
  }
});

function seedPlugin(
  cacheDir: string,
  marketplace: string,
  name: string,
  version: string,
  manifest: Record<string, unknown> = { name },
): void {
  const dir = join(cacheDir, marketplace, name, version, ".claude-plugin");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest));
}

function setUserEnabled(ids: Record<string, boolean>): void {
  const dir = join(homedir(), ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    userSettingsPath,
    JSON.stringify({ enabledPlugins: ids }),
    "utf-8",
  );
}

function setProjectEnabled(ids: Record<string, boolean>): void {
  const dir = join(projectDir, ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ enabledPlugins: ids }),
    "utf-8",
  );
}

describe("discoverInstalledPlugins", () => {
  it("returns [] when cacheRoot does not exist (AC-US1-05)", () => {
    rmSync(cacheRoot, { recursive: true, force: true });
    const plugins = discoverInstalledPlugins({ cacheRoot, projectDir });
    expect(plugins).toEqual([]);
  });

  it("emits one row enabled:true scope:user for a plugin enabled in user settings (AC-US1-02)", () => {
    seedPlugin(cacheRoot, "claude-plugins-official", "skill-creator", "1.0.0");
    setUserEnabled({ "skill-creator@claude-plugins-official": true });

    const plugins = discoverInstalledPlugins({ cacheRoot, projectDir });
    expect(plugins).toEqual([
      {
        name: "skill-creator",
        marketplace: "claude-plugins-official",
        version: "1.0.0",
        scope: "user",
        enabled: true,
      },
    ]);
  });

  it("emits enabled:true scope:project when only project settings has it (AC-US1-03)", () => {
    seedPlugin(cacheRoot, "specweave", "obsidian-brain", "1.0.0");
    setProjectEnabled({ "obsidian-brain@specweave": true });

    const plugins = discoverInstalledPlugins({ cacheRoot, projectDir });
    expect(plugins).toEqual([
      {
        name: "obsidian-brain",
        marketplace: "specweave",
        version: "1.0.0",
        scope: "project",
        enabled: true,
      },
    ]);
  });

  it("emits enabled:false scope:user for a plugin on disk with no enabledPlugins entry (AC-US1-04)", () => {
    seedPlugin(cacheRoot, "mp", "untouched", "0.1.0");
    // No settings.json on either scope.
    const plugins = discoverInstalledPlugins({ cacheRoot, projectDir });
    expect(plugins).toEqual([
      {
        name: "untouched",
        marketplace: "mp",
        version: "0.1.0",
        scope: "user",
        enabled: false,
      },
    ]);
  });

  it("skips a cache dir that has no .claude-plugin/plugin.json (AC-US1-06)", () => {
    // Create the version dir but no manifest file
    mkdirSync(join(cacheRoot, "mp", "broken", "0.1.0"), { recursive: true });

    const plugins = discoverInstalledPlugins({ cacheRoot, projectDir });
    expect(plugins).toEqual([]);
  });

  it("emits two rows when a plugin is enabled in BOTH user and project settings", () => {
    seedPlugin(cacheRoot, "mp", "shared", "1.0.0");
    setUserEnabled({ "shared@mp": true });
    setProjectEnabled({ "shared@mp": true });

    const plugins = discoverInstalledPlugins({ cacheRoot, projectDir });
    expect(plugins).toHaveLength(2);
    expect(plugins.find((p) => p.scope === "user")?.enabled).toBe(true);
    expect(plugins.find((p) => p.scope === "project")?.enabled).toBe(true);
  });

  it("uses the manifest's name when it differs from the cache directory name", () => {
    // Some plugins rename in plugin.json without renaming the cache dir.
    seedPlugin(cacheRoot, "mp", "old-name", "1.0.0", { name: "renamed" });
    setUserEnabled({ "renamed@mp": true });

    const plugins = discoverInstalledPlugins({ cacheRoot, projectDir });
    expect(plugins[0]?.name).toBe("renamed");
  });

  it("picks the latest version by mtime when multiple version dirs exist", () => {
    // Seed two version dirs; touch the second to push its mtime forward.
    seedPlugin(cacheRoot, "mp", "vplug", "1.0.0");
    // Wait one ms so mtime differs reliably (filesystem timestamp granularity).
    const fs = require("node:fs");
    const oldDir = join(cacheRoot, "mp", "vplug", "1.0.0");
    fs.utimesSync(oldDir, new Date("2020-01-01"), new Date("2020-01-01"));
    seedPlugin(cacheRoot, "mp", "vplug", "2.0.0");
    fs.utimesSync(
      join(cacheRoot, "mp", "vplug", "2.0.0"),
      new Date("2026-01-01"),
      new Date("2026-01-01"),
    );

    const plugins = discoverInstalledPlugins({ cacheRoot, projectDir });
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.version).toBe("2.0.0");
  });

  it("ignores cache entries whose names fail kebab/safe-name validation (AC-US3-01)", () => {
    // Names that are explicitly disallowed by the safe-name pattern.
    mkdirSync(join(cacheRoot, "..hidden"), { recursive: true });
    seedPlugin(cacheRoot, "ok", "good", "1.0.0");

    const plugins = discoverInstalledPlugins({ cacheRoot, projectDir });
    // Only the "good" plugin under the safe "ok" marketplace should appear.
    expect(plugins.map((p) => p.name)).toEqual(["good"]);
  });

  it("does not invoke any subprocess (verifies we never shell out to claude) (AC-US1-07)", () => {
    // Subtle: we cannot directly assert "no spawn happened" without process
    // hooks, but we CAN assert the function works with PATH unset to a
    // non-existent dir — if it was secretly calling `claude`, the call would
    // either fail or hang.
    seedPlugin(cacheRoot, "mp", "shellfree", "1.0.0");
    const originalPath = process.env.PATH;
    process.env.PATH = "/dev/null-vskill-test";
    try {
      const plugins = discoverInstalledPlugins({ cacheRoot, projectDir });
      expect(plugins).toHaveLength(1);
      expect(plugins[0]?.name).toBe("shellfree");
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
