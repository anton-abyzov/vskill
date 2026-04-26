import { describe, it, expect } from "vitest";
import { setFrontmatterVersion, getFrontmatterVersion } from "../setFrontmatterVersion";

describe("setFrontmatterVersion", () => {
  it("replaces an existing quoted version line", () => {
    const input = `---
version: "1.0.5"
name: greet-anton
---
# body`;
    expect(setFrontmatterVersion(input, "1.0.6")).toBe(`---
version: "1.0.6"
name: greet-anton
---
# body`);
  });

  it("replaces an unquoted version line", () => {
    const input = `---
version: 1.0.5
name: x
---`;
    expect(setFrontmatterVersion(input, "1.1.0")).toBe(`---
version: "1.1.0"
name: x
---`);
  });

  it("inserts a version line when missing from existing frontmatter", () => {
    const input = `---
name: x
description: y
---
body here`;
    const out = setFrontmatterVersion(input, "1.0.0");
    expect(out).toMatch(/^---\nversion: "1\.0\.0"\nname: x/);
    expect(out).toContain("body here");
  });

  it("creates a new frontmatter block when none exists", () => {
    const input = `# Just a markdown body\n\nNo frontmatter at all.`;
    const out = setFrontmatterVersion(input, "1.0.0");
    expect(out.startsWith("---\nversion: \"1.0.0\"\n---\n")).toBe(true);
    expect(out).toContain("Just a markdown body");
  });

  it("is idempotent: same version → same content", () => {
    const input = `---
version: "1.0.5"
---
body`;
    expect(setFrontmatterVersion(input, "1.0.5")).toBe(input);
  });

  it("preserves trailing content after the closing fence", () => {
    const input = `---
version: "1.0.0"
---
# Header
body line`;
    expect(setFrontmatterVersion(input, "1.0.1")).toContain("# Header\nbody line");
  });
});

describe("getFrontmatterVersion", () => {
  it("returns the current version (quoted)", () => {
    expect(getFrontmatterVersion(`---
version: "1.2.3"
---`)).toBe("1.2.3");
  });

  it("returns the current version (unquoted)", () => {
    expect(getFrontmatterVersion(`---
version: 1.2.3
---`)).toBe("1.2.3");
  });

  it("returns null when no frontmatter exists", () => {
    expect(getFrontmatterVersion("# no frontmatter")).toBeNull();
  });

  it("returns null when frontmatter has no version line", () => {
    expect(getFrontmatterVersion(`---
name: x
---`)).toBeNull();
  });
});
