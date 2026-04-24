// ---------------------------------------------------------------------------
// T-005 [TDD-RED] — provenance lib unit tests
// AC-US1-04 (sidecar written on promote), AC-US3-03/04 (revert gated by
// provenance presence; read must be safe under ENOENT / parse errors).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { writeProvenance, readProvenance, removeProvenance } from "../provenance.js";
import type { Provenance } from "../../types.js";

let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `vskill-prov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

describe("writeProvenance", () => {
  it("creates .vskill-meta.json with exact shape", async () => {
    const p: Provenance = {
      promotedFrom: "installed",
      sourcePath: "/abs/skill",
      promotedAt: 1700000000000,
      sourceSkillVersion: "1.2.3",
    };
    await writeProvenance(dir, p);

    const raw = readFileSync(join(dir, ".vskill-meta.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(p);
  });
});

describe("readProvenance", () => {
  it("returns the stored Provenance object", async () => {
    const p: Provenance = {
      promotedFrom: "global",
      sourcePath: "/x",
      promotedAt: 42,
    };
    writeFileSync(join(dir, ".vskill-meta.json"), JSON.stringify(p), "utf-8");

    const got = await readProvenance(dir);
    expect(got).toEqual(p);
  });

  it("returns null on ENOENT without throwing", async () => {
    const got = await readProvenance(dir);
    expect(got).toBeNull();
  });

  it("returns null on JSON parse error without throwing", async () => {
    writeFileSync(join(dir, ".vskill-meta.json"), "not json {", "utf-8");
    const got = await readProvenance(dir);
    expect(got).toBeNull();
  });
});

describe("removeProvenance", () => {
  it("deletes the sidecar file", async () => {
    writeFileSync(join(dir, ".vskill-meta.json"), "{}", "utf-8");
    expect(existsSync(join(dir, ".vskill-meta.json"))).toBe(true);

    await removeProvenance(dir);
    expect(existsSync(join(dir, ".vskill-meta.json"))).toBe(false);
  });

  it("is idempotent — no throw when file is already missing", async () => {
    await expect(removeProvenance(dir)).resolves.toBeUndefined();
  });
});
