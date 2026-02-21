// ---------------------------------------------------------------------------
// Tests for find command (T-009)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearchSkills = vi.hoisted(() => vi.fn());

vi.mock("../api/client.js", () => ({
  searchSkills: mockSearchSkills,
}));

// Capture console.log output
const logs: string[] = [];
const originalLog = console.log;

import { findCommand } from "./find.js";

describe("findCommand hints", () => {
  beforeEach(() => {
    logs.length = 0;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSearchSkills.mockResolvedValue([
      { name: "test-skill", author: "test", tier: "VERIFIED", score: 90, installs: 100 },
    ]);
  });

  it("TC-030: non-TTY output includes hint line", async () => {
    // Simulate non-TTY
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    await findCommand("test", { json: false, noHint: false });

    const output = logs.join("\n");
    expect(output).toContain("To install: npx skills add");

    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("TC-031: hint is suppressed with --json flag", async () => {
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    await findCommand("test", { json: true, noHint: false });

    const output = logs.join("\n");
    expect(output).not.toContain("To install: npx skills add");

    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("TC-032: hint is suppressed with --no-hint flag", async () => {
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    await findCommand("test", { json: false, noHint: true });

    const output = logs.join("\n");
    expect(output).not.toContain("To install: npx skills add");

    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  });
});
