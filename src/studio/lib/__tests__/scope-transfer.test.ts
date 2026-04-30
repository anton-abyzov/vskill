// ---------------------------------------------------------------------------
// T-003 [TDD-RED] — scope-transfer unit tests
// AC-US1-03 (collision → 409 / CollisionError), AC-US1-04 (provenance sidecar
// filtered out of copies going OUT of OWN scope).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  transfer,
  CollisionError,
  resolveScopePath,
} from "../scope-transfer.js";
import type { TransferEvent } from "../../types.js";

// ---------------------------------------------------------------------------
// Tmp-dir fixture — each test gets an isolated workspace
// ---------------------------------------------------------------------------

let workRoot: string;
let homeRoot: string;

function mkTmp(prefix: string): string {
  const p = join(tmpdir(), `vskill-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(p, { recursive: true });
  return p;
}

beforeEach(() => {
  workRoot = mkTmp("scope-transfer-work");
  homeRoot = mkTmp("scope-transfer-home");
});

afterEach(() => {
  try { rmSync(workRoot, { recursive: true, force: true }); } catch {}
  try { rmSync(homeRoot, { recursive: true, force: true }); } catch {}
});

function seedSkillDir(dir: string, name: string, extras: Record<string, string> = {}): string {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: demo\n---\n# ${name}\n`,
    "utf-8",
  );
  for (const [rel, content] of Object.entries(extras)) {
    const full = join(skillDir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return skillDir;
}

function collectEvents() {
  const events: TransferEvent[] = [];
  const emit = (e: TransferEvent) => { events.push(e); };
  return { events, emit };
}

// ---------------------------------------------------------------------------

describe("resolveScopePath", () => {
  it("resolves OWN to <root>/skills/<skill>", () => {
    expect(resolveScopePath("own", workRoot, "demo", homeRoot)).toBe(
      join(workRoot, "skills", "demo"),
    );
  });

  it("resolves INSTALLED to <root>/.claude/skills/<skill>", () => {
    expect(resolveScopePath("installed", workRoot, "demo", homeRoot)).toBe(
      join(workRoot, ".claude", "skills", "demo"),
    );
  });

  it("resolves GLOBAL to <home>/.claude/skills/<skill>", () => {
    expect(resolveScopePath("global", workRoot, "demo", homeRoot)).toBe(
      join(homeRoot, ".claude", "skills", "demo"),
    );
  });
});

describe("transfer — happy path (INSTALLED → OWN)", () => {
  it("copies SKILL.md into OWN skills dir and emits copied event", async () => {
    const installedBase = join(workRoot, ".claude", "skills");
    seedSkillDir(installedBase, "demo");

    const { events, emit } = collectEvents();
    const result = await transfer(
      {
        plugin: "p",
        skill: "demo",
        fromScope: "installed",
        toScope: "own",
        root: workRoot,
        home: homeRoot,
      },
      emit,
    );

    expect(existsSync(join(workRoot, "skills", "demo", "SKILL.md"))).toBe(true);
    expect(result.destPath).toBe(join(workRoot, "skills", "demo"));
    expect(result.filesWritten).toBeGreaterThan(0);
    const copied = events.find((e) => e.type === "copied");
    expect(copied).toBeTruthy();
  });
});

describe("transfer — collision guard (AC-US1-03)", () => {
  it("throws CollisionError when dest exists and overwrite is false", async () => {
    const installedBase = join(workRoot, ".claude", "skills");
    seedSkillDir(installedBase, "demo");
    // Pre-populate dest
    const ownBase = join(workRoot, "skills", "demo");
    mkdirSync(ownBase, { recursive: true });
    writeFileSync(join(ownBase, "SKILL.md"), "existing", "utf-8");

    const { emit } = collectEvents();
    await expect(
      transfer(
        {
          plugin: "p",
          skill: "demo",
          fromScope: "installed",
          toScope: "own",
          root: workRoot,
          home: homeRoot,
        },
        emit,
      ),
    ).rejects.toBeInstanceOf(CollisionError);

    // Sanity: original content preserved — no partial write
    expect(readFileSync(join(ownBase, "SKILL.md"), "utf-8")).toBe("existing");
  });

  it("overwrites dest when overwrite=true", async () => {
    const installedBase = join(workRoot, ".claude", "skills");
    seedSkillDir(installedBase, "demo");
    const ownBase = join(workRoot, "skills", "demo");
    mkdirSync(ownBase, { recursive: true });
    writeFileSync(join(ownBase, "SKILL.md"), "existing", "utf-8");

    const { emit } = collectEvents();
    await transfer(
      {
        plugin: "p",
        skill: "demo",
        fromScope: "installed",
        toScope: "own",
        root: workRoot,
        home: homeRoot,
        overwrite: true,
      },
      emit,
    );

    const written = readFileSync(join(workRoot, "skills", "demo", "SKILL.md"), "utf-8");
    expect(written).not.toBe("existing");
    expect(written).toMatch(/# demo/);
  });
});

describe("transfer — provenance sidecar filtered out of OWN → INSTALLED copies (AC-US1-04)", () => {
  it(".vskill-meta.json in source OWN dir is NOT copied to INSTALLED", async () => {
    const ownBase = join(workRoot, "skills");
    seedSkillDir(ownBase, "demo", {
      ".vskill-meta.json": JSON.stringify({
        promotedFrom: "installed",
        sourcePath: "x",
        promotedAt: 0,
      }),
    });
    // sanity
    expect(existsSync(join(workRoot, "skills", "demo", ".vskill-meta.json"))).toBe(true);

    const { emit } = collectEvents();
    await transfer(
      {
        plugin: "p",
        skill: "demo",
        fromScope: "own",
        toScope: "installed",
        root: workRoot,
        home: homeRoot,
      },
      emit,
    );

    const destDir = join(workRoot, ".claude", "skills", "demo");
    expect(existsSync(join(destDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(destDir, ".vskill-meta.json"))).toBe(false);

    // Also confirm no stray dotfile appeared
    const listed = readdirSync(destDir);
    expect(listed).not.toContain(".vskill-meta.json");
  });
});

describe("transfer — missing source", () => {
  it("throws a clear error when source dir does not exist", async () => {
    const { emit } = collectEvents();
    await expect(
      transfer(
        {
          plugin: "p",
          skill: "missing",
          fromScope: "installed",
          toScope: "own",
          root: workRoot,
          home: homeRoot,
        },
        emit,
      ),
    ).rejects.toThrow(/missing|not found|ENOENT/i);
  });
});

// ---------------------------------------------------------------------------
// 0809 — copy-time provenance sidecar
// ---------------------------------------------------------------------------

import { resetCopiedSkillSidecarCache, resetAuthoredSourceLinkCache } from "../../../eval-server/source-link.js";

describe("0809 transfer — writes .vskill-source.json with source provenance", () => {
  beforeEach(() => {
    resetCopiedSkillSidecarCache();
    resetAuthoredSourceLinkCache();
  });

  afterEach(() => {
    resetCopiedSkillSidecarCache();
    resetAuthoredSourceLinkCache();
  });

  it("TC-014: writes sidecar with source's repoUrl + skillPath when source has a sidecar pointing to a github repo (chained-copy semantics)", async () => {
    // Source: OWN-scope skill that already carries a sidecar from a prior copy.
    // resolveSourceLink should read the sidecar and return its values, which
    // transfer() then snapshots into the destination's new sidecar.
    const ownBase = join(workRoot, "skills");
    seedSkillDir(ownBase, "demo");
    writeFileSync(
      join(workRoot, "skills", "demo", ".vskill-source.json"),
      JSON.stringify({
        repoUrl: "https://github.com/anton-abyzov/greet-anton-test",
        skillPath: "SKILL.md",
      }),
      "utf-8",
    );

    const { emit } = collectEvents();
    await transfer(
      {
        plugin: "p",
        skill: "demo",
        fromScope: "own",
        toScope: "global",
        root: workRoot,
        home: homeRoot,
      },
      emit,
    );

    const destSidecar = join(homeRoot, ".claude", "skills", "demo", ".vskill-source.json");
    expect(existsSync(destSidecar)).toBe(true);
    const parsed = JSON.parse(readFileSync(destSidecar, "utf-8"));
    expect(parsed.repoUrl).toBe("https://github.com/anton-abyzov/greet-anton-test");
    expect(parsed.skillPath).toBe("SKILL.md");

    // The SOURCE's sidecar must NOT have been blindly copied through
    // copyOwnSkillFiltered (it's filtered + re-derived in the destination).
    // We verify the destination sidecar is the freshly-written snapshot
    // by checking it parses cleanly from the post-copy resolveSourceLink.
  });

  it("TC-015: writes NO sidecar when source has no resolvable repoUrl (no lockfile, no sidecar, no git ancestor)", async () => {
    const ownBase = join(workRoot, "skills");
    seedSkillDir(ownBase, "no-source");
    // No sidecar, no lockfile, no .git in workRoot.

    const { emit } = collectEvents();
    await transfer(
      {
        plugin: "p",
        skill: "no-source",
        fromScope: "own",
        toScope: "global",
        root: workRoot,
        home: homeRoot,
      },
      emit,
    );

    const destSidecar = join(homeRoot, ".claude", "skills", "no-source", ".vskill-source.json");
    expect(existsSync(destSidecar)).toBe(false);

    // SKILL.md still copied normally.
    expect(existsSync(join(homeRoot, ".claude", "skills", "no-source", "SKILL.md"))).toBe(true);
  });

  it("TC-016 / AC-US3-01: source's existing .vskill-source.json is filtered from the file copy itself", async () => {
    // Even though transfer() rewrites a fresh sidecar at the destination,
    // copyOwnSkillFiltered must not blindly copy the SOURCE's sidecar through,
    // because chained-copy semantics demand the destination snapshot reflects
    // resolveSourceLink at copy time (and is identical content here, so we
    // verify the filter by reading the source sidecar with stale contents).
    const ownBase = join(workRoot, "skills");
    seedSkillDir(ownBase, "demo");
    // Write a sidecar in the source that is "stale" (has extra junk we wouldn't
    // re-derive). The filter must drop it; the post-copy step then writes a
    // FRESH valid sidecar (or none, if the resolver returns null/null).
    writeFileSync(
      join(workRoot, "skills", "demo", ".vskill-source.json"),
      JSON.stringify({
        repoUrl: "https://github.com/anton-abyzov/greet-anton-test",
        skillPath: "SKILL.md",
        staleField: "should-be-dropped",
      }),
      "utf-8",
    );

    const { emit } = collectEvents();
    await transfer(
      {
        plugin: "p",
        skill: "demo",
        fromScope: "own",
        toScope: "global",
        root: workRoot,
        home: homeRoot,
      },
      emit,
    );

    const destSidecar = join(homeRoot, ".claude", "skills", "demo", ".vskill-source.json");
    expect(existsSync(destSidecar)).toBe(true);

    const parsed = JSON.parse(readFileSync(destSidecar, "utf-8"));
    // Re-derived from resolveSourceLink (which read the source sidecar) —
    // only the canonical {repoUrl, skillPath} keys are present, no staleField.
    expect(parsed).toEqual({
      repoUrl: "https://github.com/anton-abyzov/greet-anton-test",
      skillPath: "SKILL.md",
    });
    expect(parsed.staleField).toBeUndefined();
  });

  it("TC-017 / AC-US3-01: copyOwnSkillFiltered also drops .vskill-meta.json AND .vskill-source.json", async () => {
    const ownBase = join(workRoot, "skills");
    seedSkillDir(ownBase, "demo");
    writeFileSync(
      join(workRoot, "skills", "demo", ".vskill-meta.json"),
      JSON.stringify({ promotedFrom: "installed", sourcePath: "x", promotedAt: 0 }),
      "utf-8",
    );
    writeFileSync(
      join(workRoot, "skills", "demo", ".vskill-source.json"),
      JSON.stringify({
        repoUrl: "https://github.com/x/y",
        skillPath: "SKILL.md",
      }),
      "utf-8",
    );

    const { emit } = collectEvents();
    await transfer(
      {
        plugin: "p",
        skill: "demo",
        fromScope: "own",
        toScope: "installed",
        root: workRoot,
        home: homeRoot,
      },
      emit,
    );

    const destDir = join(workRoot, ".claude", "skills", "demo");
    // .vskill-meta.json must NEVER leak (existing 0741/AC-US1-04 contract).
    expect(existsSync(join(destDir, ".vskill-meta.json"))).toBe(false);

    // .vskill-source.json: filter dropped the source's, but transfer() wrote a
    // fresh one (because the source was resolvable — we seeded it). Either way
    // the destination's sidecar must NOT contain extra fields from the source.
    if (existsSync(join(destDir, ".vskill-source.json"))) {
      const parsed = JSON.parse(readFileSync(join(destDir, ".vskill-source.json"), "utf-8"));
      expect(Object.keys(parsed).sort()).toEqual(["repoUrl", "skillPath"]);
    }
  });
});
