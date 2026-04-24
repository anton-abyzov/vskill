// ---------------------------------------------------------------------------
// first-run-onboarding.test.ts — T-040 RED tests.
//
// firstRunOnboarding() is invoked at the top of `vskill studio` before the
// browser opens. If no keys are stored AND no env var is set AND stdin is a
// TTY, it prompts the user to add an Anthropic key. All three branches:
//   - skip silently (non-TTY, or env var, or already stored)
//   - user accepts → masked paste → saveKey
//   - user declines → print hint, return without prompting again
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstRunOnboarding } from "../first-run-onboarding.js";
import * as store from "../eval-server/settings-store.js";

const CANARY = "ONBOARDCANARY9";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vskill-onboard-test-"));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

interface CapturedIO {
  stdout: string;
  stderr: string;
}

function makeIO(): {
  io: Parameters<typeof firstRunOnboarding>[0];
  captured: CapturedIO;
  setConfirm: (v: boolean) => void;
  setKey: (k: string) => void;
  setTTY: (v: boolean) => void;
  getConfirmCallCount: () => number;
  getReadKeyCallCount: () => number;
} {
  const captured: CapturedIO = { stdout: "", stderr: "" };
  let confirmValue = false;
  let keyValue = "";
  let ttyValue = true;
  let confirmCalls = 0;
  let readKeyCalls = 0;

  const io = {
    stdout: {
      write: (s: string) => {
        captured.stdout += s;
        return true;
      },
    },
    stderr: {
      write: (s: string) => {
        captured.stderr += s;
        return true;
      },
    },
    isTTY: () => ttyValue,
    promptConfirm: async (_q: string) => {
      confirmCalls++;
      return confirmValue;
    },
    readMaskedKey: async () => {
      readKeyCalls++;
      return keyValue;
    },
    env: process.env,
  };

  return {
    io,
    captured,
    setConfirm: (v) => {
      confirmValue = v;
    },
    setKey: (k) => {
      keyValue = k;
    },
    setTTY: (v) => {
      ttyValue = v;
    },
    getConfirmCallCount: () => confirmCalls,
    getReadKeyCallCount: () => readKeyCalls,
  };
}

describe("firstRunOnboarding — T-040", () => {
  let tmp: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmp = makeTmpDir();
    store.resetSettingsStore({ configDir: tmp });
    // Snapshot and clear provider env vars so base state is "empty".
    savedEnv = {};
    for (const name of [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "OPENROUTER_API_KEY",
    ]) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    store.resetSettingsStore();
    cleanup(tmp);
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("skips silently when stdin is non-TTY", async () => {
    const { io, captured, setTTY, getConfirmCallCount } = makeIO();
    setTTY(false);
    const result = await firstRunOnboarding(io);
    expect(result.action).toBe("skip");
    expect(getConfirmCallCount()).toBe(0);
    expect(captured.stdout).toBe("");
  });

  it("skips silently when an env var is already set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-fromenv";
    const { io, captured, getConfirmCallCount } = makeIO();
    const result = await firstRunOnboarding(io);
    expect(result.action).toBe("skip");
    expect(getConfirmCallCount()).toBe(0);
    expect(captured.stdout).toBe("");
  });

  it("skips silently when a key is already stored", async () => {
    await store.saveKey("anthropic", "sk-ant-alreadyhere");
    const { io, getConfirmCallCount } = makeIO();
    const result = await firstRunOnboarding(io);
    expect(result.action).toBe("skip");
    expect(getConfirmCallCount()).toBe(0);
  });

  it("prompts when no key configured and stdin is TTY", async () => {
    const { io, captured, setConfirm, getConfirmCallCount } = makeIO();
    setConfirm(false);
    await firstRunOnboarding(io);
    expect(getConfirmCallCount()).toBe(1);
    // Prompt text mentions API key detection.
    expect(captured.stdout.toLowerCase()).toMatch(/api key|anthropic/);
  });

  it("accepts key → saves to store, returns action=saved", async () => {
    const { io, captured, setConfirm, setKey, getReadKeyCallCount } = makeIO();
    setConfirm(true);
    setKey(`sk-ant-${CANARY}-last4xyz9`);
    const result = await firstRunOnboarding(io);
    expect(result.action).toBe("saved");
    expect(result.provider).toBe("anthropic");
    expect(getReadKeyCallCount()).toBe(1);
    expect(store.readKey("anthropic")).toBe(`sk-ant-${CANARY}-last4xyz9`);
    // Raw key never echoed.
    expect(captured.stdout).not.toContain(CANARY);
    expect(captured.stdout).toContain("****xyz9");
  });

  it("declines → prints CLI hint, returns action=declined", async () => {
    const { io, captured, setConfirm } = makeIO();
    setConfirm(false);
    const result = await firstRunOnboarding(io);
    expect(result.action).toBe("declined");
    expect(captured.stdout).toContain("vskill keys set anthropic");
  });

  it("accepts but supplies empty key → returns declined, no save", async () => {
    const { io, setConfirm, setKey } = makeIO();
    setConfirm(true);
    setKey("");
    const result = await firstRunOnboarding(io);
    expect(result.action).toBe("declined");
    expect(store.readKey("anthropic")).toBe(null);
  });

  it("accepts but save fails → error path does not throw, returns declined", async () => {
    // Simulate failure by pointing config dir at a path we can't write.
    store.resetSettingsStore({
      configDir: path.join(tmp, "does", "not", "exist-file-collision"),
    });
    // Pre-create a FILE at the configDir path so mkdirSync fails.
    fs.writeFileSync(path.join(tmp, "does"), "x");
    const { io, captured, setConfirm, setKey } = makeIO();
    setConfirm(true);
    setKey("sk-ant-willfail");
    const result = await firstRunOnboarding(io);
    expect(result.action).toBe("declined");
    expect(captured.stderr.toLowerCase()).toMatch(/save|error|fail/);
    // Canary of failed key must not appear anywhere.
    expect(captured.stdout + captured.stderr).not.toContain("willfail");
  });
});
