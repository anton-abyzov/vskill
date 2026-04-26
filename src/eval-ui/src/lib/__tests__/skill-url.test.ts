// 0741 T-005: I/O contract test for the ported skill-url helper.
import { describe, it, expect } from "vitest";
import { skillUrl, skillApiPath, skillFullUrl } from "../skill-url";

describe("skillUrl (ported from vskill-platform)", () => {
  it("builds a hierarchical /skills/<owner>/<repo>/<skill> path", () => {
    expect(skillUrl("anton-abyzov/vskill/architect")).toBe(
      "/skills/anton-abyzov/vskill/architect",
    );
  });

  it("falls back to flat /skills/<name> for legacy single-segment names", () => {
    expect(skillUrl("architect")).toBe("/skills/architect");
  });

  it("encodes URI-unsafe characters in segments", () => {
    expect(skillUrl("foo bar/repo/slug")).toBe("/skills/foo%20bar/repo/slug");
  });
});

describe("skillApiPath (ported)", () => {
  it("builds /api/v1/skills/<owner>/<repo>/<skill>", () => {
    expect(skillApiPath("anton-abyzov/vskill/architect")).toBe(
      "/api/v1/skills/anton-abyzov/vskill/architect",
    );
  });

  it("appends suffixes (e.g. versions, badge)", () => {
    expect(skillApiPath("anton-abyzov/vskill/architect", "versions")).toBe(
      "/api/v1/skills/anton-abyzov/vskill/architect/versions",
    );
    expect(skillApiPath("anton-abyzov/vskill/architect", "badge")).toBe(
      "/api/v1/skills/anton-abyzov/vskill/architect/badge",
    );
  });
});

describe("skillFullUrl (ported)", () => {
  it("prepends the verified-skill.com base by default", () => {
    expect(skillFullUrl("anton-abyzov/vskill/architect")).toBe(
      "https://verified-skill.com/skills/anton-abyzov/vskill/architect",
    );
  });

  it("accepts a custom base URL (e.g. for local dev)", () => {
    expect(
      skillFullUrl("anton-abyzov/vskill/architect", "http://localhost:3017"),
    ).toBe(
      "http://localhost:3017/skills/anton-abyzov/vskill/architect",
    );
  });
});
