// 0845 T-013 — End-to-end idempotency across all 8 Tier-2 transformers.
//
// AC-US4-09 + FR-003: re-installing the same skill to the same agent
// produces byte-identical output on disk. The per-transformer unit
// tests assert pure-function idempotency; this file pipes through the
// full multi-install dispatcher to catch any non-determinism introduced
// by the filesystem layer (mtime drift, directory order, etc.).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

import { installSkillToMultipleAgents } from "../multi-install.js";
import type { ParsedSkill } from "../transformers/index.js";

const skill: ParsedSkill = {
  name: "obsidian-brain",
  description: "PARA + LLM Wiki",
  body: "## Workflow\n\nDrop notes in raw/inbox.\n",
  originalFrontmatter: "name: obsidian-brain\ndescription: PARA + LLM Wiki",
};

// Expected output paths per Tier-2 agent — relative to HOME.
const expectedPaths: Record<string, string> = {
  cursor: ".cursor/rules/obsidian-brain.mdc",
  windsurf: ".codeium/windsurf/rules/obsidian-brain.md",
  "github-copilot-ext": ".config/github-copilot/instructions/obsidian-brain.instructions.md",
  junie: ".junie/rules/obsidian-brain.md",
  "kiro-cli": ".kiro/steering/obsidian-brain.md",
  continue: ".continue/rules/obsidian-brain.md",
  trae: ".trae/obsidian-brain.md",
  aider: ".aider/conventions/obsidian-brain.md",
};

let workDir: string;
let homeBackup: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "vskill-idempotency-"));
  homeBackup = process.env.HOME;
  process.env.HOME = workDir;
});

afterEach(() => {
  if (homeBackup !== undefined) process.env.HOME = homeBackup;
  rmSync(workDir, { recursive: true, force: true });
});

describe.each(Object.entries(expectedPaths))(
  "%s — re-install produces byte-equal output",
  (agentId, relativeExpected) => {
    it("two consecutive installs write byte-identical content", async () => {
      // First install
      const r1 = await installSkillToMultipleAgents({
        skill,
        agentIds: [agentId],
        scope: "user",
        projectRoot: workDir,
      });
      expect(r1.agents[0].status).toBe("installed");
      const absPath = join(workDir, relativeExpected);
      expect(existsSync(absPath)).toBe(true);
      const firstContent = readFileSync(absPath);

      // Second install
      const r2 = await installSkillToMultipleAgents({
        skill,
        agentIds: [agentId],
        scope: "user",
        projectRoot: workDir,
      });
      expect(r2.agents[0].status).toBe("installed");
      const secondContent = readFileSync(absPath);

      // Byte-equal content across runs.
      expect(secondContent.equals(firstContent)).toBe(true);
    });
  },
);

describe("Aider conf.yml is idempotent at the pipeline level", () => {
  it("second install does not duplicate the read: entry", async () => {
    await installSkillToMultipleAgents({
      skill,
      agentIds: ["aider"],
      scope: "user",
      projectRoot: workDir,
    });
    await installSkillToMultipleAgents({
      skill,
      agentIds: ["aider"],
      scope: "user",
      projectRoot: workDir,
    });
    const confPath = join(workDir, ".aider.conf.yml");
    const content = readFileSync(confPath, "utf8");
    const occurrences = content.match(/obsidian-brain/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("third install (after pre-existing list) still keeps a single entry", async () => {
    // Pre-populate with one entry the user "wrote by hand"
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(join(workDir, ".aider"), { recursive: true });
    writeFileSync(
      join(workDir, ".aider.conf.yml"),
      "read:\n  - ~/.aider/hand-written.md\n",
    );

    await installSkillToMultipleAgents({
      skill,
      agentIds: ["aider"],
      scope: "user",
      projectRoot: workDir,
    });
    await installSkillToMultipleAgents({
      skill,
      agentIds: ["aider"],
      scope: "user",
      projectRoot: workDir,
    });
    await installSkillToMultipleAgents({
      skill,
      agentIds: ["aider"],
      scope: "user",
      projectRoot: workDir,
    });

    const content = readFileSync(join(workDir, ".aider.conf.yml"), "utf8");
    expect(content.match(/obsidian-brain/g) ?? []).toHaveLength(1);
    expect(content).toContain("hand-written.md");
  });
});

describe("All 8 Tier-2 transformers in one batch", () => {
  it("mixed multi-agent install completes installed for all and is idempotent", async () => {
    const agentIds = Object.keys(expectedPaths);

    const r1 = await installSkillToMultipleAgents({
      skill,
      agentIds,
      scope: "user",
      projectRoot: workDir,
    });
    for (const result of r1.agents) {
      expect(result.status).toBe("installed");
    }

    const snapshot = Object.fromEntries(
      Object.entries(expectedPaths).map(([id, rel]) => [
        id,
        readFileSync(join(workDir, rel)).toString("base64"),
      ]),
    );

    // Re-run the entire batch.
    const r2 = await installSkillToMultipleAgents({
      skill,
      agentIds,
      scope: "user",
      projectRoot: workDir,
    });
    for (const result of r2.agents) {
      expect(result.status).toBe("installed");
    }

    for (const [id, rel] of Object.entries(expectedPaths)) {
      const second = readFileSync(join(workDir, rel)).toString("base64");
      expect(second).toBe(snapshot[id]);
    }
  });
});

// Sanity helper — confirms each expected target path's parent exists,
// proving the dispatcher's mkdir -p path is hit.
describe("output path parents are created (mkdir -p)", () => {
  it.each(Object.entries(expectedPaths))(
    "%s parent dir is created",
    async (agentId, relPath) => {
      await installSkillToMultipleAgents({
        skill,
        agentIds: [agentId],
        scope: "user",
        projectRoot: workDir,
      });
      const parent = dirname(join(workDir, relPath));
      expect(existsSync(parent)).toBe(true);
      expect(statSync(parent).isDirectory()).toBe(true);
    },
  );
});
