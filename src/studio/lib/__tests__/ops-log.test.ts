// ---------------------------------------------------------------------------
// T-013 [TDD-RED] / T-014 [TDD-GREEN] — ops-log lib unit tests
// AC-US4-01 (atomic append, exact schema, one JSON per line, concurrent
//            writes produce parseable lines with no interleaving).
// ---------------------------------------------------------------------------
//
// NOTE: The ops-log impl was written ahead of these tests because the
// promote/test-install/revert routes depend on it. The tests below therefore
// validate the EXISTING impl against the plan.md §2.2 contract; they also
// document the required invariants for future changes.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { appendOp, listOps, subscribe, deleteOp, getLogPath } from "../ops-log.js";
import type { StudioOp } from "../../types.js";

let logDir: string;
let logPath: string;

function makeOp(partial: Partial<StudioOp> = {}): StudioOp {
  return {
    id: partial.id ?? `op-${Math.random().toString(36).slice(2, 10)}`,
    ts: partial.ts ?? Date.now(),
    op: partial.op ?? "promote",
    skillId: partial.skillId ?? "p/demo",
    fromScope: partial.fromScope ?? "installed",
    toScope: partial.toScope ?? "own",
    actor: "studio-ui",
    ...partial,
  };
}

beforeEach(() => {
  logDir = join(tmpdir(), `vskill-ops-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(logDir, { recursive: true });
  logPath = join(logDir, "studio-ops.jsonl");
  process.env.VSKILL_OPS_LOG_PATH = logPath;
});

afterEach(() => {
  try { rmSync(logDir, { recursive: true, force: true }); } catch {}
  delete process.env.VSKILL_OPS_LOG_PATH;
});

describe("getLogPath — env override", () => {
  it("uses VSKILL_OPS_LOG_PATH when set", () => {
    expect(getLogPath()).toBe(logPath);
  });
});

describe("appendOp", () => {
  it("writes exactly one newline-terminated JSON line", async () => {
    const op = makeOp({ id: "a1" });
    await appendOp(op);

    const raw = readFileSync(logPath, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(op);
  });

  it("creates parent directory if absent", async () => {
    const nestedPath = join(logDir, "nested", "deeper", "ops.jsonl");
    process.env.VSKILL_OPS_LOG_PATH = nestedPath;
    await appendOp(makeOp());
    expect(existsSync(nestedPath)).toBe(true);
  });

  it("10 concurrent appends produce 10 parseable lines (no interleaving)", async () => {
    const ops = Array.from({ length: 10 }, (_, i) => makeOp({ id: `concurrent-${i}` }));
    await Promise.all(ops.map((o) => appendOp(o)));

    const raw = readFileSync(logPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(10);
    const parsed = lines.map((l) => JSON.parse(l));
    const ids = new Set(parsed.map((p) => p.id));
    expect(ids.size).toBe(10);
    for (let i = 0; i < 10; i++) expect(ids.has(`concurrent-${i}`)).toBe(true);
  });
});

describe("listOps", () => {
  it("returns newest-first", async () => {
    const old = makeOp({ id: "old", ts: 1000 });
    const mid = makeOp({ id: "mid", ts: 2000 });
    const newest = makeOp({ id: "new", ts: 3000 });
    await appendOp(old);
    await appendOp(mid);
    await appendOp(newest);

    const got = await listOps();
    expect(got.map((o) => o.id)).toEqual(["new", "mid", "old"]);
  });

  it("filters by before=<ts>", async () => {
    await appendOp(makeOp({ id: "old", ts: 1000 }));
    await appendOp(makeOp({ id: "mid", ts: 2000 }));
    await appendOp(makeOp({ id: "new", ts: 3000 }));

    const got = await listOps({ before: 2500 });
    expect(got.map((o) => o.id)).toEqual(["mid", "old"]);
  });

  it("caps with limit", async () => {
    for (let i = 0; i < 5; i++) await appendOp(makeOp({ id: `op-${i}`, ts: i }));
    const got = await listOps({ limit: 2 });
    expect(got).toHaveLength(2);
    expect(got.map((o) => o.id)).toEqual(["op-4", "op-3"]);
  });

  it("returns [] when file missing", async () => {
    // Never wrote to this path — file does not exist.
    expect(existsSync(logPath)).toBe(false);
    const got = await listOps();
    expect(got).toEqual([]);
  });
});

describe("deleteOp (tombstone)", () => {
  it("appends tombstone line, listOps excludes the id", async () => {
    const keep = makeOp({ id: "keep", ts: 1000 });
    const drop = makeOp({ id: "drop", ts: 2000 });
    await appendOp(keep);
    await appendOp(drop);

    await deleteOp("drop");

    const raw = readFileSync(logPath, "utf-8");
    // Original op line NOT removed — log is append-only.
    expect(raw).toContain('"id":"drop"');
    expect(raw).toContain('"tombstone":true');

    const got = await listOps();
    expect(got.map((o) => o.id)).toEqual(["keep"]);
  });
});

describe("subscribe", () => {
  it("callback fires on each appendOp", async () => {
    const seen: StudioOp[] = [];
    const unsub = subscribe((o) => { seen.push(o); });

    await appendOp(makeOp({ id: "s1" }));
    await appendOp(makeOp({ id: "s2" }));
    unsub();
    await appendOp(makeOp({ id: "s3" })); // unsubscribed — should not be seen

    expect(seen.map((o) => o.id)).toEqual(["s1", "s2"]);
  });
});
