import { describe, it, expect } from "vitest";
import { validateRepoSegment, validateSkillName } from "../validation.js";

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
