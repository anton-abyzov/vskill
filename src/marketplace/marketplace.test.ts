import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Import module under test
// We import from the index barrel to test the public API
// ---------------------------------------------------------------------------
const {
  getAvailablePlugins,
  getPluginSource,
  getPluginVersion,
  getMarketplaceName,
} = await import("./index.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMarketplaceJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: "specweave",
    version: "1.0.225",
    plugins: [
      { name: "sw", source: "./plugins/specweave", version: "1.0.225" },
      { name: "sw-frontend", source: "./plugins/specweave-frontend", version: "1.0.0" },
    ],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("marketplace.json parser", () => {
  // TC-005: Parse marketplace.json returns plugin entries
  describe("TC-005: getAvailablePlugins", () => {
    it("returns array of plugin entries from valid marketplace.json", () => {
      const content = makeMarketplaceJson();
      const plugins = getAvailablePlugins(content);

      expect(plugins).toHaveLength(2);
      expect(plugins[0]).toEqual({
        name: "sw",
        source: "./plugins/specweave",
        version: "1.0.225",
      });
      expect(plugins[1]).toEqual({
        name: "sw-frontend",
        source: "./plugins/specweave-frontend",
        version: "1.0.0",
      });
    });

    it("returns each plugin with name, source, and version fields", () => {
      const content = makeMarketplaceJson();
      const plugins = getAvailablePlugins(content);

      for (const plugin of plugins) {
        expect(plugin).toHaveProperty("name");
        expect(plugin).toHaveProperty("source");
        expect(plugin).toHaveProperty("version");
        expect(typeof plugin.name).toBe("string");
        expect(typeof plugin.source).toBe("string");
        expect(typeof plugin.version).toBe("string");
      }
    });

    it("returns empty array for JSON with no plugins", () => {
      const content = JSON.stringify({ name: "empty", version: "1.0.0", plugins: [] });
      const plugins = getAvailablePlugins(content);

      expect(plugins).toEqual([]);
    });

    it("returns empty array for invalid JSON", () => {
      const plugins = getAvailablePlugins("not valid json {{{");

      expect(plugins).toEqual([]);
    });
  });

  // TC-006: Plugin source mapping resolves paths
  describe("TC-006: getPluginSource", () => {
    it("returns source path for a known plugin name", () => {
      const content = makeMarketplaceJson();
      const source = getPluginSource("sw-frontend", content);

      expect(source).toBe("./plugins/specweave-frontend");
    });

    it("returns source path for 'sw' plugin", () => {
      const content = makeMarketplaceJson();
      const source = getPluginSource("sw", content);

      expect(source).toBe("./plugins/specweave");
    });
  });

  // TC-007: Unknown plugin returns null
  describe("TC-007: getPluginSource with unknown plugin", () => {
    it("returns null for a plugin name not in marketplace.json", () => {
      const content = makeMarketplaceJson();
      const source = getPluginSource("sw-nonexistent", content);

      expect(source).toBeNull();
    });

    it("returns null for invalid JSON content", () => {
      const source = getPluginSource("sw", "broken json");

      expect(source).toBeNull();
    });
  });

  // Bonus: getPluginVersion
  describe("getPluginVersion", () => {
    it("returns version for a known plugin", () => {
      const content = makeMarketplaceJson();
      const version = getPluginVersion("sw-frontend", content);

      expect(version).toBe("1.0.0");
    });

    it("returns null for unknown plugin", () => {
      const content = makeMarketplaceJson();
      const version = getPluginVersion("sw-nonexistent", content);

      expect(version).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getMarketplaceName
  // ---------------------------------------------------------------------------
  describe("getMarketplaceName", () => {
    it("returns the top-level name from valid marketplace.json", () => {
      const content = makeMarketplaceJson();
      expect(getMarketplaceName(content)).toBe("specweave");
    });

    it("returns null for invalid JSON", () => {
      expect(getMarketplaceName("not json")).toBeNull();
    });

    it("returns null when name field is missing", () => {
      expect(getMarketplaceName('{"plugins": []}')).toBeNull();
    });

    it("returns null when name field is empty string", () => {
      expect(getMarketplaceName('{"name": "", "plugins": []}')).toBeNull();
    });
  });
});
