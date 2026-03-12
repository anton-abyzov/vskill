import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted for ESM compatibility
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(),
  findProjectRoot: vi.fn(),
  processExit: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mocks.existsSync(...args),
  readFileSync: (...args: unknown[]) => mocks.readFileSync(...args),
  writeFileSync: (...args: unknown[]) => mocks.writeFileSync(...args),
  readdirSync: (...args: unknown[]) => mocks.readdirSync(...args),
}));

vi.mock("../utils/project-root.js", () => ({
  findProjectRoot: (...args: unknown[]) => mocks.findProjectRoot(...args),
}));

vi.mock("../utils/output.js", () => ({
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
  spinner: (_msg: string) => ({ stop: (_final?: string) => {} }),
  table: (headers: string[], rows: string[][]) => {
    return [headers.join("  "), ...rows.map((r: string[]) => r.join("  "))].join("\n");
  },
}));

// Capture process.exit calls without terminating the test runner
const originalExit = process.exit;
beforeEach(() => {
  process.exit = mocks.processExit as unknown as typeof process.exit;
});

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------
const { marketplaceCommand } = await import("./marketplace.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMarketplaceJson(plugins: object[] = []): string {
  return JSON.stringify({
    name: "vskill",
    owner: { name: "Test Author" },
    plugins: [
      { name: "mobile", source: "./plugins/mobile", version: "2.3.0" },
      ...plugins,
    ],
  });
}

function makeDirEntry(name: string, isDir = true) {
  return { name, isDirectory: () => isDir };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("marketplaceCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProjectRoot.mockReturnValue("/fake/root");
    process.exit = mocks.processExit as unknown as typeof process.exit;
  });

  it("writes updated marketplace.json when a new plugin is found", async () => {
    mocks.existsSync.mockImplementation((p: string) => {
      if (p.endsWith("marketplace.json")) return true;
      if (p.endsWith("plugins")) return true;
      if (p.endsWith("plugin.json")) return true;
      return false;
    });
    mocks.readdirSync.mockReturnValue([makeDirEntry("newplugin")]);
    mocks.readFileSync.mockImplementation((p: string) => {
      if (String(p).endsWith("marketplace.json")) return makeMarketplaceJson();
      // plugin.json for newplugin
      return JSON.stringify({ name: "newplugin", description: "New one", version: "1.0.0" });
    });

    await marketplaceCommand("sync", {});

    expect(mocks.writeFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse(mocks.writeFileSync.mock.calls[0][1] as string);
    expect(written.plugins.map((p: { name: string }) => p.name)).toContain("newplugin");
  });

  it("does NOT write marketplace.json in --dry-run mode", async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readdirSync.mockReturnValue([makeDirEntry("newplugin")]);
    mocks.readFileSync.mockImplementation((p: string) => {
      if (String(p).endsWith("marketplace.json")) return makeMarketplaceJson();
      return JSON.stringify({ name: "newplugin", version: "1.0.0" });
    });

    await marketplaceCommand("sync", { dryRun: true });

    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("skips a plugin dir that has no plugin.json and continues", async () => {
    mocks.existsSync.mockImplementation((p: string) => {
      if (p.endsWith("marketplace.json")) return true;
      if (p.endsWith("plugins")) return true;
      // plugin.json does not exist
      if (p.endsWith("plugin.json")) return false;
      return false;
    });
    mocks.readdirSync.mockReturnValue([makeDirEntry("orphan")]);
    mocks.readFileSync.mockReturnValue(makeMarketplaceJson());

    // Should not throw
    await marketplaceCommand("sync", {});

    // writeFileSync should NOT be called since nothing changed
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("exits 1 when marketplace.json is not found", async () => {
    mocks.existsSync.mockReturnValue(false);

    await marketplaceCommand("sync", {});

    expect(mocks.processExit).toHaveBeenCalledWith(1);
  });

  it("exits 1 for unknown subcommand", async () => {
    await marketplaceCommand("unknown-cmd", {});

    expect(mocks.processExit).toHaveBeenCalledWith(1);
  });
});
