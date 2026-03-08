import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeHistoryEntry,
  listHistory,
  readHistoryEntry,
  computeRegressions,
} from "../benchmark-history.js";
import type { BenchmarkResult } from "../benchmark.js";

let testDir: string;

const mkResult = (overrides: Partial<BenchmarkResult> = {}): BenchmarkResult => ({
  timestamp: "2026-03-08T12:00:00.000Z",
  model: "test-model",
  skill_name: "test-skill",
  cases: [
    {
      eval_id: 1,
      eval_name: "test-case",
      status: "pass",
      error_message: null,
      pass_rate: 1.0,
      assertions: [
        { id: "a1", text: "Check 1", pass: true, reasoning: "OK" },
        { id: "a2", text: "Check 2", pass: true, reasoning: "OK" },
      ],
    },
  ],
  ...overrides,
});

describe("benchmark-history", () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `vskill-history-${Date.now()}`);
    mkdirSync(join(testDir, "evals"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("writeHistoryEntry", () => {
    it("writes history file with filesystem-safe timestamp", async () => {
      const result = mkResult();
      const filename = await writeHistoryEntry(testDir, result);

      expect(filename).toBe("2026-03-08T12-00-00.000Z.json");
      const content = readFileSync(join(testDir, "evals", "history", filename), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.skill_name).toBe("test-skill");
    });

    it("also writes benchmark.json for backward compat", async () => {
      await writeHistoryEntry(testDir, mkResult());
      const bm = readFileSync(join(testDir, "evals", "benchmark.json"), "utf-8");
      expect(JSON.parse(bm).skill_name).toBe("test-skill");
    });

    it("creates history directory if missing", async () => {
      rmSync(join(testDir, "evals"), { recursive: true, force: true });
      const result = mkResult();
      const filename = await writeHistoryEntry(testDir, result);
      expect(filename).toBeTruthy();
    });
  });

  describe("listHistory", () => {
    it("returns empty array when no history directory", async () => {
      const list = await listHistory(join(testDir, "nonexistent"));
      expect(list).toEqual([]);
    });

    it("lists entries sorted reverse-chronologically", async () => {
      const r1 = mkResult({ timestamp: "2026-03-01T10:00:00.000Z" });
      const r2 = mkResult({ timestamp: "2026-03-02T10:00:00.000Z" });
      await writeHistoryEntry(testDir, r1);
      await writeHistoryEntry(testDir, r2);

      const list = await listHistory(testDir);
      expect(list).toHaveLength(2);
      expect(list[0].timestamp).toBe("2026-03-02T10:00:00.000Z");
      expect(list[1].timestamp).toBe("2026-03-01T10:00:00.000Z");
    });

    it("computes pass rate from assertion results", async () => {
      const result = mkResult({
        cases: [
          {
            eval_id: 1,
            eval_name: "test",
            status: "fail",
            error_message: null,
            pass_rate: 0.5,
            assertions: [
              { id: "a1", text: "Check 1", pass: true, reasoning: "OK" },
              { id: "a2", text: "Check 2", pass: false, reasoning: "Fail" },
            ],
          },
        ],
      });
      await writeHistoryEntry(testDir, result);
      const list = await listHistory(testDir);
      expect(list[0].passRate).toBe(0.5);
    });
  });

  describe("readHistoryEntry", () => {
    it("reads a specific history entry by timestamp", async () => {
      await writeHistoryEntry(testDir, mkResult());
      const entry = await readHistoryEntry(testDir, "2026-03-08T12:00:00.000Z");
      expect(entry).not.toBeNull();
      expect(entry!.skill_name).toBe("test-skill");
    });

    it("returns null for nonexistent entry", async () => {
      const entry = await readHistoryEntry(testDir, "1999-01-01T00:00:00.000Z");
      expect(entry).toBeNull();
    });
  });

  describe("computeRegressions", () => {
    it("detects regression (pass → fail)", () => {
      const prev = mkResult({
        cases: [
          {
            eval_id: 1,
            eval_name: "test",
            status: "pass",
            error_message: null,
            pass_rate: 1.0,
            assertions: [{ id: "a1", text: "Check", pass: true, reasoning: "OK" }],
          },
        ],
      });
      const curr = mkResult({
        cases: [
          {
            eval_id: 1,
            eval_name: "test",
            status: "fail",
            error_message: null,
            pass_rate: 0,
            assertions: [{ id: "a1", text: "Check", pass: false, reasoning: "Fail" }],
          },
        ],
      });

      const regressions = computeRegressions(curr, prev);
      expect(regressions).toHaveLength(1);
      expect(regressions[0].change).toBe("regression");
      expect(regressions[0].assertionId).toBe("a1");
    });

    it("detects improvement (fail → pass)", () => {
      const prev = mkResult({
        cases: [
          {
            eval_id: 1,
            eval_name: "test",
            status: "fail",
            error_message: null,
            pass_rate: 0,
            assertions: [{ id: "a1", text: "Check", pass: false, reasoning: "Fail" }],
          },
        ],
      });
      const curr = mkResult({
        cases: [
          {
            eval_id: 1,
            eval_name: "test",
            status: "pass",
            error_message: null,
            pass_rate: 1,
            assertions: [{ id: "a1", text: "Check", pass: true, reasoning: "OK" }],
          },
        ],
      });

      const regressions = computeRegressions(curr, prev);
      expect(regressions).toHaveLength(1);
      expect(regressions[0].change).toBe("improvement");
    });

    it("returns empty array when no changes", () => {
      const result = mkResult();
      expect(computeRegressions(result, result)).toEqual([]);
    });

    it("skips new assertions not present in previous run", () => {
      const prev = mkResult({
        cases: [
          {
            eval_id: 1,
            eval_name: "test",
            status: "pass",
            error_message: null,
            pass_rate: 1,
            assertions: [{ id: "a1", text: "Check", pass: true, reasoning: "OK" }],
          },
        ],
      });
      const curr = mkResult({
        cases: [
          {
            eval_id: 1,
            eval_name: "test",
            status: "pass",
            error_message: null,
            pass_rate: 1,
            assertions: [
              { id: "a1", text: "Check", pass: true, reasoning: "OK" },
              { id: "a2", text: "New", pass: false, reasoning: "Fail" },
            ],
          },
        ],
      });

      const regressions = computeRegressions(curr, prev);
      expect(regressions).toEqual([]);
    });
  });
});
