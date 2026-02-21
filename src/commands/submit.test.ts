import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the browser opener module (will be created in submit.ts)
// ---------------------------------------------------------------------------
const mockOpenBrowser = vi.fn().mockResolvedValue(undefined);

vi.mock("../utils/browser.js", () => ({
  openBrowser: (...args: unknown[]) => mockOpenBrowser(...args),
}));

// ---------------------------------------------------------------------------
// Mock utils/output (suppress console output in tests)
// ---------------------------------------------------------------------------
vi.mock("../utils/output.js", () => ({
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------
const { submitCommand } = await import("./submit.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("submitCommand", () => {
  // TC-001: Given owner/repo arg, constructs correct URL with repo query param
  describe("TC-001: constructs URL with repo query param", () => {
    it("opens browser with https://verified-skill.com/submit?repo=owner/repo", async () => {
      await submitCommand("myorg/myskill", {});

      expect(mockOpenBrowser).toHaveBeenCalledOnce();
      const url = mockOpenBrowser.mock.calls[0][0] as string;
      expect(url).toBe("https://verified-skill.com/submit?repo=myorg%2Fmyskill");
    });
  });

  // TC-002: Given --skill flag, URL includes skill query param
  describe("TC-002: URL includes skill query param when --skill provided", () => {
    it("appends &skill=skillName to the URL", async () => {
      await submitCommand("myorg/myskill", { skill: "my-awesome-skill" });

      expect(mockOpenBrowser).toHaveBeenCalledOnce();
      const url = mockOpenBrowser.mock.calls[0][0] as string;
      expect(url).toBe(
        "https://verified-skill.com/submit?repo=myorg%2Fmyskill&skill=my-awesome-skill"
      );
    });
  });

  // TC-003: Invalid source format still rejected
  describe("TC-003: rejects invalid source format", () => {
    it("exits with error for source without slash", async () => {
      const exitError = new Error("process.exit");
      const mockExit = vi
        .spyOn(process, "exit")
        .mockImplementation(() => { throw exitError; });

      await expect(submitCommand("invalid-source", {})).rejects.toThrow("process.exit");

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockOpenBrowser).not.toHaveBeenCalled();

      mockExit.mockRestore();
    });
  });

  // TC-014: Accepts full GitHub URL
  describe("TC-014: accepts full GitHub URL", () => {
    it("opens browser with correct URL when given https://github.com/owner/repo", async () => {
      await submitCommand("https://github.com/myorg/myskill", {});

      expect(mockOpenBrowser).toHaveBeenCalledOnce();
      const url = mockOpenBrowser.mock.calls[0][0] as string;
      expect(url).toBe("https://verified-skill.com/submit?repo=myorg%2Fmyskill");
    });
  });

  // TC-004: Prints message telling user to complete in browser
  describe("TC-004: prints browser instructions", () => {
    it("logs a message about completing submission in browser", async () => {
      const consoleSpy = vi.spyOn(console, "log");

      await submitCommand("myorg/myskill", {});

      const allOutput = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allOutput).toContain("browser");
    });
  });
});
