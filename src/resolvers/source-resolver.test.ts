import { describe, it, expect } from "vitest";
import { parseSource } from "./source-resolver.js";

describe("parseSource", () => {
  // registry: prefix
  it("parses registry: prefix", () => {
    expect(parseSource("registry:architect")).toEqual({
      type: "registry",
      skillName: "architect",
    });
  });

  it("parses registry: with empty name", () => {
    expect(parseSource("registry:")).toEqual({
      type: "registry",
      skillName: "",
    });
  });

  // local: prefix
  it("parses local: prefix", () => {
    expect(parseSource("local:specweave")).toEqual({
      type: "local",
      baseName: "specweave",
    });
  });

  it("parses local: with path", () => {
    expect(parseSource("local:/abs/path/to/plugin")).toEqual({
      type: "local",
      baseName: "/abs/path/to/plugin",
    });
  });

  // marketplace: prefix
  it("parses marketplace: prefix", () => {
    expect(parseSource("marketplace:anton-abyzov/specweave#sw")).toEqual({
      type: "marketplace",
      owner: "anton-abyzov",
      repo: "specweave",
      pluginName: "sw",
    });
  });

  it("parses marketplace: with hyphenated plugin name", () => {
    expect(parseSource("marketplace:org/repo#my-plugin")).toEqual({
      type: "marketplace",
      owner: "org",
      repo: "repo",
      pluginName: "my-plugin",
    });
  });

  // github: flat (no fragment)
  it("parses github: flat repo", () => {
    expect(parseSource("github:coreyhaines31/marketingskills")).toEqual({
      type: "github",
      owner: "coreyhaines31",
      repo: "marketingskills",
    });
  });

  // github: with #plugin: fragment
  it("parses github: with #plugin: fragment", () => {
    expect(parseSource("github:anton-abyzov/vskill#plugin:frontend")).toEqual({
      type: "github-plugin",
      owner: "anton-abyzov",
      repo: "vskill",
      pluginName: "frontend",
    });
  });

  it("parses github: with #plugin: fragment for nested plugin name", () => {
    expect(parseSource("github:org/repo#plugin:my-plugin")).toEqual({
      type: "github-plugin",
      owner: "org",
      repo: "repo",
      pluginName: "my-plugin",
    });
  });

  // unknown / fallback cases
  it("returns unknown for empty string", () => {
    expect(parseSource("")).toEqual({
      type: "unknown",
      raw: "",
    });
  });

  it("returns unknown for unrecognized prefix", () => {
    expect(parseSource("npm:some-package")).toEqual({
      type: "unknown",
      raw: "npm:some-package",
    });
  });

  it("returns unknown for garbage string", () => {
    expect(parseSource("garbage-string")).toEqual({
      type: "unknown",
      raw: "garbage-string",
    });
  });

  it("returns unknown for marketplace: without #", () => {
    expect(parseSource("marketplace:owner/repo")).toEqual({
      type: "unknown",
      raw: "marketplace:owner/repo",
    });
  });

  it("returns unknown for github: without slash", () => {
    expect(parseSource("github:noslash")).toEqual({
      type: "unknown",
      raw: "github:noslash",
    });
  });
});
