// Tests for 0779: Save default patch bump.
//
// Pure helper that decides what to persist when the user clicks Save:
// - If editor frontmatter version equals last-saved version → bump patch in
//   content before save (default behaviour).
// - Otherwise → respect the editor's content as-is (user already bumped
//   manually via +patch / +minor / +major).
//
// Covers AC-US1-01, AC-US2-01..03, AC-US3-01..03.
import { describe, it, expect } from "vitest";
import { computeSavePayload } from "../computeSavePayload";
import { getFrontmatterVersion } from "../setFrontmatterVersion";

const FM = (version: string, body = "Hello.") =>
  `---\nversion: "${version}"\nname: "skill"\n---\n\n${body}`;

describe("computeSavePayload (0779)", () => {
  it("AC-US1-01 — auto-bumps patch when editor version equals saved version", () => {
    const saved = FM("1.0.2");
    const editor = FM("1.0.2", "Hello, world."); // body changed, version unchanged
    const result = computeSavePayload(editor, saved);
    expect(result.version).toBe("1.0.3");
    expect(getFrontmatterVersion(result.contentToSave)).toBe("1.0.3");
    // body change preserved
    expect(result.contentToSave).toContain("Hello, world.");
  });

  it("AC-US2-02 — respects manual +minor (saved 1.0.2 → editor 1.1.0 → save 1.1.0, NOT 1.1.1)", () => {
    const saved = FM("1.0.2");
    const editor = FM("1.1.0", "Hello.");
    const result = computeSavePayload(editor, saved);
    expect(result.version).toBe("1.1.0");
    expect(getFrontmatterVersion(result.contentToSave)).toBe("1.1.0");
    expect(result.contentToSave).toBe(editor);
  });

  it("AC-US2-03 — respects manual +patch (saved 1.0.2 → editor 1.0.3 → save 1.0.3, NOT 1.0.4)", () => {
    const saved = FM("1.0.2");
    const editor = FM("1.0.3", "Hello.");
    const result = computeSavePayload(editor, saved);
    expect(result.version).toBe("1.0.3");
    expect(getFrontmatterVersion(result.contentToSave)).toBe("1.0.3");
    expect(result.contentToSave).toBe(editor);
  });

  it("respects manual +major (saved 1.0.2 → editor 2.0.0 → save 2.0.0)", () => {
    const saved = FM("1.0.2");
    const editor = FM("2.0.0", "Hello.");
    const result = computeSavePayload(editor, saved);
    expect(result.version).toBe("2.0.0");
    expect(result.contentToSave).toBe(editor);
  });

  it("returns content as-is when saved baseline has no parseable version", () => {
    const saved = "no frontmatter at all";
    const editor = FM("1.0.0", "Hello.");
    const result = computeSavePayload(editor, saved);
    expect(result.version).toBe("1.0.0");
    expect(result.contentToSave).toBe(editor);
  });

  it("returns content as-is when editor has no parseable version", () => {
    const saved = FM("1.0.2");
    const editor = "no frontmatter at all";
    const result = computeSavePayload(editor, saved);
    expect(result.version).toBeNull();
    expect(result.contentToSave).toBe(editor);
  });
});
