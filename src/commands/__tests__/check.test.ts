// 0815: vskill check command — exit codes, JSON shape, no-secret-leak.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCheckReport,
  findSkillDir,
  pythonVersionSatisfies,
  checkMcpConfigured,
} from "../check.js";

let tmpRoot: string;
let skillDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-check-"));
  skillDir = join(tmpRoot, "plugins", "personal", "skills", "demo-skill");
  mkdirSync(skillDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.STRIPE_API_KEY;
  vi.restoreAllMocks();
});

function writeSkillMd(frontmatter: string): void {
  writeFileSync(join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# /demo-skill\n\nbody.`);
}

describe("findSkillDir", () => {
  it("locates a skill under plugins/<plugin>/skills/<name>", () => {
    writeSkillMd("name: demo-skill");
    const found = findSkillDir("demo-skill", tmpRoot);
    expect(found).toBe(skillDir);
  });

  it("returns null for unknown skills", () => {
    expect(findSkillDir("nope", tmpRoot)).toBeNull();
  });
});

describe("pythonVersionSatisfies", () => {
  it("returns true when installed major.minor >= declared", () => {
    expect(pythonVersionSatisfies("Python 3.11.4", ">=3.10")).toBe(true);
    expect(pythonVersionSatisfies("Python 3.10.0", ">=3.10")).toBe(true);
    expect(pythonVersionSatisfies("Python 4.0.0", ">=3.10")).toBe(true);
  });

  it("returns false when installed is older", () => {
    expect(pythonVersionSatisfies("Python 3.9.7", ">=3.10")).toBe(false);
  });

  it("handles bare 3.10 (no comparator)", () => {
    expect(pythonVersionSatisfies("Python 3.11.0", "3.10")).toBe(true);
  });

  it("returns false on unparseable inputs", () => {
    expect(pythonVersionSatisfies("not python", ">=3.10")).toBe(false);
    expect(pythonVersionSatisfies("Python 3.10", "garbage")).toBe(false);
  });
});

describe("checkMcpConfigured", () => {
  it("returns 'configured' when the project .claude/mcp.json lists the server", () => {
    const claudeDir = join(tmpRoot, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "mcp.json"),
      JSON.stringify({ mcpServers: { "stripe-test": { type: "http", url: "x" } } }),
    );
    expect(checkMcpConfigured("stripe-test", tmpRoot)).toBe("configured");
  });

  it("returns 'missing' when no config file lists the server", () => {
    expect(checkMcpConfigured("nonexistent", tmpRoot)).toBe("missing");
  });

  it("tolerates malformed JSON without crashing", () => {
    const claudeDir = join(tmpRoot, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "mcp.json"), "{ this is not json");
    expect(checkMcpConfigured("anything", tmpRoot)).toBe("missing");
  });
});

describe("buildCheckReport", () => {
  it("returns exitCode=1 with secrets[].status=missing when env is unset", () => {
    writeSkillMd([
      "name: demo-skill",
      "secrets: [DEMO_KEY]",
    ].join("\n"));
    const report = buildCheckReport("demo-skill", tmpRoot);
    expect(report.exitCode).toBe(1);
    expect(report.secrets).toHaveLength(1);
    expect(report.secrets[0].name).toBe("DEMO_KEY");
    expect(report.secrets[0].status).toBe("missing");
  });

  it("returns exitCode=0 when only declared secret is present in env (no other deps)", () => {
    process.env.DEMO_KEY = "a-test-value";
    writeSkillMd([
      "name: demo-skill",
      "secrets: [DEMO_KEY]",
    ].join("\n"));
    const report = buildCheckReport("demo-skill", tmpRoot);
    expect(report.secrets[0].status).toBe("ok");
    expect(report.exitCode).toBe(0);
    delete process.env.DEMO_KEY;
  });

  it("never echoes the secret value in any field of the report", () => {
    process.env.DEMO_KEY = "super-secret-value-DO-NOT-LEAK";
    writeSkillMd([
      "name: demo-skill",
      "secrets: [DEMO_KEY]",
    ].join("\n"));
    const report = buildCheckReport("demo-skill", tmpRoot);
    const json = JSON.stringify(report);
    expect(json).not.toContain("super-secret-value-DO-NOT-LEAK");
    delete process.env.DEMO_KEY;
  });

  it("returns empty report shape when skill is not found", () => {
    const report = buildCheckReport("nope", tmpRoot);
    expect(report.dir).toBe("");
    expect(report.exitCode).toBe(1);
  });

  it("reports MCP missing when a declared server is not in any config", () => {
    writeSkillMd([
      "name: demo-skill",
      "mcp-deps: [unknownmcp]",
    ].join("\n"));
    const report = buildCheckReport("demo-skill", tmpRoot);
    expect(report.mcps[0].name).toBe("unknownmcp");
    expect(report.mcps[0].status).toBe("missing");
    expect(report.exitCode).toBe(1);
  });
});
