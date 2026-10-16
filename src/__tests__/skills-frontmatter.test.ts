// ---------------------------------------------------------------------------
// Lint: every SKILL.md this repo publishes (skills/ and plugins/) must have
// frontmatter that agents accept. agentskills.io caps `description` at 1,024
// characters and requires `name` to be lowercase letters, digits and single
// hyphens (at most 64), matching the folder. `vskill doctor` reports the same
// problems on installed copies; this keeps them from shipping.
//
// Installed copies under agent folders (.claude/, .agents/, ...) and test
// fixtures (some invalid on purpose) are not sources, so they are not checked.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseSkillFrontmatter } from "../commands/doctor.js";

const repoRoot = path.resolve(__dirname, "../..");
const SOURCE_ROOTS = ["skills", "plugins"];
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", "fixtures"]);
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DESCRIPTION = 1024;
const MAX_NAME = 64;

// Published under these names before the folder rule was enforced; renaming
// either side changes the skill's identity for existing installs.
const KNOWN_NAME_MISMATCHES: Record<string, string> = {
  "skills/greet-anton": "greet-anton-abyzov",
  "plugins/personal/skills/greet-anton": "greet-anton-abyzov",
};

function findSkillFiles(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) findSkillFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Problems with one SKILL.md, as readable strings (empty when valid). */
function frontmatterProblems(rel: string, content: string): string[] {
  const fm = parseSkillFrontmatter(content);
  if (!fm) return [`${rel}: no YAML frontmatter`];
  const problems: string[] = [];
  const folderRel = path.posix.dirname(rel);
  const folder = path.posix.basename(folderRel);
  const name = fm.name?.trim();
  if (!name) {
    problems.push(`${rel}: frontmatter has no name`);
  } else {
    if (name.length > MAX_NAME || !NAME_RE.test(name)) {
      problems.push(`${rel}: name "${name}" must be lowercase letters, digits and single hyphens, at most ${MAX_NAME} chars`);
    }
    if (name !== folder && KNOWN_NAME_MISMATCHES[folderRel] !== name) {
      problems.push(`${rel}: name "${name}" differs from folder "${folder}"`);
    }
  }
  const description = fm.description?.trim() ?? "";
  if (!description) {
    problems.push(`${rel}: description is missing`);
  } else if (description.length > MAX_DESCRIPTION) {
    problems.push(`${rel}: description is ${description.length} chars (max ${MAX_DESCRIPTION})`);
  }
  return problems;
}

const files = SOURCE_ROOTS.flatMap((root) => findSkillFiles(path.join(repoRoot, root)))
  .map((abs) => path.relative(repoRoot, abs).split(path.sep).join("/"))
  .sort();

describe("published SKILL.md frontmatter", () => {
  it("finds the repo's skills", () => {
    expect(files).toContain("skills/html-report/SKILL.md");
    expect(files.length).toBeGreaterThan(10);
  });

  it("every description is at most 1,024 chars and every name is valid", () => {
    const problems = files.flatMap((rel) =>
      frontmatterProblems(rel, readFileSync(path.join(repoRoot, rel), "utf8")),
    );
    expect(problems).toEqual([]);
  });

  it("the known-mismatch list only names skills that still exist", () => {
    for (const folder of Object.keys(KNOWN_NAME_MISMATCHES)) {
      expect(files).toContain(`${folder}/SKILL.md`);
    }
  });
});

describe("frontmatterProblems", () => {
  const md = (fm: string) => `---\n${fm}\n---\n\n# Body\n`;

  it("accepts a valid skill", () => {
    expect(frontmatterProblems("skills/foo/SKILL.md", md("name: foo\ndescription: Does foo. Use when foo."))).toEqual([]);
  });

  it("flags a description over 1,024 chars", () => {
    const long = "x".repeat(1025);
    expect(frontmatterProblems("skills/foo/SKILL.md", md(`name: foo\ndescription: "${long}"`))).toEqual([
      "skills/foo/SKILL.md: description is 1025 chars (max 1024)",
    ]);
    expect(frontmatterProblems("skills/foo/SKILL.md", md(`name: foo\ndescription: "${"x".repeat(1024)}"`))).toEqual([]);
  });

  it("flags a missing, malformed or mismatched name", () => {
    expect(frontmatterProblems("skills/foo/SKILL.md", md("description: d"))).toEqual([
      "skills/foo/SKILL.md: frontmatter has no name",
    ]);
    expect(frontmatterProblems("skills/Foo_Bar/SKILL.md", md("name: Foo_Bar\ndescription: d"))).toEqual([
      'skills/Foo_Bar/SKILL.md: name "Foo_Bar" must be lowercase letters, digits and single hyphens, at most 64 chars',
    ]);
    expect(frontmatterProblems("skills/foo/SKILL.md", md("name: bar\ndescription: d"))).toEqual([
      'skills/foo/SKILL.md: name "bar" differs from folder "foo"',
    ]);
  });

  it("flags a missing description and missing frontmatter", () => {
    expect(frontmatterProblems("skills/foo/SKILL.md", md("name: foo"))).toEqual([
      "skills/foo/SKILL.md: description is missing",
    ]);
    expect(frontmatterProblems("skills/foo/SKILL.md", "# no frontmatter\n")).toEqual([
      "skills/foo/SKILL.md: no YAML frontmatter",
    ]);
  });

  it("measures folded block descriptions the way agents read them", () => {
    const folded = `name: foo\ndescription: >\n  ${"word ".repeat(150)}\n  ${"word ".repeat(100)}`;
    expect(frontmatterProblems("skills/foo/SKILL.md", md(folded))).toEqual([
      "skills/foo/SKILL.md: description is 1249 chars (max 1024)",
    ]);
  });
});
