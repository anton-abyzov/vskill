// 0894: a GitHub skill's complete folder (nested dirs, non-standard paths,
// binaries, exec bits) must reach the canonical .agents/skills copy AND every
// copy-mode agent folder byte for byte.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync, lstatSync, existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { installSkillToAgents } from "../multi-install.js";
import { getAgent, type AgentDefinition } from "../../agents/agents-registry.js";
import { assertSafeBundlePath } from "../bundle-files.js";

const SKILL_MD = "---\nname: recut\ndescription: Recut a talking head\n---\n# Recut\n";
const FONT = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0xff, 0xfe, 0x80, 0x00]);

const BUNDLE: Record<string, string | Uint8Array> = {
  "NOTICE.md": "notice",
  "sub-agents/editor.md": "# editor",
  "scripts/lib/deep/cut.mjs": "export {};\n",
  "scripts/run.sh": "#!/bin/sh\necho hi\n",
  "assets/fonts/Inter.woff2": FONT,
  "references/layouts/pip.md": "# pip",
};

function agents(...ids: string[]): AgentDefinition[] {
  return ids.map((id) => {
    const a = getAgent(id);
    if (!a) throw new Error(`agent ${id} missing`);
    return a;
  });
}

function expectFullTree(dir: string) {
  expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain("# Recut");
  for (const [rel, content] of Object.entries(BUNDLE)) {
    const p = join(dir, ...rel.split("/"));
    expect(existsSync(p), rel).toBe(true);
    const bytes = readFileSync(p);
    const want = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    expect(bytes.equals(want), rel).toBe(true);
  }
  if (process.platform !== "win32") {
    expect(statSync(join(dir, "scripts", "run.sh")).mode & 0o111).not.toBe(0);
    expect(statSync(join(dir, "NOTICE.md")).mode & 0o111).toBe(0);
  }
}

describe("installSkillToAgents — complete skill tree (0894)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(os.tmpdir(), "vskill-fulltree-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("symlink mode: canonical .agents/skills gets every file; claude-code sees the same tree", () => {
    const written = installSkillToAgents({
      skillName: "recut",
      rawContent: SKILL_MD,
      agents: agents("claude-code", "codex"),
      scope: "project",
      projectRoot: root,
      bundleFiles: BUNDLE,
      bundleExecutables: ["scripts/run.sh"],
    });
    expect(written.length).toBeGreaterThan(0);
    const canonical = join(root, ".agents", "skills", "recut");
    expectFullTree(canonical);
    // claude-code reads through its link (or its own copy) — same full tree.
    expectFullTree(join(root, ".claude", "skills", "recut"));
  });

  it("copy mode: every agent folder gets a full byte-exact copy", () => {
    installSkillToAgents({
      skillName: "recut",
      rawContent: SKILL_MD,
      agents: agents("claude-code", "codex"),
      scope: "project",
      projectRoot: root,
      copy: true,
      bundleFiles: BUNDLE,
      bundleExecutables: ["scripts/run.sh"],
    });
    const claudeDir = join(root, ".claude", "skills", "recut");
    expect(lstatSync(claudeDir).isSymbolicLink()).toBe(false);
    expectFullTree(claudeDir);
    expectFullTree(join(root, ".agents", "skills", "recut"));
  });

  it("still refuses traversal and SKILL.md overwrites in an install bundle", () => {
    for (const bad of ["../escape.md", "a/../../b", "/abs.md", "SKILL.md"]) {
      expect(() =>
        installSkillToAgents({
          skillName: "recut",
          rawContent: SKILL_MD,
          agents: agents("codex"),
          scope: "project",
          projectRoot: root,
          bundleFiles: { [bad]: "x" },
        }),
      ).toThrow();
    }
  });

  it("Studio's strict policy is unchanged: non-standard paths still need anyPath", () => {
    expect(() => assertSafeBundlePath("sub-agents/editor.md")).toThrow(/Unsupported/);
    expect(assertSafeBundlePath("sub-agents/editor.md", { anyPath: true })).toBe("sub-agents/editor.md");
  });
});
