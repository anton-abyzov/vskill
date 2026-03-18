// ---------------------------------------------------------------------------
// Tests for writeCredential: write, update existing, gitignore handling
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeCredential, resolveCredential, ensureGitignore } from "../credential-resolver.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cred-write-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeCredential", () => {
  it("creates .env.local with the credential when file does not exist", () => {
    writeCredential(tmpDir, "API_KEY", "sk-abc123");
    const content = readFileSync(join(tmpDir, ".env.local"), "utf-8");
    expect(content).toContain("API_KEY=sk-abc123");
  });

  it("updates an existing key without affecting other entries", () => {
    writeFileSync(join(tmpDir, ".env.local"), "API_KEY=old-value\nOTHER=keep-me\n");
    writeCredential(tmpDir, "API_KEY", "new-value");
    const content = readFileSync(join(tmpDir, ".env.local"), "utf-8");
    expect(content).toContain("API_KEY=new-value");
    expect(content).toContain("OTHER=keep-me");
    expect(content).not.toContain("old-value");
  });

  it("appends a new key to existing .env.local", () => {
    writeFileSync(join(tmpDir, ".env.local"), "EXISTING=val\n");
    writeCredential(tmpDir, "NEW_KEY", "new-val");
    const content = readFileSync(join(tmpDir, ".env.local"), "utf-8");
    expect(content).toContain("EXISTING=val");
    expect(content).toContain("NEW_KEY=new-val");
  });

  it("creates .gitignore with .env.local when .gitignore does not exist", () => {
    writeCredential(tmpDir, "KEY", "val");
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".env.local");
  });

  it("appends .env.local to existing .gitignore", () => {
    writeFileSync(join(tmpDir, ".gitignore"), "node_modules/\ndist/\n");
    writeCredential(tmpDir, "KEY", "val");
    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".env.local");
    expect(gitignore).toContain("node_modules/");
  });

  it("does not duplicate .env.local in .gitignore", () => {
    writeFileSync(join(tmpDir, ".gitignore"), ".env.local\n");
    writeCredential(tmpDir, "KEY", "val");
    const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    const count = gitignore.split("\n").filter((l) => l.trim() === ".env.local").length;
    expect(count).toBe(1);
  });

  it("written credential can be resolved back", () => {
    writeCredential(tmpDir, "ROUND_TRIP", "secret-val");
    const result = resolveCredential("ROUND_TRIP", tmpDir);
    expect(result).toEqual({ value: "secret-val", source: "dotenv" });
  });

  it("handles values containing equals signs", () => {
    writeCredential(tmpDir, "TOKEN", "abc=def=ghi");
    const result = resolveCredential("TOKEN", tmpDir);
    expect(result?.value).toBe("abc=def=ghi");
  });
});
