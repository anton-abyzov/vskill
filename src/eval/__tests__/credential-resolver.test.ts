import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveCredential,
  resolveAllCredentials,
  writeCredential,
  ensureGitignore,
  parseDotenv,
} from "../credential-resolver.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cred-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseDotenv
// ---------------------------------------------------------------------------

describe("parseDotenv", () => {
  it("parses KEY=value pairs", () => {
    const result = parseDotenv("FOO=bar\nBAZ=123");
    expect(result).toEqual({ FOO: "bar", BAZ: "123" });
  });

  it("strips surrounding quotes", () => {
    const result = parseDotenv('KEY="value"\nKEY2=\'single\'');
    expect(result).toEqual({ KEY: "value", KEY2: "single" });
  });

  it("skips comments and blank lines", () => {
    const result = parseDotenv("# comment\n\nKEY=val\n  # another");
    expect(result).toEqual({ KEY: "val" });
  });

  it("handles values with = signs", () => {
    const result = parseDotenv("KEY=abc=def=ghi");
    expect(result).toEqual({ KEY: "abc=def=ghi" });
  });
});

// ---------------------------------------------------------------------------
// resolveCredential
// ---------------------------------------------------------------------------

describe("resolveCredential", () => {
  it("returns env var with source 'env' when present (TC-061)", () => {
    const original = process.env.TEST_CRED_X;
    process.env.TEST_CRED_X = "from-env";
    try {
      const result = resolveCredential("TEST_CRED_X", tmpDir);
      expect(result).toEqual({ value: "from-env", source: "env" });
    } finally {
      if (original === undefined) delete process.env.TEST_CRED_X;
      else process.env.TEST_CRED_X = original;
    }
  });

  it("returns dotenv value with source 'dotenv' when env absent (TC-062)", () => {
    writeFileSync(join(tmpDir, ".env.local"), "MY_KEY=dotenv-secret\n");
    const result = resolveCredential("MY_KEY", tmpDir);
    expect(result).toEqual({ value: "dotenv-secret", source: "dotenv" });
  });

  it("env var takes priority over .env.local (TC-061)", () => {
    const original = process.env.PRIORITY_KEY;
    process.env.PRIORITY_KEY = "env-wins";
    writeFileSync(join(tmpDir, ".env.local"), "PRIORITY_KEY=dotenv-val\n");
    try {
      const result = resolveCredential("PRIORITY_KEY", tmpDir);
      expect(result!.source).toBe("env");
    } finally {
      if (original === undefined) delete process.env.PRIORITY_KEY;
      else process.env.PRIORITY_KEY = original;
    }
  });

  it("returns null when key absent from both sources (TC-063)", () => {
    const result = resolveCredential("NONEXISTENT_KEY_12345", tmpDir);
    expect(result).toBeNull();
  });

  it("does not mutate process.env when reading .env.local (TC-090)", () => {
    writeFileSync(join(tmpDir, ".env.local"), "DOTENV_ONLY_KEY=secret123\n");
    const before = process.env.DOTENV_ONLY_KEY;
    resolveCredential("DOTENV_ONLY_KEY", tmpDir);
    expect(process.env.DOTENV_ONLY_KEY).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// resolveAllCredentials
// ---------------------------------------------------------------------------

describe("resolveAllCredentials", () => {
  it("reports mixed ready/missing statuses (TC-091)", () => {
    const original = process.env.CRED_A;
    process.env.CRED_A = "val-a";
    writeFileSync(join(tmpDir, ".env.local"), "CRED_B=val-b\n");

    try {
      const statuses = resolveAllCredentials(["CRED_A", "CRED_B", "CRED_C_MISSING"], tmpDir);
      expect(statuses).toEqual([
        { name: "CRED_A", status: "ready", source: "env" },
        { name: "CRED_B", status: "ready", source: "dotenv" },
        { name: "CRED_C_MISSING", status: "missing" },
      ]);
    } finally {
      if (original === undefined) delete process.env.CRED_A;
      else process.env.CRED_A = original;
    }
  });
});

// ---------------------------------------------------------------------------
// writeCredential
// ---------------------------------------------------------------------------

describe("writeCredential", () => {
  it("creates .env.local and writes credential (TC-064)", () => {
    writeCredential(tmpDir, "X_API_KEY", "secret123");
    const content = readFileSync(join(tmpDir, ".env.local"), "utf-8");
    expect(content).toContain("X_API_KEY=secret123");
  });

  it("updates existing key in .env.local", () => {
    writeFileSync(join(tmpDir, ".env.local"), "X_API_KEY=old\nOTHER=keep\n");
    writeCredential(tmpDir, "X_API_KEY", "new-val");
    const content = readFileSync(join(tmpDir, ".env.local"), "utf-8");
    expect(content).toContain("X_API_KEY=new-val");
    expect(content).toContain("OTHER=keep");
    expect(content).not.toContain("old");
  });

  it("adds .env.local to .gitignore (TC-065)", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "node_modules/\n");
    writeCredential(tmpDir, "KEY", "val");
    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".env.local");
  });

  it("creates .gitignore if not present", () => {
    writeCredential(tmpDir, "KEY", "val");
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".env.local");
  });
});

// ---------------------------------------------------------------------------
// ensureGitignore
// ---------------------------------------------------------------------------

describe("ensureGitignore", () => {
  it("does not duplicate .env.local entry", () => {
    writeFileSync(join(tmpDir, ".gitignore"), ".env.local\nnode_modules/\n");
    ensureGitignore(tmpDir);
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    const count = content.split("\n").filter((l) => l.trim() === ".env.local").length;
    expect(count).toBe(1);
  });
});
