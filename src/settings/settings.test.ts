import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

// ---------------------------------------------------------------------------
// Mock node:os (homedir)
// ---------------------------------------------------------------------------
vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

// Import after mocks are set up
const { enablePlugin, disablePlugin, isPluginEnabled } = await import(
  "./settings.js"
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("enablePlugin", () => {
  it("TC-010: enables plugin in empty/new settings.json", () => {
    // settings.json doesn't exist
    mockExistsSync.mockReturnValue(false);

    enablePlugin("frontend@vskill", { scope: "user" });

    // Should write to ~/.claude/settings.json
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [writePath, writtenContent] = mockWriteFileSync.mock.calls[0];
    expect(writePath).toBe("/home/testuser/.claude/settings.json");

    const parsed = JSON.parse(writtenContent);
    expect(parsed).toEqual({
      enabledPlugins: { "frontend@vskill": true },
    });
  });

  it("TC-011: project scope writes to correct location", () => {
    mockExistsSync.mockReturnValue(false);

    enablePlugin("frontend@vskill", {
      scope: "project",
      projectDir: "/tmp/test-project",
    });

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [writePath] = mockWriteFileSync.mock.calls[0];
    expect(writePath).toBe("/tmp/test-project/.claude/settings.json");
  });

  it("TC-012: preserves existing settings when adding plugin", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        theme: "dark",
        enabledPlugins: { other: true },
      })
    );

    enablePlugin("frontend@vskill", { scope: "user" });

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [, writtenContent] = mockWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(writtenContent);
    expect(parsed).toEqual({
      theme: "dark",
      enabledPlugins: {
        other: true,
        "frontend@vskill": true,
      },
    });
  });
});

describe("disablePlugin", () => {
  it("sets plugin to false in settings.json", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enabledPlugins: { "frontend@vskill": true },
      })
    );

    disablePlugin("frontend@vskill", { scope: "user" });

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [, writtenContent] = mockWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.enabledPlugins["frontend@vskill"]).toBe(false);
  });
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
