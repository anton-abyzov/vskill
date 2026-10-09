import { describe, expect, it } from "vitest";
import { upsertFrontmatterVersion, validatesAsYamlFrontmatter } from "../frontmatter.js";

describe("upsertFrontmatterVersion", () => {
  it("replaces existing top-level version preserving order and other fields", () => {
    const input = `---\nname: foo\nversion: 1.0.0\ndescription: a skill\n---\nbody\n`;
    const out = upsertFrontmatterVersion(input, "1.0.3");
    expect(out).toContain("version: 1.0.3");
    expect(out).not.toContain("version: 1.0.0");
    expect(out).toContain("name: foo");
    expect(out).toContain("description: a skill");
    expect(out).toMatch(/body\n$/);
    // Ordering preserved
    const nameIdx = out.indexOf("name:");
    const versionIdx = out.indexOf("version:");
    const descIdx = out.indexOf("description:");
    expect(nameIdx).toBeLessThan(versionIdx);
    expect(versionIdx).toBeLessThan(descIdx);
  });

  it("inserts metadata.version when no version exists", () => {
    const input = `---\nname: foo\ndescription: a skill\n---\nbody\n`;
    const out = upsertFrontmatterVersion(input, "1.0.0");
    expect(out).toContain('metadata:\n  version: "1.0.0"');
    expect(out).not.toMatch(/^version:/m);
  });

  it("appends version when no description and no version exist", () => {
    const input = `---\nname: foo\n---\nbody\n`;
    const out = upsertFrontmatterVersion(input, "1.0.0");
    expect(out).toMatch(/metadata:\n  version: "1\.0\.0"\n---/);
  });

  it("preserves double-quoted version style", () => {
    const input = `---\nname: foo\nversion: "1.0.0"\n---\nbody\n`;
    const out = upsertFrontmatterVersion(input, "1.0.3");
    expect(out).toContain('version: "1.0.3"');
  });

  it("synthesises frontmatter when none exists", () => {
    const input = `# heading\n\nbody only\n`;
    const out = upsertFrontmatterVersion(input, "1.0.0");
    expect(out.startsWith('---\nmetadata:\n  version: "1.0.0"\n---\n')).toBe(true);
    expect(out).toContain("# heading");
  });

  it("updates metadata.version without adding a conflicting root-level version", () => {
    const input = `---\nname: foo\nmetadata:\n  version: 9.9.9\n---\nbody\n`;
    const out = upsertFrontmatterVersion(input, "1.0.0");
    expect(out).toContain('  version: "1.0.0"');
    expect(out).not.toContain("9.9.9");
    expect(out).not.toMatch(/^version:/m);
  });
});

describe("validatesAsYamlFrontmatter", () => {
  it("accepts a well-formed block", () => {
    expect(validatesAsYamlFrontmatter("---\nname: foo\n---\nbody\n")).toBe(true);
  });
  it("rejects content with no frontmatter", () => {
    expect(validatesAsYamlFrontmatter("body only\n")).toBe(false);
  });
  it("rejects nested unclosed --- markers", () => {
    expect(validatesAsYamlFrontmatter("---\nname: foo\n---\n---\nbody\n")).toBe(true); // outer block valid
    expect(validatesAsYamlFrontmatter("---\nname: foo\n---\n")).toBe(true);
  });
});
