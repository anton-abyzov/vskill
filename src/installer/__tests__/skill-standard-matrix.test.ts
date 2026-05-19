// 0847 T-008/T-009 -- skill standard fixture matrix.
//
// A standards-compliant skill is a directory, not only a SKILL.md string:
//   SKILL.md + agents/openai.yaml + scripts/ + references/ + assets/.
// This matrix verifies that the in-process desktop/Studio install path and
// Tier-3 clipboard export preserve that complete source across universal,
// OpenAI/ChatGPT, and Anthropic/Claude-compatible targets.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildClipboardBlob } from "../clipboard-export.js";
import { installSkillToMultipleAgents } from "../multi-install.js";
import type { ParsedSkill } from "../transformers/index.js";
import { __test__ as installRouteTest } from "../../eval-server/install-skill-routes.js";

type BundledParsedSkill = ParsedSkill & { files: Record<string, string> };

const standardSkill: BundledParsedSkill = {
  name: "standard-matrix",
  description: "Validate universal, OpenAI, and Anthropic skill compatibility.",
  version: "2.3.4",
  originalFrontmatter: [
    "name: standard-matrix",
    "description: Validate universal, OpenAI, and Anthropic skill compatibility.",
    "version: 2.3.4",
    "author: Anton Abyzov",
    "metadata:",
    "  category: testing",
    "  tags:",
    "    - compatibility",
    "target-agents: codex, claude-code, chatgpt",
  ].join("\n"),
  body: [
    "# Standard Matrix",
    "",
    "Use `scripts/audit.mjs` and consult `references/checklist.md`.",
    "Display metadata comes from `agents/openai.yaml`.",
    "",
  ].join("\n"),
  files: {
    "agents/openai.yaml": [
      "display_name: Standard Matrix",
      "short_description: Cross-agent install fixture",
      "default_prompt: Verify this skill installs everywhere.",
    ].join("\n"),
    "scripts/audit.mjs": "export function audit() { return 'ok'; }\n",
    "references/checklist.md": "# Checklist\n\n- Preserve resources.\n",
    "assets/icon.svg": "<svg role=\"img\"><title>standard</title></svg>\n",
  },
};

let workDir: string;
let homeBackup: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "vskill-standard-matrix-"));
  homeBackup = process.env.HOME;
  process.env.HOME = workDir;
});

afterEach(() => {
  if (homeBackup !== undefined) process.env.HOME = homeBackup;
  rmSync(workDir, { recursive: true, force: true });
});

describe("0847 T-008/T-009 -- multi-agent skill standard matrix", () => {
  it("preserves full frontmatter and bundled resources for Claude/Anthropic-compatible installs", async () => {
    const result = await installSkillToMultipleAgents({
      skill: standardSkill,
      agentIds: ["claude-code"],
      scope: "user",
      projectRoot: workDir,
    });

    expect(result.errorCount).toBe(0);
    const skillDir = join(workDir, ".claude", "skills", "standard-matrix");
    const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(skillMd).toContain("version: 2.3.4");
    expect(skillMd).toContain("author: Anton Abyzov");
    expect(skillMd).toContain("metadata:");
    expect(skillMd).toContain("target-agents: codex, claude-code, chatgpt");
    expect(readFileSync(join(skillDir, "agents", "openai.yaml"), "utf-8")).toContain(
      "display_name: Standard Matrix",
    );
    expect(readFileSync(join(skillDir, "scripts", "audit.mjs"), "utf-8")).toContain(
      "audit",
    );
    expect(readFileSync(join(skillDir, "references", "checklist.md"), "utf-8")).toContain(
      "Preserve resources",
    );
    expect(existsSync(join(skillDir, "assets", "icon.svg"))).toBe(true);
  });

  it("preserves bundled resources for Tier-1 universal and Tier-2 transformed filesystem installs", async () => {
    const result = await installSkillToMultipleAgents({
      skill: standardSkill,
      agentIds: ["codex", "cursor", "github-copilot-ext"],
      scope: "user",
      projectRoot: workDir,
    });

    expect(result.errorCount).toBe(0);
    expect(existsSync(join(workDir, ".codex", "skills", "standard-matrix"))).toBe(true);
    expect(readFileSync(join(workDir, ".agents", "skills", "standard-matrix", "agents", "openai.yaml"), "utf-8")).toContain(
      "default_prompt",
    );

    const cursorRule = join(workDir, ".cursor", "rules", "standard-matrix.mdc");
    expect(readFileSync(cursorRule, "utf-8")).toContain("Use `scripts/audit.mjs`");
    expect(readFileSync(join(workDir, ".cursor", "skills", "standard-matrix", "scripts", "audit.mjs"), "utf-8")).toContain(
      "return 'ok'",
    );
    expect(readFileSync(join(workDir, ".config", "github-copilot", "skills", "standard-matrix", "agents", "openai.yaml"), "utf-8")).toContain(
      "short_description",
    );
  });

  it("ChatGPT/OpenAI export includes OpenAI metadata and bundled resource content", () => {
    const exported = buildClipboardBlob(standardSkill, "chatgpt");

    expect(exported.blob).toContain("Standard Matrix");
    expect(exported.blob).toContain("version: 2.3.4");
    expect(exported.blob).toContain("author: Anton Abyzov");
    expect(exported.blob).toContain("agents/openai.yaml");
    expect(exported.blob).toContain("display_name: Standard Matrix");
    expect(exported.blob).toContain("scripts/audit.mjs");
    expect(exported.blob).toContain("references/checklist.md");
    expect(exported.blob).toContain("assets/icon.svg");
  });

  it("desktop fallback resolution loads agents/openai.yaml and standard resource folders", async () => {
    const skillDir = join(workDir, ".claude", "skills", "standard-matrix");
    mkdirSync(join(skillDir, "agents"), { recursive: true });
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    mkdirSync(join(skillDir, "references"), { recursive: true });
    mkdirSync(join(skillDir, "assets"), { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\n${standardSkill.originalFrontmatter}\n---\n\n${standardSkill.body}`,
      "utf-8",
    );
    for (const [relPath, content] of Object.entries(standardSkill.files)) {
      writeFileSync(join(skillDir, relPath), content, "utf-8");
    }

    const resolved = await installRouteTest.resolveParsedSkillFromIdentifier(
      "standard-matrix",
      { cwd: workDir, home: workDir },
    );

    expect(resolved).not.toBeNull();
    expect((resolved as BundledParsedSkill).files["agents/openai.yaml"]).toContain(
      "display_name",
    );
    expect((resolved as BundledParsedSkill).files["scripts/audit.mjs"]).toContain("audit");
    expect((resolved as BundledParsedSkill).files["references/checklist.md"]).toContain(
      "Checklist",
    );
    expect((resolved as BundledParsedSkill).files["assets/icon.svg"]).toContain("<svg");
  });

  it("rejects unsafe bundled file paths before any filesystem write", async () => {
    const result = await installSkillToMultipleAgents({
      skill: {
        ...standardSkill,
        files: {
          "../escape.txt": "nope",
          "scripts/audit.mjs": "safe",
        },
      },
      agentIds: ["claude-code", "cursor"],
      scope: "user",
      projectRoot: workDir,
    });

    expect(result.errorCount).toBe(2);
    expect(result.agents.every((a) => a.status === "error")).toBe(true);
    expect(existsSync(join(workDir, "escape.txt"))).toBe(false);
  });
});
