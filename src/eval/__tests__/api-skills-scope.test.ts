// ---------------------------------------------------------------------------
// 0698 T-002: scanner emits new 5-scope vocabulary + precedence within AVAILABLE.
//
// Each SkillInfo from scanSkillsTriScope now carries (in addition to legacy
// `scope`): `scopeV2` (new 5-value union), `group`, `source`, `precedenceRank`,
// `shadowedBy`. Within AVAILABLE, same skill name across multiple scopes gets
// a `shadowedBy` pointer on the losers (personal > project; plugins orthogonal).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSkillsTriScope } from "../skill-scanner.js";

let tmpRoot: string;
let fakeHome: string;

function writeSkill(base: string, relDir: string, content = "# skill"): string {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
  return dir;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-t002-root-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-t002-home-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("scanSkillsTriScope — new 5-scope vocabulary + derivations (0698 T-002)", () => {
  it("project-root skill (installed scope) emits scopeV2='available-project', group='available', source='project', precedenceRank=2", async () => {
    writeSkill(tmpRoot, ".claude/skills/lint");
    const skills = await scanSkillsTriScope(tmpRoot, { agentId: "claude-code", home: fakeHome });
    const lint = skills.find((s) => s.skill === "lint");
    expect(lint).toBeDefined();
    expect(lint!.scopeV2).toBe("available-project");
    expect(lint!.group).toBe("available");
    expect(lint!.source).toBe("project");
    expect(lint!.precedenceRank).toBe(2);
  });

  it("global (personal) skill emits scopeV2='available-personal', precedenceRank=1", async () => {
    writeSkill(fakeHome, ".claude/skills/react-helper");
    const skills = await scanSkillsTriScope(tmpRoot, { agentId: "claude-code", home: fakeHome });
    const helper = skills.find((s) => s.skill === "react-helper");
    expect(helper).toBeDefined();
    expect(helper!.scopeV2).toBe("available-personal");
    expect(helper!.group).toBe("available");
    expect(helper!.source).toBe("personal");
    expect(helper!.precedenceRank).toBe(1);
  });

  it("own skill emits scopeV2='authoring-project', group='authoring', source='project'", async () => {
    // Plant a skill outside any agent config dir — classified as 'own'
    writeSkill(tmpRoot, "myplugin/skills/helper");
    const skills = await scanSkillsTriScope(tmpRoot, { agentId: "claude-code", home: fakeHome });
    const helper = skills.find((s) => s.skill === "helper");
    expect(helper).toBeDefined();
    expect(helper!.scopeV2).toBe("authoring-project");
    expect(helper!.group).toBe("authoring");
    expect(helper!.source).toBe("project");
  });

  it("AUTHORING skills do not receive a shadowedBy pointer (shadowing is AVAILABLE-only)", async () => {
    // Plant an 'own' skill and a 'global' (personal) skill with the same name
    writeSkill(tmpRoot, "myplugin/skills/pdf");
    writeSkill(fakeHome, ".claude/skills/pdf");
    const skills = await scanSkillsTriScope(tmpRoot, { agentId: "claude-code", home: fakeHome });
    const own = skills.find((s) => s.skill === "pdf" && s.scopeV2 === "authoring-project");
    expect(own).toBeDefined();
    expect(own!.shadowedBy).toBeFalsy(); // null or undefined — never set on AUTHORING
  });
});

describe("scanSkillsTriScope — precedence shadowing within AVAILABLE (0698 T-002)", () => {
  it("same name in project + personal: project entry shadowedBy='available-personal', personal entry shadowedBy=null (winner)", async () => {
    writeSkill(tmpRoot, ".claude/skills/pdf");
    writeSkill(fakeHome, ".claude/skills/pdf");
    const skills = await scanSkillsTriScope(tmpRoot, { agentId: "claude-code", home: fakeHome });

    const project = skills.find((s) => s.skill === "pdf" && s.scopeV2 === "available-project");
    const personal = skills.find((s) => s.skill === "pdf" && s.scopeV2 === "available-personal");

    expect(project).toBeDefined();
    expect(personal).toBeDefined();
    expect(project!.shadowedBy).toBe("available-personal");
    expect(personal!.shadowedBy).toBeNull();
  });

  it("unique name: shadowedBy is null (winner, no shadow)", async () => {
    writeSkill(tmpRoot, ".claude/skills/unique-skill");
    const skills = await scanSkillsTriScope(tmpRoot, { agentId: "claude-code", home: fakeHome });
    const unique = skills.find((s) => s.skill === "unique-skill");
    expect(unique).toBeDefined();
    expect(unique!.shadowedBy).toBeNull();
  });
});
