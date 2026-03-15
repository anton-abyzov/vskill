import { describe, it, expect } from "vitest";
import { toKebab, resolvePathPreview } from "../useCreateSkill.js";

describe("toKebab", () => {
  it("converts spaces to hyphens and lowercases", () => {
    expect(toKebab("My Cool Skill")).toBe("my-cool-skill");
  });

  it("removes leading and trailing hyphens by default", () => {
    expect(toKebab("  hello world  ")).toBe("hello-world");
  });

  it("preserves trailing hyphens when trim is false", () => {
    expect(toKebab("hello-", false)).toBe("hello-");
  });

  it("handles special characters", () => {
    expect(toKebab("foo@bar#baz")).toBe("foo-bar-baz");
  });

  it("handles empty string", () => {
    expect(toKebab("")).toBe("");
  });

  it("collapses multiple hyphens", () => {
    expect(toKebab("foo   bar")).toBe("foo-bar");
  });
});

describe("resolvePathPreview", () => {
  const root = "/home/user/my-project";

  it("resolves layout 1 (direct plugins)", () => {
    const result = resolvePathPreview(root, 1, "my-plugin", "my-skill");
    expect(result).toBe(".../user/my-project/my-plugin/skills/my-skill/SKILL.md");
  });

  it("resolves layout 2 (nested plugins)", () => {
    const result = resolvePathPreview(root, 2, "my-plugin", "my-skill");
    expect(result).toBe(".../user/my-project/plugins/my-plugin/skills/my-skill/SKILL.md");
  });

  it("resolves layout 3 (root skills)", () => {
    const result = resolvePathPreview(root, 3, "", "my-skill");
    expect(result).toBe(".../user/my-project/skills/my-skill/SKILL.md");
  });

  it("uses placeholder for empty skill name", () => {
    const result = resolvePathPreview(root, 3, "", "");
    expect(result).toBe(".../user/my-project/skills/{skill}/SKILL.md");
  });

  it("uses empty string for empty plugin name in layout 1", () => {
    const result = resolvePathPreview(root, 1, "", "my-skill");
    expect(result).toBe(".../user/my-project//skills/my-skill/SKILL.md");
  });
});
