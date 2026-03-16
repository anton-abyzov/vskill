// ---------------------------------------------------------------------------
// Unit tests for judge-cache.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JudgeCache } from "../judge-cache.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "judge-cache-test-"));
  mkdirSync(join(tempDir, "evals"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// TC-010: Cache hit returns stored result
// ---------------------------------------------------------------------------

describe("JudgeCache", () => {
  it("returns cached result without calling compute on cache hit (TC-010)", async () => {
    const cache = new JudgeCache(tempDir);
    const compute = vi.fn().mockResolvedValue({
      id: "a1",
      text: "output is correct",
      pass: true,
      reasoning: "looks good",
    });

    // First call — should invoke compute
    const result1 = await cache.getOrCompute("output is correct", "some output", "claude-sonnet", compute);
    expect(result1.pass).toBe(true);
    expect(compute).toHaveBeenCalledTimes(1);

    // Second call with same inputs — should use cache
    const result2 = await cache.getOrCompute("output is correct", "some output", "claude-sonnet", compute);
    expect(result2.pass).toBe(true);
    expect(compute).toHaveBeenCalledTimes(1); // NOT called again
  });

  // ---------------------------------------------------------------------------
  // TC-011: Cache miss calls compute
  // ---------------------------------------------------------------------------

  it("calls compute on cache miss (TC-011)", async () => {
    const cache = new JudgeCache(tempDir);
    const compute = vi.fn().mockResolvedValue({
      id: "a1",
      text: "check something",
      pass: false,
      reasoning: "wrong",
    });

    const result = await cache.getOrCompute("check something", "new output", "claude-sonnet", compute);
    expect(result.pass).toBe(false);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // TC-012: Corruption recovery
  // ---------------------------------------------------------------------------

  it("recovers from corrupted cache file (TC-012)", async () => {
    const cachePath = join(tempDir, "evals", ".judge-cache.json");
    writeFileSync(cachePath, "THIS IS NOT JSON{{{", "utf-8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = new JudgeCache(tempDir);
    expect(cache.size).toBe(0);
    expect(existsSync(cachePath)).toBe(false); // corrupted file should be deleted
    warnSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // TC-013: Cache stored at correct path
  // ---------------------------------------------------------------------------

  it("writes cache file at <skillDir>/evals/.judge-cache.json (TC-013)", async () => {
    const cache = new JudgeCache(tempDir);
    const compute = vi.fn().mockResolvedValue({
      id: "a1",
      text: "assertion",
      pass: true,
      reasoning: "ok",
    });

    await cache.getOrCompute("assertion", "output", "claude-sonnet", compute);
    cache.flush();

    const expectedPath = join(tempDir, "evals", ".judge-cache.json");
    expect(existsSync(expectedPath)).toBe(true);

    const data = JSON.parse(readFileSync(expectedPath, "utf-8"));
    expect(data.version).toBe(1);
    expect(Object.keys(data.entries).length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // TC-016: gitignore updated on first write
  // ---------------------------------------------------------------------------

  it("adds evals/.judge-cache.json to .gitignore on first write (TC-016)", async () => {
    const cache = new JudgeCache(tempDir);
    const compute = vi.fn().mockResolvedValue({
      id: "a1",
      text: "assertion",
      pass: true,
      reasoning: "ok",
    });

    await cache.getOrCompute("assertion", "output", "claude-sonnet", compute);
    cache.flush();

    const gitignorePath = join(tempDir, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, "utf-8");
    expect(content).toContain("evals/.judge-cache.json");
  });

  it("does not duplicate gitignore entry if already present (TC-016b)", async () => {
    // Pre-create .gitignore with the pattern
    const gitignorePath = join(tempDir, ".gitignore");
    writeFileSync(gitignorePath, "node_modules\nevals/.judge-cache.json\n", "utf-8");

    const cache = new JudgeCache(tempDir);
    const compute = vi.fn().mockResolvedValue({
      id: "a1",
      text: "assertion",
      pass: true,
      reasoning: "ok",
    });

    await cache.getOrCompute("assertion", "output", "claude-sonnet", compute);
    cache.flush();

    const content = readFileSync(gitignorePath, "utf-8");
    // Should only appear once
    const matches = content.match(/evals\/\.judge-cache\.json/g);
    expect(matches?.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // TC-023: Different judgeModel = cache miss
  // ---------------------------------------------------------------------------

  it("treats different judgeModel as cache miss (TC-023)", async () => {
    const cache = new JudgeCache(tempDir);
    let callCount = 0;
    const compute = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        id: "a1",
        text: "assertion",
        pass: true,
        reasoning: `call ${callCount}`,
      };
    });

    await cache.getOrCompute("assertion", "output", "claude-haiku", compute);
    await cache.getOrCompute("assertion", "output", "claude-opus", compute);
    await cache.getOrCompute("assertion", "output", "claude-haiku", compute); // should hit cache

    expect(compute).toHaveBeenCalledTimes(2); // haiku + opus, third call is cache hit
  });

  // ---------------------------------------------------------------------------
  // TC-024: Filesystem round-trip
  // ---------------------------------------------------------------------------

  it("persists and reloads entries across instances (TC-024)", async () => {
    const compute = vi.fn().mockResolvedValue({
      id: "a1",
      text: "assertion",
      pass: true,
      reasoning: "persisted",
    });

    // Write
    const cache1 = new JudgeCache(tempDir);
    await cache1.getOrCompute("assertion", "output", "claude-sonnet", compute);
    cache1.flush();

    // Read in new instance
    const cache2 = new JudgeCache(tempDir);
    expect(cache2.size).toBe(1);

    const compute2 = vi.fn().mockResolvedValue({
      id: "a1",
      text: "assertion",
      pass: false,
      reasoning: "should not be called",
    });

    const result = await cache2.getOrCompute("assertion", "output", "claude-sonnet", compute2);
    expect(result.pass).toBe(true); // from cache, not compute2
    expect(compute2).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Static key computation
  // ---------------------------------------------------------------------------

  it("produces consistent SHA-256 keys", () => {
    const key1 = JudgeCache.computeKey("assertion", "output", "model-a");
    const key2 = JudgeCache.computeKey("assertion", "output", "model-a");
    const key3 = JudgeCache.computeKey("assertion", "output", "model-b");

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toMatch(/^[0-9a-f]{64}$/); // valid SHA-256 hex
  });

  it("has() returns true for cached entries", async () => {
    const cache = new JudgeCache(tempDir);
    expect(cache.has("assertion", "output", "model")).toBe(false);

    await cache.getOrCompute("assertion", "output", "model", async () => ({
      id: "a1", text: "assertion", pass: true, reasoning: "ok",
    }));

    expect(cache.has("assertion", "output", "model")).toBe(true);
    expect(cache.has("assertion", "output", "other-model")).toBe(false);
  });
});
