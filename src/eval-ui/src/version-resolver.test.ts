// Increment 0750 T-001 (RED): unit tests for resolveSkillVersion.
//
// Precedence chain:
//   frontmatter.version  >  registry.currentVersion  >  plugin.json.version  >  "0.0.0"
//
// The resolver is a pure function — no I/O, no caching. Cache for plugin.json
// reads is the responsibility of the scanner that feeds this function.

import { describe, it, expect } from "vitest";
import { resolveSkillVersion } from "./version-resolver.js";

describe("resolveSkillVersion", () => {
  it("TC-001: frontmatter wins over registry and plugin", () => {
    const out = resolveSkillVersion({
      frontmatterVersion: "1.4.0",
      registryCurrentVersion: "1.0.0",
      pluginVersion: "2.3.0",
    });
    expect(out).toEqual({ version: "1.4.0", versionSource: "frontmatter" });
  });

  it("TC-002: registry wins when frontmatter is missing", () => {
    const out = resolveSkillVersion({
      frontmatterVersion: null,
      registryCurrentVersion: "1.0.0",
      pluginVersion: "2.3.0",
    });
    expect(out).toEqual({ version: "1.0.0", versionSource: "registry" });
  });

  it("TC-003: plugin wins when frontmatter and registry are missing", () => {
    const out = resolveSkillVersion({
      frontmatterVersion: null,
      registryCurrentVersion: null,
      pluginVersion: "2.3.0",
    });
    expect(out).toEqual({ version: "2.3.0", versionSource: "plugin" });
  });

  it("TC-004: default fallback when all sources are missing", () => {
    const out = resolveSkillVersion({
      frontmatterVersion: null,
      registryCurrentVersion: null,
      pluginVersion: null,
    });
    expect(out).toEqual({ version: "1.0.0", versionSource: "default" });
  });

  it("TC-005: gws scenario — frontmatter '0.1.0' wins over registry '1.0.0'", () => {
    // Author explicitly chose pre-1.0; registry default must not override.
    const out = resolveSkillVersion({
      frontmatterVersion: "0.1.0",
      registryCurrentVersion: "1.0.0",
      pluginVersion: null,
    });
    expect(out).toEqual({ version: "0.1.0", versionSource: "frontmatter" });
  });

  it("TC-006: invalid semver in frontmatter is ignored, falls through to registry", () => {
    const out = resolveSkillVersion({
      frontmatterVersion: "not-semver",
      registryCurrentVersion: "1.0.0",
      pluginVersion: null,
    });
    expect(out).toEqual({ version: "1.0.0", versionSource: "registry" });
  });

  it("TC-007: empty string treated as absent — falls through to default", () => {
    const out = resolveSkillVersion({
      frontmatterVersion: "",
      registryCurrentVersion: null,
      pluginVersion: null,
    });
    expect(out).toEqual({ version: "1.0.0", versionSource: "default" });
  });

  it("TC-007b: undefined inputs treated as absent (consumer convenience)", () => {
    const out = resolveSkillVersion({});
    expect(out).toEqual({ version: "1.0.0", versionSource: "default" });
  });

  it("TC-007c: invalid semver in plugin field also falls through", () => {
    const out = resolveSkillVersion({
      pluginVersion: "garbage",
    });
    expect(out).toEqual({ version: "1.0.0", versionSource: "default" });
  });

  // 0756: the studio sends "0.0.0" as a placeholder to /api/v1/skills/check-updates
  // when it doesn't yet know the version. The platform echoes that back as
  // `installed`, mergeUpdatesIntoSkills writes it as registryCurrentVersion,
  // and the old resolver accepted "0.0.0" as valid semver — beating the real
  // plugin.json version (1.0.4) and the "1.0.0" default. Treat it as absent.
  it("TC-008: 0.0.0 in registry is rejected as a sentinel — falls through to plugin", () => {
    const out = resolveSkillVersion({
      frontmatterVersion: null,
      registryCurrentVersion: "0.0.0",
      pluginVersion: "1.0.4",
    });
    expect(out).toEqual({ version: "1.0.4", versionSource: "plugin" });
  });

  it("TC-009: 0.0.0 in registry with no plugin version — falls through to default", () => {
    const out = resolveSkillVersion({
      frontmatterVersion: null,
      registryCurrentVersion: "0.0.0",
      pluginVersion: null,
    });
    expect(out).toEqual({ version: "1.0.0", versionSource: "default" });
  });

  it("TC-010: 0.0.0 in frontmatter is also rejected (no real skill ships at 0.0.0)", () => {
    const out = resolveSkillVersion({
      frontmatterVersion: "0.0.0",
      registryCurrentVersion: "1.0.0",
      pluginVersion: null,
    });
    expect(out).toEqual({ version: "1.0.0", versionSource: "registry" });
  });

  it("TC-011: 0.0.0 in plugin field is also rejected", () => {
    const out = resolveSkillVersion({
      frontmatterVersion: null,
      registryCurrentVersion: null,
      pluginVersion: "0.0.0",
    });
    expect(out).toEqual({ version: "1.0.0", versionSource: "default" });
  });
});
