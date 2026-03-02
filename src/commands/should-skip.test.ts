import { describe, it, expect } from "vitest";
import { shouldSkipFromCommands } from "./add.js";

describe("shouldSkipFromCommands", () => {
  describe("files that SHOULD be skipped", () => {
    it("skips root PLUGIN.md", () => {
      expect(shouldSkipFromCommands("PLUGIN.md")).toBe(true);
    });

    it("skips README.md at any level", () => {
      expect(shouldSkipFromCommands("README.md")).toBe(true);
      expect(shouldSkipFromCommands("skills/team-lead/README.md")).toBe(true);
    });

    it("skips FRESHNESS.md", () => {
      expect(shouldSkipFromCommands("FRESHNESS.md")).toBe(true);
    });

    it("skips files in hidden directories", () => {
      expect(shouldSkipFromCommands(".github/workflows/ci.md")).toBe(true);
      expect(shouldSkipFromCommands(".internal/notes.md")).toBe(true);
    });

    it("skips files in internal root directories", () => {
      expect(shouldSkipFromCommands("knowledge-base/guide.md")).toBe(true);
      expect(shouldSkipFromCommands("lib/utils.md")).toBe(true);
      expect(shouldSkipFromCommands("templates/default.md")).toBe(true);
      expect(shouldSkipFromCommands("scripts/setup.md")).toBe(true);
      expect(shouldSkipFromCommands("hooks/post-install.md")).toBe(true);
    });

    it("skips non-SKILL.md files inside skills/ subdirectories", () => {
      expect(shouldSkipFromCommands("skills/team-lead/CHANGELOG.md")).toBe(true);
      expect(shouldSkipFromCommands("skills/team-lead/docs/guide.md")).toBe(true);
    });
  });

  describe("files that should NOT be skipped (allowed through)", () => {
    it("allows agents/*.md files inside skill directories", () => {
      expect(shouldSkipFromCommands("skills/team-lead/agents/frontend.md")).toBe(false);
      expect(shouldSkipFromCommands("skills/team-lead/agents/backend.md")).toBe(false);
      expect(shouldSkipFromCommands("skills/team-lead/agents/database.md")).toBe(false);
      expect(shouldSkipFromCommands("skills/team-lead/agents/testing.md")).toBe(false);
      expect(shouldSkipFromCommands("skills/team-lead/agents/security.md")).toBe(false);
    });

    it("allows SKILL.md inside skills/ subdirectories", () => {
      expect(shouldSkipFromCommands("skills/team-lead/SKILL.md")).toBe(false);
      expect(shouldSkipFromCommands("skills/architect/SKILL.md")).toBe(false);
    });

    it("allows root-level command .md files", () => {
      expect(shouldSkipFromCommands("commands/commit/SKILL.md")).toBe(false);
    });

    it("allows non-.md files (returns false, not filtered)", () => {
      expect(shouldSkipFromCommands("skills/team-lead/config.json")).toBe(false);
      expect(shouldSkipFromCommands("lib/utils.ts")).toBe(false);
    });

    it("handles backslash paths (Windows normalization)", () => {
      expect(shouldSkipFromCommands("skills\\team-lead\\agents\\frontend.md")).toBe(false);
      expect(shouldSkipFromCommands("skills\\team-lead\\CHANGELOG.md")).toBe(true);
    });
  });
});
