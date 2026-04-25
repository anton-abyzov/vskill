// ---------------------------------------------------------------------------
// 0729 — buildSubmitUrl helper
//
// Generates the verified-skill.com submission URL for the "Versions" tab CTA
// shown to authors of local-only skills (origin === "source" + empty version
// history).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { buildSubmitUrl } from "../submit-url";

describe("0729 — buildSubmitUrl", () => {
  it("AC-US1-03: returns the bare /submit URL when no repoUrl is provided", () => {
    expect(buildSubmitUrl()).toBe("https://verified-skill.com/submit");
    expect(buildSubmitUrl(undefined)).toBe("https://verified-skill.com/submit");
    expect(buildSubmitUrl(null)).toBe("https://verified-skill.com/submit");
    expect(buildSubmitUrl("")).toBe("https://verified-skill.com/submit");
    expect(buildSubmitUrl("   ")).toBe("https://verified-skill.com/submit");
  });

  it("AC-US1-03: appends a properly URL-encoded ?repo= for valid GitHub URLs", () => {
    const result = buildSubmitUrl("https://github.com/anton-abyzov/vskill");
    expect(result).toBe(
      "https://verified-skill.com/submit?repo=https%3A%2F%2Fgithub.com%2Fanton-abyzov%2Fvskill",
    );
  });

  it("AC-US1-03: handles GitHub URLs with extra path segments (e.g. /tree/main/skills)", () => {
    const result = buildSubmitUrl("https://github.com/anton-abyzov/vskill/tree/main/skills/greet-anton");
    expect(result).toContain("repo=");
    expect(result).toContain("https%3A%2F%2Fgithub.com%2Fanton-abyzov%2Fvskill");
  });

  it("AC-US1-03: returns bare /submit for non-GitHub URLs (defensive)", () => {
    expect(buildSubmitUrl("https://gitlab.com/foo/bar")).toBe(
      "https://verified-skill.com/submit",
    );
    expect(buildSubmitUrl("http://github.com/foo/bar")).toBe(
      "https://verified-skill.com/submit",
    );
    expect(buildSubmitUrl("ssh://git@github.com/foo/bar")).toBe(
      "https://verified-skill.com/submit",
    );
  });

  it("AC-US1-03: returns bare /submit when the URL embeds credentials", () => {
    expect(buildSubmitUrl("https://user:token@github.com/foo/bar")).toBe(
      "https://verified-skill.com/submit",
    );
  });

  it("AC-US1-03: trims whitespace before validating", () => {
    expect(buildSubmitUrl("  https://github.com/foo/bar  ")).toBe(
      "https://verified-skill.com/submit?repo=https%3A%2F%2Fgithub.com%2Ffoo%2Fbar",
    );
  });
});
