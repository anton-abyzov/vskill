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
