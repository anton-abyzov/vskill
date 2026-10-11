// 0894: a GitHub skill's complete folder (nested dirs, non-standard paths,
// binaries, exec bits) must reach the canonical .agents/skills copy AND every
// copy-mode agent folder byte for byte.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync, lstatSync, existsSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { installSkillToAgents, installSkillForAgent, parseSkillForInstall } from "../multi-install.js";
import { installSymlink } from "../canonical.js";
import { collectSkillBundle, collectSkillBundleFiles } from "../bundle-files.js";
import { chmodSync } from "node:fs";
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
    // 0894 review: skill.md / SKILL.MD would overwrite SKILL.md on macOS/Windows.
    for (const bad of ["../escape.md", "a/../../b", "/abs.md", "SKILL.md", "skill.md", "SKILL.MD", "Skill.md"]) {
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

  it("refuses two bundle paths that collide case-insensitively", () => {
    expect(() =>
      installSkillToAgents({
        skillName: "recut",
        rawContent: SKILL_MD,
        agents: agents("codex"),
        scope: "project",
        projectRoot: root,
        bundleFiles: { "notes/A.md": "a", "notes/a.md": "b" },
      }),
    ).toThrow(/collide on a case-insensitive filesystem/);
  });

  describe("reinstall over an existing install (0894 review)", () => {
    const install = (bundleFiles: Record<string, string | Uint8Array>, extra: { exec?: string[]; prev?: string[]; copy?: boolean } = {}) =>
      installSkillToAgents({
        skillName: "recut",
        rawContent: SKILL_MD,
        agents: agents("claude-code", "codex"),
        scope: "project",
        projectRoot: root,
        copy: extra.copy,
        bundleFiles,
        bundleExecutables: extra.exec,
        previousFiles: extra.prev,
      });
    const canonical = () => join(root, ".agents", "skills", "recut");

    it("removes files the previous install recorded and the new version dropped, keeps untracked ones", () => {
      install({ "scripts/old.mjs": "old", "scripts/keep.mjs": "keep", "assets/gone/x.png": new Uint8Array([1]) });
      // A file the user (or Studio evals) added: never recorded, never removed.
      mkdirSync(join(canonical(), "evals"), { recursive: true });
      writeFileSync(join(canonical(), "evals", "evals.json"), "{}");

      install(
        { "scripts/keep.mjs": "keep2" },
        { prev: ["SKILL.md", "scripts/old.mjs", "scripts/keep.mjs", "assets/gone/x.png"] },
      );
      expect(existsSync(join(canonical(), "scripts", "old.mjs"))).toBe(false);
      expect(existsSync(join(canonical(), "assets"))).toBe(false); // emptied folders pruned
      expect(readFileSync(join(canonical(), "scripts", "keep.mjs"), "utf8")).toBe("keep2");
      expect(readFileSync(join(canonical(), "evals", "evals.json"), "utf8")).toBe("{}");
    });

    it("replaces a folder with a file and a file with a folder instead of dying with EISDIR/ENOTDIR", () => {
      install({ "assets/font": new Uint8Array([1]), "lib/x/y.mjs": "y" }, { copy: true });
      expect(() =>
        install({ "assets/font/Inter.woff2": new Uint8Array([2]), "lib/x": "now a file" }, { copy: true }),
      ).not.toThrow();
      for (const dir of [canonical(), join(root, ".claude", "skills", "recut")]) {
        expect(Array.from(readFileSync(join(dir, "assets", "font", "Inter.woff2")))).toEqual([2]);
        expect(readFileSync(join(dir, "lib", "x"), "utf8")).toBe("now a file");
      }
    });

    it("never writes through a symlinked folder inside the skill", () => {
      const outside = mkdtempSync(join(os.tmpdir(), "vskill-outside-"));
      try {
        mkdirSync(canonical(), { recursive: true });
        symlinkSync(outside, join(canonical(), "scripts"), "dir");
        install({ "scripts/run.sh": "echo" });
        expect(existsSync(join(outside, "run.sh"))).toBe(false);
        expect(lstatSync(join(canonical(), "scripts")).isSymbolicLink()).toBe(false);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it.skipIf(process.platform === "win32")("resets a stale 0755 when the new version is not executable", () => {
      install({ "scripts/run.sh": "a" }, { exec: ["scripts/run.sh"] });
      expect(statSync(join(canonical(), "scripts", "run.sh")).mode & 0o777).toBe(0o755);
      // The GitHub path always knows the modes (an empty list = none executable).
      install({ "scripts/run.sh": "b" }, { exec: [], prev: ["SKILL.md", "scripts/run.sh"] });
      expect(statSync(join(canonical(), "scripts", "run.sh")).mode & 0o777).toBe(0o644);
    });
  });

  // 0894 re-review: Studio installs a local skill folder in-process
  // (collectSkillBundle -> dispatchTier1). Exec bits and binary bytes must
  // survive; a string round-trip turned ff 00 80 41 into ef bf bd 00 ef bf bd 41.
  it.skipIf(process.platform === "win32")("Studio Tier-1 install keeps exec bits and binary bytes", async () => {
    const src = join(root, "src-skill");
    mkdirSync(join(src, "scripts"), { recursive: true });
    mkdirSync(join(src, "assets"), { recursive: true });
    writeFileSync(join(src, "SKILL.md"), SKILL_MD);
    writeFileSync(join(src, "scripts", "run.sh"), "#!/bin/sh\necho hi\n");
    chmodSync(join(src, "scripts", "run.sh"), 0o755);
    writeFileSync(join(src, "assets", "blob.bin"), Buffer.from([0xff, 0x00, 0x80, 0x41]));

    const local = await collectSkillBundle(src);
    expect(local.executables).toEqual(["scripts/run.sh"]);
    expect(Array.from(local.binaryFiles["assets/blob.bin"])).toEqual([0xff, 0x00, 0x80, 0x41]);
    // The text-only helper skips the binary instead of corrupting it.
    expect(Object.keys(await collectSkillBundleFiles(src))).toEqual(["scripts/run.sh"]);

    const skill = { ...parseSkillForInstall(SKILL_MD, "recut", local.files), binaryFiles: local.binaryFiles, executables: local.executables };
    const project = join(root, "proj");
    mkdirSync(project);
    const res = installSkillForAgent(agents("codex")[0], skill, "project", project, SKILL_MD);
    expect(res.status).toBe("installed");
    const dest = join(project, ".agents", "skills", "recut");
    expect(Array.from(readFileSync(join(dest, "assets", "blob.bin")))).toEqual([0xff, 0x00, 0x80, 0x41]);
    expect(statSync(join(dest, "scripts", "run.sh")).mode & 0o111).not.toBe(0);
  });

  it.skipIf(process.platform === "win32")("without exec info, a rewrite leaves an existing file's mode alone", () => {
    installSymlink("recut", SKILL_MD, agents("codex"), { global: false, projectRoot: root }, { "scripts/run.sh": "a" });
    const p = join(root, ".agents", "skills", "recut", "scripts", "run.sh");
    chmodSync(p, 0o755);
    installSymlink("recut", SKILL_MD, agents("codex"), { global: false, projectRoot: root }, { "scripts/run.sh": "b" });
    expect(statSync(p).mode & 0o777).toBe(0o755);
    expect(readFileSync(p, "utf8")).toBe("b");
  });

  // 0894 re-review: only the GitHub bundle path may write arbitrary paths;
  // `vskill update` on a plugin source passes repo paths like
  // plugins/<p>/skills/<x>/SKILL.md and must not nest them in the skill.
  it("keeps the standard-folder policy for every caller except the GitHub bundle install", () => {
    const opts = { global: false, projectRoot: root };
    expect(() =>
      installSymlink("recut", SKILL_MD, agents("codex"), opts, { "plugins/p/skills/x/SKILL.md": "# x" }),
    ).toThrow(/Unsupported bundled skill file path/);
    expect(existsSync(join(root, ".agents", "skills", "recut", "plugins"))).toBe(false);
    expect(() =>
      installSymlink("recut", SKILL_MD, agents("codex"), opts, { "sub-agents/a.md": "# a" }, { anyPath: true }),
    ).not.toThrow();
    expect(existsSync(join(root, ".agents", "skills", "recut", "sub-agents", "a.md"))).toBe(true);
  });

  it("Studio's strict policy is unchanged: non-standard paths still need anyPath", () => {
    expect(() => assertSafeBundlePath("sub-agents/editor.md")).toThrow(/Unsupported/);
    expect(assertSafeBundlePath("sub-agents/editor.md", { anyPath: true })).toBe("sub-agents/editor.md");
  });
});
