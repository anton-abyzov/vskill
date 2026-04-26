// 0741 T-004: I/O contract test for the ported sanitize-html helper.
// Asserts the same XSS-stripping behavior as vskill-platform/src/lib.
import { describe, it, expect } from "vitest";
import { sanitizeHighlight } from "../sanitize-html";

describe("sanitizeHighlight (ported from vskill-platform)", () => {
  it("returns empty string for empty input", () => {
    expect(sanitizeHighlight("")).toBe("");
  });

  it("preserves <b> and </b> tags from ts_headline output", () => {
    expect(sanitizeHighlight("hello <b>world</b>")).toBe("hello <b>world</b>");
    expect(sanitizeHighlight("<b>obs</b>idian")).toBe("<b>obs</b>idian");
  });

  it("strips tags but keeps text content between them", () => {
    // The regex strips TAGS only, not text. Inner text remains.
    expect(sanitizeHighlight("<script>alert(1)</script>foo")).toBe("alert(1)foo");
    expect(sanitizeHighlight("<a href=evil>click</a>")).toBe("click");
    expect(sanitizeHighlight("<img src=x onerror=alert(1)>bar")).toBe("bar");
  });

  it("preserves <b> tags case-insensitively (matches <B> too)", () => {
    expect(sanitizeHighlight("<B>bold</B>")).toBe("<B>bold</B>");
    expect(sanitizeHighlight("<SCRIPT>x</SCRIPT>safe")).toBe("xsafe");
  });
});
