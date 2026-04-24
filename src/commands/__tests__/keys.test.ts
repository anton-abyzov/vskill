// ---------------------------------------------------------------------------
// keys.test.ts — T-030 RED tests for `vskill keys` subcommand dispatcher.
//
// Covers AC-US3-01..05: set (piped + interactive masked), list (redacted),
// remove (idempotent), path (absolute), unknown subcommand → usage + exit 1.
//
// Design: `keysCommand(subcommand, provider, opts)` accepts dependency
// injection for stdin/stdout/stderr/store so tests don't touch real process
// streams or the user's real ~/.vskill dir. Real store pointed at a temp
// VSKILL_CONFIG_DIR for round-trips.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keysCommand } from "../keys.js";
import * as store from "../../eval-server/settings-store.js";

const CANARY = "LEAKCANARY4242";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vskill-keys-test-"));
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
  exitCode: number | null;
}

function makeIO(pipedInput?: string): {
  io: Parameters<typeof keysCommand>[2];
  captured: CapturedIO;
} {
  const captured: CapturedIO = { stdout: "", stderr: "", exitCode: null };
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
    exit: (code: number) => {
      captured.exitCode = code;
    },
    // `readKeyFromStdin` returns the already-collected piped input OR
    // an interactively-masked key. For tests we just return the provided
    // input verbatim — the masked-stdin helper is tested separately.
    readKeyFromStdin: async () => pipedInput ?? "",
    isPiped: () => pipedInput !== undefined,
  };
  return { io, captured };
}

describe("vskill keys — dispatcher (T-030)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    store.resetSettingsStore({ configDir: tmp });
  });

  afterEach(() => {
    store.resetSettingsStore();
    cleanup(tmp);
  });

  describe("keys path", () => {
    it("TC-024: prints absolute path ending in keys.env", async () => {
      const { io, captured } = makeIO();
      await keysCommand("path", undefined, io);
      const out = captured.stdout.trim();
      expect(path.isAbsolute(out)).toBe(true);
      expect(out.endsWith("keys.env")).toBe(true);
      expect(out).toContain(tmp);
      expect(captured.exitCode).toBe(null);
    });
  });

  describe("keys list", () => {
    it("TC-022: list shows redacted keys (no raw key in output)", async () => {
      await store.saveKey("anthropic", `sk-ant-${CANARY}-last4abcd`);
      const { io, captured } = makeIO();
      await keysCommand("list", undefined, io);
      const combined = captured.stdout + captured.stderr;
      expect(combined).not.toContain(CANARY);
      // Redacted form shows last 4 chars.
      expect(combined).toContain("****abcd");
    });

    it("lists all three providers with Status column", async () => {
      const { io, captured } = makeIO();
      await keysCommand("list", undefined, io);
      expect(captured.stdout.toLowerCase()).toContain("anthropic");
      expect(captured.stdout.toLowerCase()).toContain("openai");
      expect(captured.stdout.toLowerCase()).toContain("openrouter");
    });

    it("Source column shows 'env var' when env var is set", async () => {
      const originalEnv = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "sk-ant-fromenv0000";
      try {
        const { io, captured } = makeIO();
        await keysCommand("list", undefined, io);
        expect(captured.stdout).toContain("env var");
      } finally {
        if (originalEnv === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = originalEnv;
      }
    });
  });

  describe("keys set <provider>", () => {
    it("TC-021: set via piped stdin persists AND does not echo key", async () => {
      const key = `sk-ant-${CANARY}-abcd1234`;
      const { io, captured } = makeIO(key);
      await keysCommand("set", "anthropic", io);
      // Key persisted to disk.
      const filePath = path.join(tmp, "keys.env");
      const diskContents = fs.readFileSync(filePath, "utf8");
      expect(diskContents).toContain(key);
      // Raw key NEVER echoed to stdout/stderr.
      const combined = captured.stdout + captured.stderr;
      expect(combined).not.toContain(CANARY);
      // Confirmation shows redacted form.
      expect(combined).toContain("****1234");
      expect(combined.toLowerCase()).toContain("anthropic");
    });

    it("validates provider id — unknown provider exits 1 with helpful error", async () => {
      const { io, captured } = makeIO("sk-whatever");
      await keysCommand("set", "bogus-provider", io);
      expect(captured.exitCode).toBe(1);
      expect(captured.stderr.toLowerCase()).toContain("unknown provider");
      expect(captured.stderr).toContain("anthropic");
      expect(captured.stderr).toContain("openai");
      expect(captured.stderr).toContain("openrouter");
    });

    it("missing provider argument exits 1 with usage", async () => {
      const { io, captured } = makeIO("sk-whatever");
      await keysCommand("set", undefined, io);
      expect(captured.exitCode).toBe(1);
      expect(captured.stderr.toLowerCase()).toMatch(/usage|provider/);
    });

    it("empty key input exits 1 without writing", async () => {
      const { io, captured } = makeIO("");
      await keysCommand("set", "anthropic", io);
      expect(captured.exitCode).toBe(1);
      // File must not be created.
      const filePath = path.join(tmp, "keys.env");
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe("keys remove <provider>", () => {
    it("TC-023: remove is idempotent (exit 0 when no stored key)", async () => {
      const { io, captured } = makeIO();
      await keysCommand("remove", "anthropic", io);
      expect(captured.exitCode).toBe(null); // not an error
    });

    it("remove clears stored key", async () => {
      await store.saveKey("anthropic", `sk-ant-${CANARY}-wxyz`);
      const { io, captured } = makeIO();
      await keysCommand("remove", "anthropic", io);
      expect(store.readKey("anthropic")).toBe(null);
      const combined = captured.stdout + captured.stderr;
      expect(combined).not.toContain(CANARY);
    });

    it("remove with unknown provider exits 1", async () => {
      const { io, captured } = makeIO();
      await keysCommand("remove", "bogus", io);
      expect(captured.exitCode).toBe(1);
    });

    it("remove without provider exits 1", async () => {
      const { io, captured } = makeIO();
      await keysCommand("remove", undefined, io);
      expect(captured.exitCode).toBe(1);
    });
  });

  describe("unknown subcommand", () => {
    it("unknown subcommand exits 1 with usage listing", async () => {
      const { io, captured } = makeIO();
      await keysCommand("bogus", undefined, io);
      expect(captured.exitCode).toBe(1);
      const combined = captured.stderr;
      expect(combined.toLowerCase()).toMatch(/unknown|usage/);
      expect(combined).toContain("set");
      expect(combined).toContain("list");
      expect(combined).toContain("remove");
      expect(combined).toContain("path");
    });

    it("no subcommand prints usage and exits 1", async () => {
      const { io, captured } = makeIO();
      await keysCommand(undefined, undefined, io);
      expect(captured.exitCode).toBe(1);
      expect(captured.stderr.toLowerCase()).toContain("usage");
    });
  });

  describe("T-042 CLI-side 401 friendly hint", () => {
    it("list with zero stored + zero env prints setup hint", async () => {
      // Clear all provider env vars for this test.
      const saved: Record<string, string | undefined> = {};
      for (const name of [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
      ]) {
        saved[name] = process.env[name];
        delete process.env[name];
      }
      try {
        const { io, captured } = makeIO();
        await keysCommand("list", undefined, io);
        expect(captured.stdout.toLowerCase()).toContain(
          "vskill keys set",
        );
      } finally {
        for (const [name, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    });
  });
});
