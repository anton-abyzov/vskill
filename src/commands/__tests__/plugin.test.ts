// 0793 — `vskill plugin new` CLI tests.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { pluginNewCommand } from "../plugin.js";

let cwd: string;
let exitSpy: ReturnType<typeof vi.spyOn>;
let originalPath: string | undefined;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "vskill-plugin-cli-"));
  // Force `claude` to be missing so validation soft-skips deterministically.
  // (Tests focus on the scaffolder; validator logic has its own spec.)
  originalPath = process.env.PATH;
  process.env.PATH = "/dev/null-vskill-test";
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? 0}`);
    }) as never);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  process.env.PATH = originalPath;
  exitSpy.mockRestore();
});

describe("vskill plugin new", () => {
  it("scaffolds <name>/.claude-plugin/plugin.json with the kebab name and given description", async () => {
    await pluginNewCommand("my-plug", { description: "Hello world", cwd });
    const manifest = join(cwd, "my-plug", ".claude-plugin", "plugin.json");
    expect(existsSync(manifest)).toBe(true);
    // F-002: declare every field as optional so the type matches the scaffold's
    // actual shape (no author, no version) and the `.toBeUndefined()` assertions
    // below aren't fighting their own type declaration.
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
      name?: string;
      description?: string;
      author?: { name: string };
      version?: string;
    };
    expect(parsed.name).toBe("my-plug");
    expect(parsed.description).toBe("Hello world");
    // 0703 follow-up: no hardcoded version (Claude Code uses git SHA fallback)
    expect(parsed.version).toBeUndefined();
    // 0793 T-001 fix: no author stub (validator rejects empty author.name)
    expect(parsed.author).toBeUndefined();
  });

  it("with --with-skill, also scaffolds <name>/skills/<skill>/SKILL.md", async () => {
    await pluginNewCommand("plug-with-skill", {
      withSkill: "greet",
      cwd,
      description: "Multi-skill bundle",
    });
    const skillMd = join(cwd, "plug-with-skill", "skills", "greet", "SKILL.md");
    expect(existsSync(skillMd)).toBe(true);
    const text = readFileSync(skillMd, "utf8");
    expect(text).toContain("description: Multi-skill bundle");
    expect(text).toContain("# greet");
  });

  it("uses a default description when --description is omitted", async () => {
    await pluginNewCommand("default-desc", { cwd });
    const manifest = join(cwd, "default-desc", ".claude-plugin", "plugin.json");
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { description: string };
    expect(parsed.description).toBe("Plugin: default-desc");
  });

  it("rejects when the plugin manifest already exists", async () => {
    mkdirSync(join(cwd, "exists", ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(cwd, "exists", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "existing" }),
    );

    await expect(pluginNewCommand("exists", { cwd })).rejects.toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    // Manifest is unchanged (we did not overwrite).
    const parsed = JSON.parse(
      readFileSync(join(cwd, "exists", ".claude-plugin", "plugin.json"), "utf8"),
    ) as { name: string };
    expect(parsed.name).toBe("existing");
  });

  it("rejects camelCase plugin names", async () => {
    await expect(pluginNewCommand("MyPlug", { cwd })).rejects.toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(existsSync(join(cwd, "MyPlug"))).toBe(false);
  });

  it("rejects names with spaces or underscores", async () => {
    await expect(pluginNewCommand("my plug", { cwd })).rejects.toThrow(/__exit__:1/);
    await expect(pluginNewCommand("my_plug", { cwd })).rejects.toThrow(/__exit__:1/);
  });

  it("rejects invalid --with-skill names", async () => {
    await expect(
      pluginNewCommand("ok-name", { withSkill: "BAD", cwd }),
    ).rejects.toThrow(/__exit__:1/);
    expect(existsSync(join(cwd, "ok-name", ".claude-plugin", "plugin.json"))).toBe(false);
  });

  it("rolls back the entire scaffold (manifest + skill + pluginDir) when validator rejects (F-002)", async () => {
    // Force the validator to fail by injecting `false` (always exit 1) as the
    // claude binary. The validator wrapper looks for `claude` on PATH; we
    // override PATH in beforeEach to /dev/null-… (no claude). To force a
    // proper "validator ran and rejected" path, point validateClaudePlugin at
    // a real failing binary — `/usr/bin/false` is universally present and
    // exits 1. We re-export the binary path via a custom PATH that contains
    // ONLY a directory holding a `claude` symlink to /usr/bin/false.
    const fs = require("node:fs");
    const path = require("node:path");
    const fakeBinDir = mkdtempSync(join(tmpdir(), "vskill-fakebin-"));
    fs.symlinkSync("/usr/bin/false", path.join(fakeBinDir, "claude"));
    process.env.PATH = fakeBinDir;

    try {
      await expect(
        pluginNewCommand("rolled-back", {
          withSkill: "first",
          cwd,
          description: "should be rolled back",
        }),
      ).rejects.toThrow(/__exit__:1/);

      // Manifest must be unlinked.
      expect(existsSync(join(cwd, "rolled-back", ".claude-plugin", "plugin.json"))).toBe(false);
      // The new skill folder must also be gone — no phantom skill left behind.
      expect(existsSync(join(cwd, "rolled-back", "skills", "first", "SKILL.md"))).toBe(false);
      // The pluginDir itself should be gone if we created it (clean rollback).
      expect(existsSync(join(cwd, "rolled-back"))).toBe(false);
    } finally {
      rmSync(fakeBinDir, { recursive: true, force: true });
    }
  });
});
