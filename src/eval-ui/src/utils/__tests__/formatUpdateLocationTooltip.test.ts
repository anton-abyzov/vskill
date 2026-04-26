// ---------------------------------------------------------------------------
// 0747 T-005: formatUpdateLocationTooltip — pure-function tooltip text builder
// for the inline Update button in the bell dropdown. Surfaces (a) what's about
// to be updated and (b) any caveats (pinned, plugin-bundled).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type { InstallLocation } from "../../api";
import { formatUpdateLocationTooltip } from "../formatUpdateLocationTooltip";

const claudeProject: InstallLocation = {
  scope: "project",
  agent: "claude-code",
  agentLabel: "Claude Code",
  dir: "/p/.claude/skills/foo",
  symlinked: false,
  readonly: false,
};

const claudePersonal: InstallLocation = {
  scope: "personal",
  agent: "claude-code",
  agentLabel: "Claude Code",
  dir: "/h/.claude/skills/foo",
  symlinked: false,
  readonly: false,
};

const codexPersonal: InstallLocation = {
  scope: "personal",
  agent: "codex",
  agentLabel: "Codex CLI",
  dir: "/h/.codex/skills/foo",
  symlinked: false,
  readonly: false,
};

const pluginReadonly: InstallLocation = {
  scope: "plugin",
  agent: "claude-code",
  agentLabel: "Claude Code",
  dir: "/h/.claude/plugins/cache/m/mobile/1.0.0/skills/foo",
  pluginSlug: "mobile",
  pluginMarketplace: "anthropic-skills",
  symlinked: false,
  readonly: true,
};

describe("formatUpdateLocationTooltip", () => {
  it("TC-001: 0 locations → defensive copy with click-to-view hint", () => {
    expect(formatUpdateLocationTooltip([])).toBe(
      "No tracked install — click to view details",
    );
  });

  it("TC-002: 1 project location, single agent", () => {
    expect(formatUpdateLocationTooltip([claudeProject])).toBe(
      "Updates 1 location: project (Claude Code)",
    );
  });

  it("TC-003: N>1 mixed scope, mixed agents", () => {
    expect(
      formatUpdateLocationTooltip([claudeProject, claudePersonal, codexPersonal]),
    ).toBe(
      "Updates 3 locations: project + personal (Claude Code, Codex CLI)",
    );
  });

  it("TC-004: pinned globally → suffix '— pinned (skipped)'", () => {
    expect(
      formatUpdateLocationTooltip([claudeProject, claudePersonal], { pinned: true }),
    ).toBe(
      "Updates 2 locations: project + personal (Claude Code) — pinned (skipped)",
    );
  });

  it("TC-005: includes a plugin readonly → handled separately note", () => {
    expect(
      formatUpdateLocationTooltip([claudeProject, pluginReadonly]),
    ).toBe(
      "Updates 1 location: project (Claude Code) — 1 from plugin mobile (handled separately)",
    );
  });

  it("TC-006: ALL locations are plugin-bundled → 'Plugin-bundled — Update via plugin to refresh'", () => {
    expect(formatUpdateLocationTooltip([pluginReadonly])).toBe(
      "Plugin-bundled — Update via plugin to refresh",
    );
  });

  it("TC-007: same agent appears in multiple scopes → agent listed once", () => {
    expect(formatUpdateLocationTooltip([claudeProject, claudePersonal])).toBe(
      "Updates 2 locations: project + personal (Claude Code)",
    );
  });

  it("TC-008: unique agents stay in registration order (stable)", () => {
    // Claude Code first, then Codex CLI — alphabetical agent label order is the contract.
    expect(formatUpdateLocationTooltip([codexPersonal, claudePersonal])).toBe(
      "Updates 2 locations: personal (Claude Code, Codex CLI)",
    );
  });
});
