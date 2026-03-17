import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeActivationRun,
  listActivationRuns,
  getActivationRun,
} from "../activation-history.js";
import type { ActivationHistoryRun } from "../activation-history.js";

let testDir: string;

const mkRun = (overrides: Partial<ActivationHistoryRun> = {}): ActivationHistoryRun => ({
  id: `run-${Date.now()}`,
  timestamp: new Date().toISOString(),
  model: "test-model",
  provider: "test-provider",
  promptCount: 4,
  summary: {
    precision: 1.0,
    recall: 1.0,
    reliability: 1.0,
    tp: 2,
    tn: 2,
    fp: 0,
    fn: 0,
  },
  results: [
    {
      prompt: "test prompt",
      expected: "should_activate",
      activate: true,
      confidence: "high",
      reasoning: "test",
      classification: "TP",
    },
  ],
  ...overrides,
});

describe("activation-history", () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `vskill-act-hist-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("writeActivationRun", () => {
    it("creates activation-history.json if it does not exist", async () => {
      const run = mkRun({ id: "run-100" });
      await writeActivationRun(testDir, run);

      const content = readFileSync(join(testDir, "activation-history.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.runs).toHaveLength(1);
      expect(parsed.runs[0].id).toBe("run-100");
    });

    it("appends to existing history", async () => {
      await writeActivationRun(testDir, mkRun({ id: "run-1" }));
      await writeActivationRun(testDir, mkRun({ id: "run-2" }));

      const content = readFileSync(join(testDir, "activation-history.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.runs).toHaveLength(2);
      expect(parsed.runs[0].id).toBe("run-1");
      expect(parsed.runs[1].id).toBe("run-2");
    });

    it("preserves all required schema fields", async () => {
      const run = mkRun({
        id: "run-schema",
        model: "claude-sonnet",
        provider: "claude-cli",
        promptCount: 6,
      });
      await writeActivationRun(testDir, run);

      const content = readFileSync(join(testDir, "activation-history.json"), "utf-8");
      const parsed = JSON.parse(content);
      const stored = parsed.runs[0];
      expect(stored.id).toBe("run-schema");
      expect(stored.timestamp).toBeDefined();
      expect(stored.model).toBe("claude-sonnet");
      expect(stored.provider).toBe("claude-cli");
      expect(stored.promptCount).toBe(6);
      expect(stored.summary.precision).toBe(1.0);
      expect(stored.results).toHaveLength(1);
    });
  });

  describe("50-run cap", () => {
    it("prunes oldest runs when exceeding 50", async () => {
      // Write 51 runs
      for (let i = 0; i < 51; i++) {
        await writeActivationRun(testDir, mkRun({ id: `run-${i}` }));
      }

      const content = readFileSync(join(testDir, "activation-history.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.runs).toHaveLength(50);
      // Oldest (run-0) should be evicted; run-1 is now the oldest
      expect(parsed.runs[0].id).toBe("run-1");
      expect(parsed.runs[49].id).toBe("run-50");
    });
  });

  describe("listActivationRuns", () => {
    it("returns empty array when no history exists", async () => {
      const runs = await listActivationRuns(testDir);
      expect(runs).toEqual([]);
    });

    it("returns summaries without results array", async () => {
      await writeActivationRun(testDir, mkRun({ id: "run-list" }));
      const runs = await listActivationRuns(testDir);

      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe("run-list");
      expect((runs[0] as any).results).toBeUndefined();
    });

    it("returns runs in reverse chronological order", async () => {
      await writeActivationRun(testDir, mkRun({ id: "run-old" }));
      await writeActivationRun(testDir, mkRun({ id: "run-new" }));
      const runs = await listActivationRuns(testDir);

      expect(runs[0].id).toBe("run-new");
      expect(runs[1].id).toBe("run-old");
    });
  });

  describe("getActivationRun", () => {
    it("returns full run by id including results", async () => {
      await writeActivationRun(testDir, mkRun({ id: "run-get" }));
      const run = await getActivationRun(testDir, "run-get");

      expect(run).not.toBeNull();
      expect(run!.id).toBe("run-get");
      expect(run!.results).toHaveLength(1);
    });

    it("returns null for non-existent run", async () => {
      const run = await getActivationRun(testDir, "run-nonexistent");
      expect(run).toBeNull();
    });

    it("returns null when no history file exists", async () => {
      const run = await getActivationRun(testDir, "run-any");
      expect(run).toBeNull();
    });
  });
});
