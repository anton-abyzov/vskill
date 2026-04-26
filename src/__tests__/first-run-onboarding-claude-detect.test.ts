// ---------------------------------------------------------------------------
// 0772 US-001 — claude-binary detection skips the onboarding prompt.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstRunOnboarding } from "../first-run-onboarding.js";
import * as store from "../eval-server/settings-store.js";

interface CapturedIO {
  stdout: string;
  stderr: string;
}

function makeIO(opts: { tty?: boolean; claudeDetected?: boolean } = {}): {
  io: Parameters<typeof firstRunOnboarding>[0];
  captured: CapturedIO;
  promptCalls: () => number;
} {
  const captured: CapturedIO = { stdout: "", stderr: "" };
  let promptCalls = 0;
  const io = {
    stdout: { write: (s: string) => { captured.stdout += s; return true; } },
    stderr: { write: (s: string) => { captured.stderr += s; return true; } },
    isTTY: () => opts.tty ?? true,
    promptConfirm: async () => { promptCalls++; return false; },
    readMaskedKey: async () => "",
    env: process.env,
    detectClaudeBinary: () => opts.claudeDetected ?? false,
  };
  return { io, captured, promptCalls: () => promptCalls };
}

describe("firstRunOnboarding — claude-binary detection (0772 US-001)", () => {
  let tmp: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vskill-onboard-claude-"));
    store.resetSettingsStore({ configDir: tmp });
    savedEnv = {};
    for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    store.resetSettingsStore();
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("AC-US1-01: skips silently when claude binary is on PATH (no keys)", async () => {
    const { io, captured, promptCalls } = makeIO({ tty: true, claudeDetected: true });
    const result = await firstRunOnboarding(io);
    expect(result.action).toBe("skip");
    expect(promptCalls()).toBe(0);
    expect(captured.stdout).toBe("");
    expect(captured.stderr).toBe("");
  });

  it("AC-US1-02: prompt wording is softened (no 'needs', mentions Claude Code, mentions optional)", async () => {
    const { io, captured } = makeIO({ tty: true, claudeDetected: false });
    await firstRunOnboarding(io);
    const out = captured.stdout.toLowerCase();
    expect(out).not.toMatch(/\bneeds\b/);
    expect(out).toMatch(/claude code/);
    expect(out).toMatch(/optional/);
  });

  it("AC-US1-03: decline message names BOTH options (claude code OR vskill keys)", async () => {
    const { io, captured } = makeIO({ tty: true, claudeDetected: false });
    const result = await firstRunOnboarding(io);
    expect(result.action).toBe("declined");
    const out = captured.stdout.toLowerCase();
    expect(out).toContain("vskill keys set anthropic");
    expect(out).toMatch(/claude/);
  });

  it("AC-US1-04: when detectClaudeBinary throws, treats as not-detected (does not crash)", async () => {
    const captured: CapturedIO = { stdout: "", stderr: "" };
    let promptCalls = 0;
    const io = {
      stdout: { write: (s: string) => { captured.stdout += s; return true; } },
      stderr: { write: (s: string) => { captured.stderr += s; return true; } },
      isTTY: () => true,
      promptConfirm: async () => { promptCalls++; return false; },
      readMaskedKey: async () => "",
      env: process.env,
      detectClaudeBinary: () => { throw new Error("simulated spawn failure"); },
    };
    const result = await firstRunOnboarding(io);
    // Detection failure means we treat it as "not detected" → prompt fires (or skip if no TTY).
    // We assert the call did not propagate the throw.
    expect(["skip", "declined", "saved"]).toContain(result.action);
  });
});
