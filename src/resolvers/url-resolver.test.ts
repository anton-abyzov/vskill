// ---------------------------------------------------------------------------
// Tests for URL resolver (T-010)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parseSkillsShUrl } from "./url-resolver.js";

describe("parseSkillsShUrl", () => {
  it("TC-033: parses full skills.sh URL correctly", () => {
    const result = parseSkillsShUrl(
      "https://skills.sh/softaworks/agent-toolkit/humanizer"
    );
    expect(result).toEqual({
      owner: "softaworks",
      toolkit: "agent-toolkit",
      skill: "humanizer",
    });
  });

  it("TC-034: returns null for non-skills.sh URL", () => {
    const result = parseSkillsShUrl("https://github.com/user/repo");
    expect(result).toBeNull();
  });

  it("returns null for non-URL input", () => {
    const result = parseSkillsShUrl("some-skill-name");
    expect(result).toBeNull();
  });

  it("handles trailing slash", () => {
    const result = parseSkillsShUrl(
      "https://skills.sh/owner/toolkit/skill/"
    );
    expect(result).toEqual({
      owner: "owner",
      toolkit: "toolkit",
      skill: "skill",
    });
  });

  it("TC-035: incomplete path (2 segments) returns incomplete marker", () => {
    const result = parseSkillsShUrl(
      "https://skills.sh/softaworks/agent-toolkit"
    );
    // For incomplete paths, returns an object with incomplete flag
    expect(result).toEqual({ incomplete: true });
  });

  it("incomplete path (1 segment) returns incomplete marker", () => {
    const result = parseSkillsShUrl("https://skills.sh/softaworks");
    expect(result).toEqual({ incomplete: true });
  });

  it("handles www.skills.sh", () => {
    const result = parseSkillsShUrl(
      "https://www.skills.sh/owner/toolkit/skill"
    );
    expect(result).toEqual({
      owner: "owner",
      toolkit: "toolkit",
      skill: "skill",
    });
  });
});
