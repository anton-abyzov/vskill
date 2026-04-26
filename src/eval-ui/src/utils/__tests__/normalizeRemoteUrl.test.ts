// ---------------------------------------------------------------------------
// 0759 — normalizeRemoteUrl tests.
//
// The studio Publish flow needs to turn `git remote get-url origin` output
// (which can be SSH or HTTPS, with or without `.git` suffix) into a canonical
// HTTPS URL suitable for verified-skill.com/submit?repo=<encoded>.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { normalizeRemoteUrl, buildSubmitUrlFromRemote as buildSubmitUrl } from "../normalizeRemoteUrl";

describe("normalizeRemoteUrl", () => {
  it("normalizes SSH form to HTTPS without .git suffix", () => {
    expect(normalizeRemoteUrl("git@github.com:owner/repo.git")).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("strips .git suffix from HTTPS URLs", () => {
    expect(normalizeRemoteUrl("https://github.com/owner/repo.git")).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("leaves HTTPS without .git suffix unchanged", () => {
    expect(normalizeRemoteUrl("https://github.com/owner/repo")).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("trims surrounding whitespace and trailing newlines", () => {
    expect(normalizeRemoteUrl("  https://github.com/owner/repo.git\n")).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("throws on empty input", () => {
    expect(() => normalizeRemoteUrl("")).toThrow();
  });

  it("throws on unrecognized non-github format", () => {
    expect(() => normalizeRemoteUrl("ssh://custom-host/repo")).toThrow();
  });
});

describe("buildSubmitUrl", () => {
  it("constructs the verified-skill.com submit URL with encoded repo", () => {
    expect(buildSubmitUrl("git@github.com:owner/repo.git")).toBe(
      "https://verified-skill.com/submit?repo=https%3A%2F%2Fgithub.com%2Fowner%2Frepo",
    );
  });

  it("uses the same canonical form for HTTPS input", () => {
    expect(buildSubmitUrl("https://github.com/owner/repo.git")).toBe(
      "https://verified-skill.com/submit?repo=https%3A%2F%2Fgithub.com%2Fowner%2Frepo",
    );
  });
});
