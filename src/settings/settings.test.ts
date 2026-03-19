import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------
const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// ---------------------------------------------------------------------------
// Mock node:os (homedir)
// ---------------------------------------------------------------------------
vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

// Import after mocks are set up
const {
  isPluginEnabled,
  listEnabledPlugins,
  purgeStalePlugins,
} = await import("./settings.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("isPluginEnabled", () => {
  it("returns true when plugin is enabled", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enabledPlugins: { "frontend@vskill": true },
      })
    );

    expect(
      isPluginEnabled("frontend@vskill", { scope: "user" })
    ).toBe(true);
  });

  it("returns false when settings.json does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    expect(
      isPluginEnabled("frontend@vskill", { scope: "user" })
    ).toBe(false);
  });

  it("returns false when plugin is not in settings", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ enabledPlugins: {} })
    );

    expect(
      isPluginEnabled("frontend@vskill", { scope: "user" })
    ).toBe(false);
  });
});

describe("listEnabledPlugins", () => {
  it("returns empty array when no settings exist", () => {
    mockExistsSync.mockReturnValue(false);

    expect(listEnabledPlugins({ scope: "user" })).toEqual([]);
  });

  it("returns only enabled (true) plugin IDs, filtering out disabled ones", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enabledPlugins: {
          "frontend@vskill": true,
          "backend@vskill": false,
          "testing@vskill": true,
        },
      })
    );

    const result = listEnabledPlugins({ scope: "user" });
    expect(result).toEqual(["frontend@vskill", "testing@vskill"]);
  });
});

describe("purgeStalePlugins", () => {
  it("returns stale entries not found in lockfile", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enabledPlugins: {
          "frontend@vskill": true,
          "ghost@vskill": true,
        },
      })
    );

    const stale = purgeStalePlugins({ scope: "user" }, {
      frontend: { marketplace: "vskill" },
    });

    expect(stale).toEqual(["ghost@vskill"]);
  });

  it("returns empty array when all entries match lockfile", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enabledPlugins: {
          "frontend@vskill": true,
          "backend@vskill": false,
        },
      })
    );

    const stale = purgeStalePlugins({ scope: "user" }, {
      frontend: { marketplace: "vskill" },
      backend: { marketplace: "vskill" },
    });

    expect(stale).toEqual([]);
  });

  it("returns empty array when no enabledPlugins exist", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({}));

    const stale = purgeStalePlugins({ scope: "user" }, {
      frontend: { marketplace: "vskill" },
    });

    expect(stale).toEqual([]);
  });

  it("does not flag entries without @ separator (non-marketplace entries)", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enabledPlugins: {
          "local-only": true,
          "ghost@vskill": true,
        },
      })
    );

    const stale = purgeStalePlugins({ scope: "user" }, {});

    expect(stale).toEqual(["ghost@vskill"]);
  });

  it("only reads, never writes — callers are responsible for CLI uninstall", () => {
    // settings.ts no longer imports writeFileSync at all; this test confirms
    // purgeStalePlugins is a pure read that returns IDs without side effects.
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enabledPlugins: { "ghost@vskill": true },
      })
    );

    const stale = purgeStalePlugins({ scope: "user" }, {});

    expect(stale).toEqual(["ghost@vskill"]);
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });
});
