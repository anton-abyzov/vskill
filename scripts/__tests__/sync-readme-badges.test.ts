/**
 * 0771 Track F (T-006) — vskill README badge sync test.
 *
 * Verifies that running sync-readme-badges.cjs against a fixture README
 * with stale shields.io badge URLs rewrites them in-place to current
 * filesystem counts without disturbing surrounding markdown.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const SCRIPT = path.resolve(__dirname, "..", "sync-readme-badges.cjs");

let fixtureDir: string;
let fixtureReadme: string;

beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "0771-readme-"));

  // Build a fixture vskill source tree with known counts.
  // 2 plugins, 3 SKILL.md, 5 patterns, 7 agents.
  fs.mkdirSync(path.join(fixtureDir, "plugins", "alpha", "skills", "one"), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, "plugins", "alpha", "skills", "two"), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, "plugins", "beta", "skills", "three"), { recursive: true });
  fs.writeFileSync(path.join(fixtureDir, "plugins", "alpha", "skills", "one", "SKILL.md"), "# one\n");
  fs.writeFileSync(path.join(fixtureDir, "plugins", "alpha", "skills", "two", "SKILL.md"), "# two\n");
  fs.writeFileSync(path.join(fixtureDir, "plugins", "beta", "skills", "three", "SKILL.md"), "# three\n");

  fs.mkdirSync(path.join(fixtureDir, "src", "scanner"), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDir, "src", "scanner", "patterns.ts"),
    [
      "export const PATTERNS = [",
      "  {",
      '    id: "P-001",',
      "  },",
      "  {",
      '    id: "P-002",',
      "  },",
      "  {",
      '    id: "P-003",',
      "  },",
      "  {",
      '    id: "P-004",',
      "  },",
      "  {",
      '    id: "P-005",',
      "  },",
      "];",
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(fixtureDir, "agents.json"),
    JSON.stringify({
      version: 1,
      agentPrefixes: [".a", ".b", ".c", ".d", ".e", ".f", ".g"],
    }),
  );

  // Fixture README with stale shields.io URLs.
  fixtureReadme = path.join(fixtureDir, "README.md");
  fs.writeFileSync(
    fixtureReadme,
    [
      "<h1>vskill</h1>",
      "",
      "<p>",
      '  <img src="https://img.shields.io/badge/agents-40_platforms-0969DA" alt="40 agents" />',
      '  <img src="https://img.shields.io/badge/plugins-5-8B5CF6" alt="5 plugins" />',
      '  <img src="https://img.shields.io/badge/skills-10-10B981" alt="10 skills" />',
      "</p>",
      "",
      "Surrounding prose: should not be touched. 40 here is fine.",
      "",
    ].join("\n"),
  );
});

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe("0771 Track F — sync-readme-badges.cjs (T-006)", () => {
  it("exposes computeCounts and rewriteReadme helpers", () => {
    const mod = require(SCRIPT);
    expect(typeof mod.computeCounts).toBe("function");
    expect(typeof mod.rewriteReadme).toBe("function");
  });

  it("rewrites stale shields.io URLs to match filesystem counts (AC-US6-03)", () => {
    const mod = require(SCRIPT);
    const counts = mod.computeCounts(fixtureDir);
    expect(counts).toEqual({
      agentPlatforms: 7,
      plugins: 2,
      skills: 3,
      scanPatterns: 5,
    });

    const before = fs.readFileSync(fixtureReadme, "utf8");
    const changed = mod.rewriteReadme(fixtureReadme, counts);
    expect(changed).toBe(true);
    const after = fs.readFileSync(fixtureReadme, "utf8");

    // Old URLs gone.
    expect(after).not.toContain("agents-40_platforms");
    expect(after).not.toContain("plugins-5-8B5CF6");
    expect(after).not.toContain("skills-10-10B981");

    // New URLs present, with the same color tail kept intact.
    expect(after).toContain("agents-7_platforms-0969DA");
    expect(after).toContain("plugins-2-8B5CF6");
    expect(after).toContain("skills-3-10B981");

    // Surrounding prose untouched.
    expect(after).toContain("Surrounding prose: should not be touched. 40 here is fine.");

    // Idempotent: a second run should produce no diff.
    const changedAgain = mod.rewriteReadme(fixtureReadme, counts);
    expect(changedAgain).toBe(false);
    expect(fs.readFileSync(fixtureReadme, "utf8")).toBe(after);

    // Sanity: ensure the function actually changed something the first time.
    expect(after).not.toBe(before);
  });

  it("CLI invocation writes counts to README and exits 0 (smoke)", () => {
    // Reset README to stale state for this run.
    fs.writeFileSync(
      fixtureReadme,
      [
        "<h1>vskill</h1>",
        "",
        '  <img src="https://img.shields.io/badge/agents-40_platforms-0969DA" alt="40 agents" />',
        '  <img src="https://img.shields.io/badge/plugins-5-8B5CF6" alt="5 plugins" />',
        '  <img src="https://img.shields.io/badge/skills-10-10B981" alt="10 skills" />',
        "",
      ].join("\n"),
    );
    // Invoke as CLI with the fixture root as argv.
    execFileSync("node", [SCRIPT, fixtureDir], { stdio: "ignore" });
    const after = fs.readFileSync(fixtureReadme, "utf8");
    expect(after).toContain("agents-7_platforms");
    expect(after).toContain("plugins-2-");
    expect(after).toContain("skills-3-");
  });
});
