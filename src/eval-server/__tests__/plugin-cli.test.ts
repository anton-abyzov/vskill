// ---------------------------------------------------------------------------
// 0700 — plugin-cli parser tests (fixture-driven, no real subprocess).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parseInstalledPlugins, parseMarketplaces } from "../plugin-cli.js";

describe("parseInstalledPlugins (0700)", () => {
  it("parses a single plugin with enabled status", () => {
    const stdout = `Installed plugins:

  ❯ codex@openai-codex
    Version: 1.0.3
    Scope: user
    Status: ✔ enabled
`;
    const plugins = parseInstalledPlugins(stdout);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toEqual({
      name: "codex",
      marketplace: "openai-codex",
      version: "1.0.3",
      scope: "user",
      enabled: true,
    });
  });

  it("parses multiple plugins mixing enabled + disabled", () => {
    const stdout = `Installed plugins:

  ❯ codex@openai-codex
    Version: 1.0.3
    Scope: user
    Status: ✔ enabled

  ❯ figma@claude-plugins-official
    Version: 1.1.0
    Scope: project
    Status: ✘ disabled

  ❯ slack@claude-plugins-official
    Version: 1.0.0
    Scope: project
    Status: ✘ disabled

  ❯ sw@specweave
    Version: 1.0.0
    Scope: project
    Status: ✔ enabled

  ❯ sw@specweave
    Version: 1.0.0
    Scope: user
    Status: ✔ enabled
`;
    const plugins = parseInstalledPlugins(stdout);
    expect(plugins).toHaveLength(5);

    const names = plugins.map((p) => `${p.name}@${p.marketplace}:${p.scope}`);
    expect(names).toEqual([
      "codex@openai-codex:user",
      "figma@claude-plugins-official:project",
      "slack@claude-plugins-official:project",
      "sw@specweave:project",
      "sw@specweave:user",
    ]);

    const enabled = plugins.filter((p) => p.enabled).map((p) => p.name);
    expect(enabled).toEqual(["codex", "sw", "sw"]);

    const disabled = plugins.filter((p) => !p.enabled).map((p) => p.name);
    expect(disabled).toEqual(["figma", "slack"]);
  });

  it("returns [] for empty output", () => {
    expect(parseInstalledPlugins("No installed plugins.")).toEqual([]);
    expect(parseInstalledPlugins("")).toEqual([]);
  });

  it("ignores lines it can't parse (defensive)", () => {
    const stdout = `Installed plugins:

  ❯ codex@openai-codex
    Version: 1.0.3
    Some weird line we don't recognize
    Scope: user
    Status: ✔ enabled

Trailing garbage.
`;
    const plugins = parseInstalledPlugins(stdout);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("codex");
    expect(plugins[0].enabled).toBe(true);
  });

  it("preserves the same plugin installed at multiple scopes as distinct entries", () => {
    const stdout = `Installed plugins:

  ❯ sw@specweave
    Version: 1.0.0
    Scope: project
    Status: ✔ enabled

  ❯ sw@specweave
    Version: 1.0.0
    Scope: user
    Status: ✔ enabled
`;
    const plugins = parseInstalledPlugins(stdout);
    expect(plugins).toHaveLength(2);
    const scopes = plugins.map((p) => p.scope).sort();
    expect(scopes).toEqual(["project", "user"]);
  });
});

describe("parseMarketplaces (0700)", () => {
  it("parses multiple marketplaces with distinct source kinds", () => {
    const stdout = `Configured marketplaces:

  ❯ claude-plugins-official
    Source: GitHub (anthropics/claude-plugins-official)

  ❯ specweave
    Source: Directory (/Users/antonabyzov/.nvm/versions/node/v22.20.0/lib/node_modules/specweave)

  ❯ openai-codex
    Source: GitHub (openai/codex-plugin-cc)
`;
    const markets = parseMarketplaces(stdout);
    expect(markets).toHaveLength(3);
    expect(markets[0].name).toBe("claude-plugins-official");
    expect(markets[0].source).toContain("GitHub");
    expect(markets[1].name).toBe("specweave");
    expect(markets[1].source).toContain("Directory");
  });

  it("returns [] for empty output", () => {
    expect(parseMarketplaces("")).toEqual([]);
    expect(parseMarketplaces("No marketplaces configured.")).toEqual([]);
  });
});
