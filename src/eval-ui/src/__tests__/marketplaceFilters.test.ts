import { describe, it, expect } from "vitest";
import {
  filterMarketplaces,
  filterMarketplacePlugins,
} from "../components/marketplaceFilters";
import type {
  MarketplacePlugin,
  MarketplaceSummary,
} from "../components/MarketplaceDrawer";

const summaries: MarketplaceSummary[] = [
  { name: "claude-plugins-official", source: "GitHub (anthropics/claude-plugins-official)" },
  { name: "specweave", source: "Directory (/Users/x/.nvm/.../specweave)" },
  { name: "openai-codex", source: "GitHub (openai/codex-plugin-cc)" },
  { name: "obsidian-skills", source: "GitHub (kepano/obsidian-skills)" },
];

const plugins: MarketplacePlugin[] = [
  { name: "typescript-lsp", description: "TypeScript/JavaScript language server", version: "1.0.0", category: "development", author: "anthropic" },
  { name: "pyright-lsp", description: "Python language server (Pyright)", version: "1.0.0", category: "development", author: "anthropic" },
  { name: "csharp-lsp", description: "C# language server", version: "1.0.0", category: "development", author: "anthropic" },
  { name: "marketing-emails", description: "Email automation", version: "0.2.0", category: "marketing", author: "growth" },
];

describe("filterMarketplaces", () => {
  it("returns the full list when query is empty or whitespace", () => {
    expect(filterMarketplaces(summaries, "")).toEqual(summaries);
    expect(filterMarketplaces(summaries, "   ")).toEqual(summaries);
  });

  it("matches by marketplace name (case-insensitive substring)", () => {
    const got = filterMarketplaces(summaries, "Claude");
    expect(got.map((m) => m.name)).toEqual(["claude-plugins-official"]);
  });

  it("matches by source field too (so users can search by repo path)", () => {
    const got = filterMarketplaces(summaries, "kepano");
    expect(got.map((m) => m.name)).toEqual(["obsidian-skills"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterMarketplaces(summaries, "no-such-thing")).toEqual([]);
  });
});

describe("filterMarketplacePlugins", () => {
  it("returns the full list when query is empty or whitespace", () => {
    expect(filterMarketplacePlugins(plugins, "")).toEqual(plugins);
    expect(filterMarketplacePlugins(plugins, "  ")).toEqual(plugins);
  });

  it("matches by plugin name (case-insensitive)", () => {
    const got = filterMarketplacePlugins(plugins, "PYRIGHT");
    expect(got.map((p) => p.name)).toEqual(["pyright-lsp"]);
  });

  it("matches by description", () => {
    const got = filterMarketplacePlugins(plugins, "python");
    expect(got.map((p) => p.name)).toEqual(["pyright-lsp"]);
  });

  it("matches by category", () => {
    const got = filterMarketplacePlugins(plugins, "marketing");
    expect(got.map((p) => p.name)).toEqual(["marketing-emails"]);
  });

  it("matches by author", () => {
    const got = filterMarketplacePlugins(plugins, "growth");
    expect(got.map((p) => p.name)).toEqual(["marketing-emails"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterMarketplacePlugins(plugins, "nonexistent")).toEqual([]);
  });
});
