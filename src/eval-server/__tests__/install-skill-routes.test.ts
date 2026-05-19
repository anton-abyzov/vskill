// 0845 T-017 — POST /api/studio/install-skill extension.
//
// Covers:
//   - Multi-agent in-process path (agentIds[] + parsedSkill in body)
//   - Backward-compat legacy single-agent CLI spawn (AC-US2-09)
//   - Validation: SAFE_AGENT_ID regex, getAgent() lookup, scope allowlist
//   - Localhost gate (FR-007)
//   - Validation helpers exported via __test__

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { __test__ } from "../install-skill-routes.js";

const {
  validateAgentIds,
  isValidParsedSkill,
  SAFE_AGENT_ID,
  buildArgs,
  normalizeInstallScope,
  resolveParsedSkillFromIdentifier,
  runMultiInstallJob,
} = __test__;

describe("validateAgentIds", () => {
  it("accepts a valid list of registered slug agentIds", () => {
    const r = validateAgentIds(["claude-code", "cursor", "chatgpt"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ids).toEqual(["claude-code", "cursor", "chatgpt"]);
  });

  it("rejects an empty array", () => {
    const r = validateAgentIds([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/i);
  });

  it("rejects a non-array", () => {
    expect(validateAgentIds("cursor" as any).ok).toBe(false);
    expect(validateAgentIds(null as any).ok).toBe(false);
    expect(validateAgentIds({ a: 1 } as any).ok).toBe(false);
  });

  it("rejects an unknown agentId", () => {
    const r = validateAgentIds(["no-such-agent"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown/i);
  });

  it("rejects an agentId with disallowed chars (path traversal attempt)", () => {
    const r = validateAgentIds(["../etc/passwd"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid/i);
  });

  it("rejects an agentId with uppercase (regex is strict)", () => {
    const r = validateAgentIds(["Cursor"]);
    expect(r.ok).toBe(false);
  });
});

describe("SAFE_AGENT_ID regex", () => {
  it("accepts known agent ids", () => {
    for (const id of [
      "claude-code",
      "cursor",
      "github-copilot-ext",
      "chatgpt",
      "bolt-new",
      "v0",
      "amazon-q-cli",
    ]) {
      expect(SAFE_AGENT_ID.test(id)).toBe(true);
    }
  });

  it("rejects strings with /, @, ., or uppercase", () => {
    for (const bad of [
      "cursor/skills",
      "@org/skill",
      "cursor.1",
      "Cursor",
      "../escape",
      "",
      "-leading",
    ]) {
      expect(SAFE_AGENT_ID.test(bad)).toBe(false);
    }
  });
});

describe("isValidParsedSkill", () => {
  it("accepts a well-formed ParsedSkill", () => {
    expect(
      isValidParsedSkill({
        name: "x",
        description: "y",
        body: "z",
        originalFrontmatter: "",
      }),
    ).toBe(true);
  });

  it("rejects missing fields", () => {
    expect(isValidParsedSkill({ name: "x" })).toBe(false);
    expect(isValidParsedSkill({ description: "y", body: "z" })).toBe(false);
    expect(isValidParsedSkill(null)).toBe(false);
    expect(isValidParsedSkill("string")).toBe(false);
  });

  it("rejects non-string field values", () => {
    expect(
      isValidParsedSkill({ name: 1, description: "y", body: "z" } as any),
    ).toBe(false);
  });
});

describe("resolveParsedSkillFromIdentifier (0845 closure fallback)", () => {
  async function withFixtureSkill(
    setup: (cwd: string, home: string) => Promise<void>,
    body: (cwd: string, home: string) => Promise<void>,
  ): Promise<void> {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "resolve-skill-"));
    const cwd = path.join(tmp, "cwd");
    const home = path.join(tmp, "home");
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(home, { recursive: true });
    try {
      await setup(cwd, home);
      await body(cwd, home);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  it("resolves a project-scope skill into a ParsedSkill", async () => {
    await withFixtureSkill(
      async (cwd) => {
        const skillDir = path.join(cwd, ".claude", "skills", "demo-skill");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          [
            "---",
            "name: demo-skill",
            'description: "Demo description"',
            "version: 1.2.3",
            "---",
            "",
            "Body line one — this is the description fallback.",
            "More body content.",
            "",
          ].join("\n"),
          "utf-8",
        );
      },
      async (cwd, home) => {
        const resolved = await resolveParsedSkillFromIdentifier("demo-skill", {
          cwd,
          home,
        });
        expect(resolved).not.toBeNull();
        expect(resolved!.name).toBe("demo-skill");
        expect(resolved!.version).toBe("1.2.3");
        expect(resolved!.body).toContain("Body line one");
        expect(resolved!.originalFrontmatter).toContain("name: demo-skill");
        expect(resolved!.description.length).toBeGreaterThan(0);
      },
    );
  });

  it("returns null when no on-disk skill matches the identifier", async () => {
    await withFixtureSkill(
      async () => {
        /* no skill at all */
      },
      async (cwd, home) => {
        const resolved = await resolveParsedSkillFromIdentifier(
          "does-not-exist-anywhere",
          { cwd, home },
        );
        expect(resolved).toBeNull();
      },
    );
  });

  it("falls back to the directory basename when frontmatter omits name", async () => {
    await withFixtureSkill(
      async (cwd) => {
        const skillDir = path.join(cwd, ".claude", "skills", "no-name-skill");
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(
          path.join(skillDir, "SKILL.md"),
          [
            "---",
            "description: Skill without name in frontmatter",
            "---",
            "",
            "Skill content goes here.",
            "",
          ].join("\n"),
          "utf-8",
        );
      },
      async (cwd, home) => {
        const resolved = await resolveParsedSkillFromIdentifier(
          "no-name-skill",
          { cwd, home },
        );
        expect(resolved).not.toBeNull();
        expect(resolved!.name).toBe("no-name-skill");
      },
    );
  });
});

describe("buildArgs (legacy single-agent spawn — AC-US2-09 backward compat)", () => {
  it("builds project-scope args", () => {
    expect(buildArgs("@anton/foo", "project")).toEqual([
      "install",
      "@anton/foo",
      "--scope",
      "project",
    ]);
  });

  it("maps user scope to global install args", () => {
    expect(buildArgs("@anton/foo", "user")).toEqual([
      "install",
      "@anton/foo",
      "--global",
    ]);
  });

  it("uses --global for global scope (no --scope flag)", () => {
    expect(buildArgs("@anton/foo", "global")).toEqual([
      "install",
      "@anton/foo",
      "--global",
    ]);
  });
});

describe("normalizeInstallScope", () => {
  it("normalizes legacy global to user for in-process multi-agent installs", () => {
    expect(normalizeInstallScope("project")).toBe("project");
    expect(normalizeInstallScope("user")).toBe("user");
    expect(normalizeInstallScope("global")).toBe("user");
  });
});

describe("runMultiInstallJob — desktop SSE contract", () => {
  async function waitForDone(job: { done: boolean }): Promise<void> {
    for (let i = 0; i < 40; i++) {
      if (job.done) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("multi install job did not finish");
  }

  it("emits per-agent result frames and a terminal summary with results", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "multi-install-job-"));
    try {
      const job = await runMultiInstallJob({
        skill: {
          name: "desktop-parity-skill",
          description: "Desktop parity fixture",
          body: "Use this fixture to verify desktop install events.",
          originalFrontmatter: [
            "name: desktop-parity-skill",
            "description: Desktop parity fixture",
            "version: 1.0.0",
          ].join("\n"),
          version: "1.0.0",
        },
        agentIds: ["chatgpt"],
        scope: "user",
        projectRoot: tmp,
      });

      await waitForDone(job);

      expect(job.pastEvents.map((ev) => ev.event)).toEqual(["result", "done"]);
      const result = job.pastEvents[0]?.data as { agentId?: string; status?: string };
      expect(result).toMatchObject({
        agentId: "chatgpt",
        status: "exported",
      });
      const summary = job.pastEvents[1]?.data as {
        success?: boolean;
        results?: Array<{ agentId: string; status: string }>;
        exportedCount?: number;
        errorCount?: number;
      };
      expect(summary.success).toBe(true);
      expect(summary.results).toEqual([
        expect.objectContaining({ agentId: "chatgpt", status: "exported" }),
      ]);
      expect(summary.exportedCount).toBe(1);
      expect(summary.errorCount).toBe(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
