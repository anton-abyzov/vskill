// ---------------------------------------------------------------------------
// which-probe-env.test.ts — defaultProbe must run under an enhanced PATH.
//
// Regression for the GUI-launch detection bug: a Dock/Spotlight-launched
// studio inherits a truncated PATH, so `which code`/`cursor`/CLI presence
// checks via whichSync would falsely return "not installed". The default
// probe now spawns with enhancedSpawnEnv() so detection sees Homebrew /
// npm-global dirs. We mock node:child_process to capture the probe's env.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";

const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
  // resolve-binary (pulled in transitively via enhancedSpawnEnv) also imports
  // execSync + exec; stub them so getExtraPaths' npm-prefix probe is skipped
  // (its execSync throw is swallowed) and detectBinary's exec is a noop.
  execSync: vi.fn(() => {
    throw new Error("no npm in test");
  }),
  exec: vi.fn(),
}));

const { whichSync, _resetWhichCacheForTests } = await import("../which.js");
const { enhancedSpawnEnv, _resetEnhancedSpawnEnvCache } = await import(
  "../../../utils/resolve-binary.js"
);

describe("whichSync defaultProbe — enhanced PATH (GUI-launch detection)", () => {
  beforeEach(() => {
    _resetWhichCacheForTests();
    _resetEnhancedSpawnEnvCache();
    execFileSyncMock.mockReset();
    // Probe uses stdio:"ignore"; any non-throwing return means "found".
    execFileSyncMock.mockReturnValue(undefined);
  });

  it("probes with enhancedSpawnEnv() so detection sees Homebrew/npm-global dirs", () => {
    const found = whichSync("code");
    expect(found).toBe(true);
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);

    const opts = execFileSyncMock.mock.calls[0][2] as { env?: NodeJS.ProcessEnv };
    // The probe's PATH is the enhanced one — compare against a fresh compute
    // (deterministic: same process.env + same real fs probes).
    _resetEnhancedSpawnEnvCache();
    expect(opts.env?.PATH).toBe(enhancedSpawnEnv().PATH);
  });
});
