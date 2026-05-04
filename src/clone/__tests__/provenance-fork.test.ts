// ---------------------------------------------------------------------------
// Unit tests for src/clone/provenance-fork.ts (T-011, AC-US5-01, AC-US5-02,
// AC-US5-03).
//
// Covers `computeForkProvenance` (pure, no fs) and `writeForkProvenance`
// (writes through the existing provenance helper to a real tmpdir). Verifies:
//   - first-fork case: forkedFrom set; no forkChain
//   - chained-fork case: forkChain extended; originalSource carried forward
//   - synthesized originalSource when source had a chain but no originalSource
//   - existing Provenance fields unaffected by the fork-specific extensions
//   - sidecar JSON written via writeProvenance is round-trippable via readProvenance
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeForkProvenance,
  writeForkProvenance,
} from "../provenance-fork.js";
import type { Provenance } from "../../studio/types.js";
import type { ForkProvenance } from "../types.js";

let tmpRoot: string;
let targetDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-provenance-fork-"));
  targetDir = join(tmpRoot, "target");
  mkdirSync(targetDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const baseFork: ForkProvenance = {
  source: "sw/ado-mapper",
  version: "2.1.0",
  clonedAt: "2026-05-01T12:00:00.000Z",
};

// ---------------------------------------------------------------------------

describe("computeForkProvenance — first-fork (root source)", () => {
  it("sets forkedFrom and leaves forkChain undefined when source has no sidecar", () => {
    const merged = computeForkProvenance({
      forkedFrom: baseFork,
      sourceProvenance: null,
      sourcePath: "/abs/path/to/source",
    });

    expect(merged.forkedFrom).toEqual(baseFork);
    expect(merged.forkChain).toBeUndefined();
    expect(merged.originalSource).toBeUndefined();
  });

  it("populates the existing schema fields with sensible defaults", () => {
    const before = Date.now();
    const merged = computeForkProvenance({
      forkedFrom: baseFork,
      sourceProvenance: null,
      sourcePath: "/abs/source",
      sourceVersion: "2.1.0",
    });
    const after = Date.now();

    expect(merged.promotedFrom).toBe("global");
    expect(merged.sourcePath).toBe("/abs/source");
    expect(merged.sourceSkillVersion).toBe("2.1.0");
    expect(merged.promotedAt).toBeGreaterThanOrEqual(before);
    expect(merged.promotedAt).toBeLessThanOrEqual(after);
  });

  it("falls back to forkedFrom.version when sourceVersion is omitted", () => {
    const merged = computeForkProvenance({
      forkedFrom: { ...baseFork, version: "9.9.9" },
      sourceProvenance: null,
      sourcePath: "/abs/source",
    });
    expect(merged.sourceSkillVersion).toBe("9.9.9");
  });
});

// ---------------------------------------------------------------------------

describe("computeForkProvenance — chained-fork", () => {
  it("extends forkChain with the source's forkedFrom.source when source was already a fork", () => {
    const sourceProvenance: Provenance = {
      promotedFrom: "global",
      sourcePath: "/somewhere",
      promotedAt: 0,
      forkedFrom: {
        source: "original/skill",
        version: "1.0.0",
        clonedAt: "2026-01-01T00:00:00.000Z",
      },
    };

    const merged = computeForkProvenance({
      forkedFrom: baseFork,
      sourceProvenance,
      sourcePath: "/source/path",
    });

    expect(merged.forkedFrom).toEqual(baseFork);
    expect(merged.forkChain).toEqual(["original/skill"]);
  });

  it("carries originalSource forward unchanged when present on source sidecar", () => {
    const sourceProvenance: Provenance = {
      promotedFrom: "global",
      sourcePath: "/somewhere",
      promotedAt: 0,
      forkedFrom: {
        source: "intermediate/skill",
        version: "2.0.0",
        clonedAt: "2026-02-01T00:00:00.000Z",
      },
      originalSource: {
        repoUrl: "https://github.com/root/repo",
        skillPath: "skills/root-skill",
      },
      forkChain: ["root/skill"],
    };

    const merged = computeForkProvenance({
      forkedFrom: baseFork,
      sourceProvenance,
      sourcePath: "/source/path",
    });

    expect(merged.originalSource).toEqual({
      repoUrl: "https://github.com/root/repo",
      skillPath: "skills/root-skill",
    });
    expect(merged.forkChain).toEqual(["root/skill", "intermediate/skill"]);
  });

  it("synthesizes originalSource from the chain head when source has chain but no originalSource", () => {
    const sourceProvenance: Provenance = {
      promotedFrom: "global",
      sourcePath: "/somewhere",
      promotedAt: 0,
      forkedFrom: {
        source: "intermediate/skill",
        version: "2.0.0",
        clonedAt: "2026-02-01T00:00:00.000Z",
      },
      forkChain: ["root/skill"],
    };

    const merged = computeForkProvenance({
      forkedFrom: baseFork,
      sourceProvenance,
      sourcePath: "/source/path",
    });

    expect(merged.originalSource).toEqual({ skillPath: "root/skill" });
    expect(merged.forkChain).toEqual(["root/skill", "intermediate/skill"]);
  });

  it("appends to a multi-entry chain (depth >= 3) without losing prior entries", () => {
    const sourceProvenance: Provenance = {
      promotedFrom: "global",
      sourcePath: "/somewhere",
      promotedAt: 0,
      forkedFrom: {
        source: "user-c/skill",
        version: "3.0.0",
        clonedAt: "2026-03-01T00:00:00.000Z",
      },
      forkChain: ["root/skill", "user-a/skill", "user-b/skill"],
    };

    const merged = computeForkProvenance({
      forkedFrom: baseFork,
      sourceProvenance,
      sourcePath: "/source/path",
    });

    expect(merged.forkChain).toEqual([
      "root/skill",
      "user-a/skill",
      "user-b/skill",
      "user-c/skill",
    ]);
  });

  it("does NOT inherit the source's promotedFrom or sourcePath (those are the source's own lineage)", () => {
    const sourceProvenance: Provenance = {
      promotedFrom: "installed",
      sourcePath: "/source/own/path",
      promotedAt: 1,
      forkedFrom: {
        source: "original/skill",
        version: "1.0.0",
        clonedAt: "2026-01-01T00:00:00.000Z",
      },
    };

    const merged = computeForkProvenance({
      forkedFrom: baseFork,
      sourceProvenance,
      sourcePath: "/fork/source/path",
    });

    expect(merged.promotedFrom).toBe("global");
    expect(merged.sourcePath).toBe("/fork/source/path");
  });
});

// ---------------------------------------------------------------------------

describe("writeForkProvenance — disk side effects", () => {
  it("writes a .vskill-meta.json sidecar that is round-trippable", async () => {
    const result = await writeForkProvenance({
      targetSkillDir: targetDir,
      forkedFrom: baseFork,
      sourceProvenance: null,
      sourcePath: "/abs/source",
    });

    const sidecarPath = join(targetDir, ".vskill-meta.json");
    expect(existsSync(sidecarPath)).toBe(true);

    const onDisk = JSON.parse(readFileSync(sidecarPath, "utf-8")) as Provenance;
    expect(onDisk.forkedFrom).toEqual(baseFork);
    expect(onDisk.promotedFrom).toBe("global");
    expect(onDisk.sourcePath).toBe("/abs/source");

    // computeForkProvenance + writeProvenance must agree on what went to disk.
    expect(onDisk.forkedFrom).toEqual(result.forkedFrom);
  });

  it("reads the source sidecar when sourceSkillDir is provided and sourceProvenance is undefined", async () => {
    const sourceDir = join(tmpRoot, "source");
    mkdirSync(sourceDir, { recursive: true });
    const sourceMeta: Provenance = {
      promotedFrom: "global",
      sourcePath: "/orig",
      promotedAt: 1,
      forkedFrom: {
        source: "deepest/origin",
        version: "0.1.0",
        clonedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    writeFileSync(join(sourceDir, ".vskill-meta.json"), JSON.stringify(sourceMeta));

    const result = await writeForkProvenance({
      targetSkillDir: targetDir,
      forkedFrom: baseFork,
      sourceSkillDir: sourceDir,
      sourcePath: sourceDir,
    });

    expect(result.forkChain).toEqual(["deepest/origin"]);
    expect(result.originalSource).toEqual({ skillPath: "deepest/origin" });
  });

  it("treats a missing source sidecar as a root source (no chain)", async () => {
    const sourceDir = join(tmpRoot, "source-no-meta");
    mkdirSync(sourceDir, { recursive: true });

    const result = await writeForkProvenance({
      targetSkillDir: targetDir,
      forkedFrom: baseFork,
      sourceSkillDir: sourceDir,
      sourcePath: sourceDir,
    });

    expect(result.forkedFrom).toEqual(baseFork);
    expect(result.forkChain).toBeUndefined();
    expect(result.originalSource).toBeUndefined();
  });
});
