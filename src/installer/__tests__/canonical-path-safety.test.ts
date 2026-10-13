import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, linkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getInstallableAgents } from "../../agents/agents-registry.js";
import { installCopy, installSymlink } from "../canonical.js";
let root: string;
const name = "private-team-skill-123456789012";
const content = "---\nname: helpful\ndescription: Helpful skill\n---\nNew skill bytes.\n";
const agents = getInstallableAgents().filter((agent) => ["codex", "claude-code"].includes(agent.id));
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "vskill-path-safety-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
for (const [mode, install] of [["copy", installCopy], ["symlink", installSymlink]] as const) {
  describe(`canonical ${mode} containment`, () => {
    it("never deletes a stale file through a child directory symlink", () => {
      const dir = join(root, ".agents/skills", name);
      const outside = join(root, "outside");
      mkdirSync(dir, { recursive: true }); mkdirSync(outside);
      writeFileSync(join(outside, "old.sh"), "outside sentinel");
      symlinkSync(outside, join(dir, "scripts"), "dir");
      install(name, content, agents, { global: false, projectRoot: root }, {}, { anyPath: true, previousFiles: ["SKILL.md", "scripts/old.sh"] });
      expect(readFileSync(join(outside, "old.sh"), "utf8")).toBe("outside sentinel");
      expect(existsSync(join(dir, "scripts"))).toBe(false);
    });
    it("replaces a symlinked SKILL.md without writing through it", () => {
      const dir = join(root, ".agents/skills", name);
      const outside = join(root, "outside.md");
      mkdirSync(dir, { recursive: true }); writeFileSync(outside, "outside sentinel");
      symlinkSync(outside, join(dir, "SKILL.md"));
      install(name, content, agents, { global: false, projectRoot: root });
      expect(readFileSync(outside, "utf8")).toBe("outside sentinel");
      expect(lstatSync(join(dir, "SKILL.md")).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain("New skill bytes");
    });
    it("detaches a symlinked canonical skill root without mutating its target", () => {
      const dir = join(root, ".agents/skills", name);
      const outside = join(root, "outside");
      mkdirSync(dirname(dir), { recursive: true }); mkdirSync(outside);
      writeFileSync(join(outside, "SKILL.md"), "outside sentinel");
      symlinkSync(outside, dir, "dir");
      install(name, content, agents, { global: false, projectRoot: root });
      expect(readFileSync(join(outside, "SKILL.md"), "utf8")).toBe("outside sentinel");
      expect(lstatSync(dir).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain("New skill bytes");
    });
    it.each([".agents", ".agents/skills"])("rejects a symlinked shared parent %s before writing outside", (parent) => {
      const outside = join(root, "outside");
      const path = join(root, parent);
      mkdirSync(outside); mkdirSync(dirname(path), { recursive: true });
      writeFileSync(join(outside, "sentinel"), "outside sentinel");
      symlinkSync(outside, path, "dir");
      expect(() => install(name, content, agents, { global: false, projectRoot: root })).toThrow("unsafe parent directory");
      expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("outside sentinel");
      expect(existsSync(join(outside, name))).toBe(false);
      expect(existsSync(join(outside, "skills"))).toBe(false);
    });
    it("replaces a hard-linked SKILL.md without overwriting its other link", () => {
      const dir = join(root, ".agents/skills", name);
      const outside = join(root, "outside.md");
      mkdirSync(dir, { recursive: true }); writeFileSync(outside, "outside sentinel");
      linkSync(outside, join(dir, "SKILL.md"));
      install(name, content, agents, { global: false, projectRoot: root });
      expect(readFileSync(outside, "utf8")).toBe("outside sentinel");
      expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain("New skill bytes");
    });
    it("replaces bundle entry and ancestor links without touching outside files", () => {
      const dir = join(root, ".agents/skills", name);
      const outside = join(root, "outside");
      mkdirSync(dir, { recursive: true }); mkdirSync(outside);
      writeFileSync(join(outside, "entry"), "outside sentinel");
      symlinkSync(outside, join(dir, "scripts"), "dir");
      symlinkSync(join(outside, "entry"), join(dir, "NOTICE.md"));
      install(name, content, agents, { global: false, projectRoot: root }, { "scripts/new.sh": "new script", "NOTICE.md": "new notice" }, { anyPath: true });
      expect(readFileSync(join(outside, "entry"), "utf8")).toBe("outside sentinel");
      expect(existsSync(join(outside, "new.sh"))).toBe(false);
      expect(lstatSync(join(dir, "scripts")).isSymbolicLink()).toBe(false);
      expect(lstatSync(join(dir, "NOTICE.md")).isSymbolicLink()).toBe(false);
    });
  });
}
it("keeps normal Claude symlink updates linked to the canonical skill", () => {
  installSymlink(name, content, agents, { global: false, projectRoot: root }, { "scripts/old.sh": "old" }, { anyPath: true });
  installSymlink(name, content + "Updated.\n", agents, { global: false, projectRoot: root }, {}, { anyPath: true, previousFiles: ["SKILL.md", "scripts/old.sh"] });
  const canonical = join(root, ".agents/skills", name);
  const claude = join(root, ".claude/skills", name);
  expect(lstatSync(claude).isSymbolicLink()).toBe(true);
  expect(realpathSync(claude)).toBe(realpathSync(canonical));
  expect(readFileSync(join(claude, "SKILL.md"), "utf8")).toContain("Updated.");
  expect(existsSync(join(canonical, "scripts/old.sh"))).toBe(false);
});
it("a Claude-only copy cannot write through its SKILL.md symlink", () => {
  const dir = join(root, ".claude/skills", name);
  const outside = join(root, "outside.md");
  mkdirSync(dir, { recursive: true }); writeFileSync(outside, "outside sentinel");
  symlinkSync(outside, join(dir, "SKILL.md"));
  installSymlink(name, content, agents.filter((agent) => agent.id === "claude-code"), { global: false, projectRoot: root });
  expect(readFileSync(outside, "utf8")).toBe("outside sentinel");
  expect(lstatSync(join(dir, "SKILL.md")).isSymbolicLink()).toBe(false);
});
