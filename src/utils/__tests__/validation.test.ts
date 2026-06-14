import { describe, it, expect } from "vitest";
import { validateRepoSegment, validateSkillName, parseGitHubSource, classifyIdentifier } from "../validation.js";

describe("validateRepoSegment (T-011)", () => {
  it("TC-023: accepts valid owner/repo names", () => {
    expect(validateRepoSegment("my-org")).toBe(true);
    expect(validateRepoSegment("user.name")).toBe(true);
    expect(validateRepoSegment("repo_123")).toBe(true);
    expect(validateRepoSegment("A-Z_test.repo")).toBe(true);
  });

  it("TC-024: rejects path traversal", () => {
    expect(validateRepoSegment("../etc/passwd")).toBe(false);
    expect(validateRepoSegment("..")).toBe(false);
    expect(validateRepoSegment("foo/../bar")).toBe(false);
  });

  it("TC-025: rejects null bytes", () => {
    expect(validateRepoSegment("repo\x00name")).toBe(false);
  });

  it("rejects slashes", () => {
    expect(validateRepoSegment("owner/repo")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateRepoSegment("")).toBe(false);
  });

  it("rejects spaces", () => {
    expect(validateRepoSegment("my repo")).toBe(false);
  });
});

describe("validateSkillName (T-011)", () => {
  it("TC-026: accepts valid skill names", () => {
    expect(validateSkillName("my-skill")).toBe(true);
    expect(validateSkillName("skill_v2")).toBe(true);
    expect(validateSkillName("code-review")).toBe(true);
  });

  it("TC-027: rejects path traversal", () => {
    expect(validateSkillName("../../malicious")).toBe(false);
    expect(validateSkillName("../..")).toBe(false);
    expect(validateSkillName("skill/../../etc")).toBe(false);
  });

  it("rejects backslash traversal", () => {
    expect(validateSkillName("..\\..\\malicious")).toBe(false);
  });

  it("rejects null bytes", () => {
    expect(validateSkillName("skill\x00name")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateSkillName("")).toBe(false);
  });
});

describe("parseGitHubSource", () => {
  it("TC-006: parses owner/repo shorthand", () => {
    expect(parseGitHubSource("myorg/myskill")).toEqual({ owner: "myorg", repo: "myskill" });
  });

  it("TC-007: parses full GitHub URL", () => {
    expect(parseGitHubSource("https://github.com/myorg/myskill")).toEqual({ owner: "myorg", repo: "myskill" });
  });

  it("TC-008: strips .git suffix", () => {
    expect(parseGitHubSource("https://github.com/myorg/myskill.git")).toEqual({ owner: "myorg", repo: "myskill" });
  });

  it("TC-009: strips trailing slash", () => {
    expect(parseGitHubSource("https://github.com/myorg/myskill/")).toEqual({ owner: "myorg", repo: "myskill" });
  });

  it("TC-010: tree/branch URL with path resolves to a skill deep link", () => {
    expect(parseGitHubSource("https://github.com/myorg/myskill/tree/main/src")).toEqual({
      owner: "myorg",
      repo: "myskill",
      ref: "main",
      skillPath: "src",
    });
  });

  // F1: deep links must pin a single skill instead of the whole repo
  it("extracts skill path and ref from /tree/<branch>/<path> URLs", () => {
    expect(
      parseGitHubSource("https://github.com/anton-abyzov/vskill-test-public-skills-826/tree/main/skills/git-bisect-detective")
    ).toEqual({
      owner: "anton-abyzov",
      repo: "vskill-test-public-skills-826",
      ref: "main",
      skillPath: "skills/git-bisect-detective",
    });
  });

  it("extracts skill path and ref from /blob/<branch>/<path>/SKILL.md URLs", () => {
    expect(
      parseGitHubSource("https://github.com/myorg/myrepo/blob/main/skills/my-skill/SKILL.md")
    ).toEqual({ owner: "myorg", repo: "myrepo", ref: "main", skillPath: "skills/my-skill" });
  });

  it("blob URL for root SKILL.md yields empty skillPath", () => {
    expect(parseGitHubSource("https://github.com/myorg/myrepo/blob/develop/SKILL.md")).toEqual({
      owner: "myorg",
      repo: "myrepo",
      ref: "develop",
      skillPath: "",
    });
  });

  it("preserves non-default branch from tree URLs", () => {
    expect(parseGitHubSource("https://github.com/myorg/myrepo/tree/develop/skills/x")).toEqual({
      owner: "myorg",
      repo: "myrepo",
      ref: "develop",
      skillPath: "skills/x",
    });
  });

  it("bare repo URL yields no skillPath or ref", () => {
    expect(parseGitHubSource("https://github.com/myorg/myrepo")).toEqual({ owner: "myorg", repo: "myrepo" });
  });

  it("tree URL without a path stays a bare repo", () => {
    expect(parseGitHubSource("https://github.com/myorg/myrepo/tree/main")).toEqual({ owner: "myorg", repo: "myrepo" });
  });

  it("blob URL not pointing at SKILL.md stays a bare repo", () => {
    expect(parseGitHubSource("https://github.com/myorg/myrepo/blob/main/README.md")).toEqual({ owner: "myorg", repo: "myrepo" });
  });

  it("TC-011: rejects non-GitHub URLs", () => {
    expect(parseGitHubSource("https://gitlab.com/myorg/myskill")).toBeNull();
  });

  it("TC-012: rejects URLs with insufficient path segments", () => {
    expect(parseGitHubSource("https://github.com/myorg")).toBeNull();
  });

  it("TC-013: rejects empty input", () => {
    expect(parseGitHubSource("")).toBeNull();
  });
});

describe("classifyIdentifier", () => {
  it("classifies owner/repo as owner-repo", () => {
    const r = classifyIdentifier("remotion-dev/skills");
    expect(r).toEqual({ type: "owner-repo", owner: "remotion-dev", repo: "skills" });
  });

  it("classifies owner/repo/skill as owner-repo-skill", () => {
    const r = classifyIdentifier("remotion-dev/skills/remotion");
    expect(r).toEqual({ type: "owner-repo-skill", owner: "remotion-dev", repo: "skills", skill: "remotion" });
  });

  it("classifies flat name as flat", () => {
    const r = classifyIdentifier("remotion-dev-skills-remotion");
    expect(r).toEqual({ type: "flat", name: "remotion-dev-skills-remotion" });
  });

  it("classifies single word as flat", () => {
    const r = classifyIdentifier("myskill");
    expect(r).toEqual({ type: "flat", name: "myskill" });
  });

  it("classifies https URL as url", () => {
    expect(classifyIdentifier("https://github.com/foo/bar").type).toBe("url");
  });

  it("classifies github.com shorthand as url", () => {
    expect(classifyIdentifier("github.com/foo/bar").type).toBe("url");
  });

  it("classifies 4+ part paths as flat (not parseable)", () => {
    const r = classifyIdentifier("a/b/c/d");
    expect(r).toEqual({ type: "flat", name: "a/b/c/d" });
  });

  it("classifies empty string as flat", () => {
    const r = classifyIdentifier("");
    expect(r).toEqual({ type: "flat", name: "" });
  });
});
