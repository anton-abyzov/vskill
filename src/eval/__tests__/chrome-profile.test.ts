import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to create mock functions before module loading
const { mockExistsSync, mockReaddirSync, mockPlatform, mockHomedir } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockPlatform: vi.fn(),
  mockHomedir: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: mockExistsSync, readdirSync: mockReaddirSync };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, platform: mockPlatform, homedir: mockHomedir };
});

import { resolveProfile, listProfiles, UnsupportedPlatformError } from "../chrome-profile.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockHomedir.mockReturnValue("/Users/testuser");
});

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

describe("resolveProfile", () => {
  it("returns correct macOS path for valid profile (TC-068)", () => {
    mockPlatform.mockReturnValue("darwin");
    mockExistsSync.mockReturnValue(true);

    const result = resolveProfile("Profile 3");
    expect(result).toBe("/Users/testuser/Library/Application Support/Google/Chrome/Profile 3");
  });

  it("throws with available profiles when profile not found (TC-069)", () => {
    mockPlatform.mockReturnValue("darwin");
    mockExistsSync.mockImplementation((p: string) => {
      return !String(p).endsWith("Profile 3");
    });
    mockReaddirSync.mockReturnValue([
      { name: "Default", isDirectory: () => true },
      { name: "Profile 1", isDirectory: () => true },
      { name: "Profile 2", isDirectory: () => true },
    ]);

    expect(() => resolveProfile("Profile 3")).toThrow(/Profile 3.*not found/);
    expect(() => resolveProfile("Profile 3")).toThrow(/Default/);
  });

  it("throws UnsupportedPlatformError on non-macOS (TC-070)", () => {
    mockPlatform.mockReturnValue("linux");

    expect(() => resolveProfile("Default")).toThrow(UnsupportedPlatformError);
    expect(() => resolveProfile("Default")).toThrow(/only supported on macOS/);
  });
});

// ---------------------------------------------------------------------------
// listProfiles
// ---------------------------------------------------------------------------

describe("listProfiles", () => {
  it("returns profile names from Chrome directory", () => {
    mockPlatform.mockReturnValue("darwin");
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: "Default", isDirectory: () => true },
      { name: "Profile 1", isDirectory: () => true },
      { name: "Profile 2", isDirectory: () => true },
      { name: "Local State", isDirectory: () => false },
      { name: "Crashpad", isDirectory: () => true },
    ]);

    const profiles = listProfiles();
    expect(profiles).toEqual(["Default", "Profile 1", "Profile 2"]);
  });

  it("returns empty array when Chrome dir does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    const profiles = listProfiles();
    expect(profiles).toEqual([]);
  });
});
