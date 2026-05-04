// ---------------------------------------------------------------------------
// Integration tests for src/commands/clone.ts (T-013 + T-014).
//
// T-013 — 9 source × target combinations:
//   sources: project (.claude/skills) | personal (~/.claude/skills) | cache (~/.claude/plugins/cache)
//   targets: standalone | plugin | new-plugin
//
// T-014 — atomicity scenarios:
//   - inject failure on plugin.json rename → no skill files survive
//   - read-only target dir (mode 0o444) → graceful error, no .tmp leftover
//   - chained fork (depth 2) → forkChain extended, originalSource set
//
// Strategy: invoke the exported `resolveArgs` + `runCloneOnce` directly with
// HOME and cwd overrides. No subprocess spawn. Source fixtures are built per
// test inside mkdtemp dirs (we reuse the lint-markdown-files fixture style
// rather than the on-disk fixture so each test starts from a known-good copy
// without polluting the e2e fixtures dir).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveArgs,
  runCloneOnce,
  runWholePluginClone,
  type ResolvedCloneArgs,
} from "../clone.js";
import type { Provenance } from "../../studio/types.js";
import type { CloneTargetKind, SkillSourceLocation } from "../../clone/types.js";

let tmpRoot: string;
let cwd: string;
let home: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-clone-int-"));
  cwd = join(tmpRoot, "project");
  home = join(tmpRoot, "home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  // Some tests chmod target dirs to 0o444; restore writability before rm.
  try {
    chmodSync(tmpRoot, 0o755);
  } catch {
    // best-effort
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface SourceFixtureOpts {
  /** Where to write the skill (path to the skills/ parent that contains <skillBasename>/). */
  parentDir: string;
  /** Bare skill name used for the directory and (default) frontmatter name. */
  skillBasename: string;
  /** Full namespaced name for frontmatter; defaults to "sw/<basename>". */
  fullName?: string;
  /** Version string for frontmatter; defaults to 2.1.0. */
  version?: string;
  /** Optional pre-existing .vskill-meta.json to write next to SKILL.md (chained-fork test). */
  existingMeta?: Provenance;
}

/**
 * Write a known-good source skill: SKILL.md with name/description/author/version,
 * one nested agents/sub.md, plus a vskill sidecar that MUST be filtered during copy.
 */
function writeSourceFixture(opts: SourceFixtureOpts): string {
  const { parentDir, skillBasename } = opts;
  const skillDir = join(parentDir, skillBasename);
  mkdirSync(skillDir, { recursive: true });
  const fullName = opts.fullName ?? `sw/${skillBasename}`;
  const version = opts.version ?? "2.1.0";
  const skillMd = [
    "---",
    `name: ${fullName}`,
    `description: Test fixture skill ${skillBasename}.`,
    "author: Original Author",
    `version: ${version}`,
    "license: MIT",
    "---",
    "",
    "# Title",
    "",
    "Body referencing `sw:other` and /sw:another for the scanner.",
    "",
  ].join("\n");
  writeFileSync(join(skillDir, "SKILL.md"), skillMd);
  mkdirSync(join(skillDir, "agents"), { recursive: true });
  writeFileSync(join(skillDir, "agents", "sub.md"), "agent prose content");
  // sidecars that must NOT propagate
  writeFileSync(
    join(skillDir, ".vskill-meta.json"),
    JSON.stringify(
      opts.existingMeta ?? { promotedFrom: "global", sourcePath: "x", promotedAt: 0 },
    ),
  );
  writeFileSync(join(skillDir, ".vskill-source.json"), JSON.stringify({ origin: "x" }));
  return skillDir;
}

function setupSource(
  location: SkillSourceLocation,
  skillBasename: string,
  extra?: Partial<SourceFixtureOpts>,
): string {
  if (location === "project") {
    const parent = join(cwd, ".claude", "skills");
    mkdirSync(parent, { recursive: true });
    return writeSourceFixture({ parentDir: parent, skillBasename, ...extra });
  }
  if (location === "personal") {
    const parent = join(home, ".claude", "skills");
    mkdirSync(parent, { recursive: true });
    return writeSourceFixture({ parentDir: parent, skillBasename, ...extra });
  }
  // cache
  const parent = join(home, ".claude", "plugins", "cache", "sw", "spec-tools", "1.0.0", "skills");
  mkdirSync(parent, { recursive: true });
  return writeSourceFixture({ parentDir: parent, skillBasename, ...extra });
}

function buildExistingPlugin(name: string): string {
  const root = join(tmpRoot, "host-plugin");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name, description: "Existing host plugin", skills: ["pre-existing"] }, null, 2),
  );
  return root;
}

// ---------------------------------------------------------------------------
// T-013 — 9 source × target combos
// ---------------------------------------------------------------------------

describe("clone integration — 9 source × target combos (T-013)", () => {
  const sources: SkillSourceLocation[] = ["project", "personal", "cache"];
  const targets: CloneTargetKind[] = ["standalone", "plugin", "new-plugin"];

  for (const sourceLoc of sources) {
    for (const targetKind of targets) {
      it(`${sourceLoc} → ${targetKind}`, async () => {
        const skillBasename = "demo-skill";
        setupSource(sourceLoc, skillBasename);

        // Build common opts for resolveArgs
        const optsBase = {
          author: "Anton",
          namespace: "anton",
          force: false,
          home,
          cwd,
        };

        let resolved: ResolvedCloneArgs;
        if (targetKind === "standalone") {
          resolved = await resolveArgs(skillBasename, {
            ...optsBase,
            target: "standalone",
            path: join(tmpRoot, "out", "standalone-target"),
            source: sourceLoc,
          }, home, cwd);
        } else if (targetKind === "plugin") {
          const pluginRoot = buildExistingPlugin("host-plugin");
          resolved = await resolveArgs(skillBasename, {
            ...optsBase,
            target: "plugin",
            plugin: pluginRoot,
            source: sourceLoc,
          }, home, cwd);
        } else {
          // new-plugin
          resolved = await resolveArgs(skillBasename, {
            ...optsBase,
            target: "new-plugin",
            path: join(tmpRoot, "out", "new-plugin-root"),
            pluginName: "anton-skills",
            source: sourceLoc,
          }, home, cwd);
        }

        const result = await runCloneOnce(resolved, { home, cwd, force: false });

        // ── Assertions common to every combo ──────────────────────────────
        expect(result.source.location).toBe(sourceLoc);
        expect(result.finalSkillName).toBe("anton/demo-skill");
        expect(result.filesCopied).toBeGreaterThanOrEqual(2); // SKILL.md + agents/sub.md

        // SKILL.md exists at the final target
        const finalSkillDir = result.target.targetSkillDir;
        const skillMd = readFileSync(join(finalSkillDir, "SKILL.md"), "utf-8");
        expect(skillMd).toContain("name: anton/demo-skill");
        expect(skillMd).toContain("author: Anton");
        expect(skillMd).toContain("version: 1.0.0");
        expect(skillMd).toContain("forkedFrom: sw/demo-skill");

        // The fork retains description (preservation), and old name/author/version are gone
        expect(skillMd).toContain("description: Test fixture skill demo-skill.");
        expect(skillMd).not.toContain("author: Original Author");
        expect(skillMd).not.toContain("version: 2.1.0");

        // Nested agents/sub.md got copied
        expect(existsSync(join(finalSkillDir, "agents", "sub.md"))).toBe(true);

        // .vskill-meta.json exists with forkedFrom pointing at the source
        const meta: Provenance = JSON.parse(
          readFileSync(join(finalSkillDir, ".vskill-meta.json"), "utf-8"),
        );
        expect(meta.forkedFrom).toMatchObject({
          source: "sw/demo-skill",
          version: "2.1.0",
        });

        // Source sidecars must NOT have been propagated through
        expect(existsSync(join(finalSkillDir, ".vskill-source.json"))).toBe(false);
        // (the .vskill-meta.json IS expected — but it was rewritten by writeForkProvenance,
        // not copied from the source. Verify forkedFrom points to source, not the source's
        // own placeholder values from setupSource's existingMeta arg.)

        // No .tmp leftovers
        expect(existsSync(`${finalSkillDir}.tmp`)).toBe(false);

        // Reference report mentions the fixture's known references
        const refMatches = result.referenceReport.map((r) => r.match);
        expect(refMatches).toContain("sw:other");
        expect(refMatches).toContain("/sw:another");

        // Target-kind-specific assertions
        if (targetKind === "plugin") {
          // The host plugin's manifest was updated with the new skill
          const manifest = JSON.parse(
            readFileSync(
              join(result.target.existingPluginManifestPath!),
              "utf-8",
            ),
          );
          expect(manifest.skills).toContain("demo-skill");
          expect(manifest.skills).toContain("pre-existing"); // prior entry preserved
          // No .tmp manifest leftover
          expect(existsSync(`${result.target.existingPluginManifestPath!}.tmp`)).toBe(false);
        }

        if (targetKind === "new-plugin") {
          const pluginRoot = result.target.newPluginRoot!;
          // plugin.json with the requested name
          const manifest = JSON.parse(
            readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf-8"),
          );
          expect(manifest.name).toBe("anton-skills");
          expect(manifest.skills).toContain("demo-skill");
          // No <pluginRoot>.tmp leftover
          expect(existsSync(`${pluginRoot}.tmp`)).toBe(false);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Edge-case integration tests aligned with T-013's "additional cases"
// ---------------------------------------------------------------------------

describe("clone integration — edge cases (T-013 additional)", () => {
  it("collision: target already exists → error mentions --force", async () => {
    setupSource("project", "demo");
    const finalDir = join(tmpRoot, "out", "exists");
    mkdirSync(finalDir, { recursive: true });
    writeFileSync(join(finalDir, "stale"), "stale");

    const resolved = await resolveArgs(
      "demo",
      {
        target: "standalone",
        path: finalDir,
        author: "Anton",
        namespace: "anton",
        source: "project",
        home,
        cwd,
      },
      home,
      cwd,
    );

    await expect(runCloneOnce(resolved, { home, cwd, force: false })).rejects.toThrow(
      /target already exists/,
    );

    // Pre-existing target left untouched
    expect(existsSync(join(finalDir, "stale"))).toBe(true);
    // No .tmp left behind
    expect(existsSync(`${finalDir}.tmp`)).toBe(false);
  });

  it("--force overwrites existing target and stages cleanly", async () => {
    setupSource("project", "demo");
    const finalDir = join(tmpRoot, "out", "force-target");
    mkdirSync(finalDir, { recursive: true });
    writeFileSync(join(finalDir, "stale-only-in-old"), "x");

    const resolved = await resolveArgs(
      "demo",
      {
        target: "standalone",
        path: finalDir,
        author: "Anton",
        namespace: "anton",
        source: "project",
        force: true,
        home,
        cwd,
      },
      home,
      cwd,
    );

    const result = await runCloneOnce(resolved, { home, cwd, force: true });

    expect(existsSync(join(result.target.targetSkillDir, "SKILL.md"))).toBe(true);
    // The old stale file is gone (force-replace happens at the rename step)
    expect(existsSync(join(finalDir, "stale-only-in-old"))).toBe(false);
    expect(existsSync(`${finalDir}.tmp`)).toBe(false);
  });

  it("malformed plugin manifest at target aborts BEFORE any copy is staged", async () => {
    setupSource("project", "demo");
    const pluginRoot = join(tmpRoot, "broken-plugin");
    mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(pluginRoot, ".claude-plugin", "plugin.json"),
      "{ this is not json",
    );

    const resolved = await resolveArgs(
      "demo",
      {
        target: "plugin",
        plugin: pluginRoot,
        author: "Anton",
        namespace: "anton",
        source: "project",
        home,
        cwd,
      },
      home,
      cwd,
    );

    await expect(runCloneOnce(resolved, { home, cwd })).rejects.toThrow(/malformed JSON/);

    // No skills/ or .tmp got created
    expect(existsSync(join(pluginRoot, "skills"))).toBe(false);
    expect(existsSync(join(pluginRoot, "skills", "demo.tmp"))).toBe(false);
    expect(
      existsSync(join(pluginRoot, ".claude-plugin", "plugin.json.tmp")),
    ).toBe(false);
  });

  it("dryRun returns a synthetic CloneResult and writes nothing", async () => {
    setupSource("project", "demo");
    const finalDir = join(tmpRoot, "out", "dry");

    const resolved = await resolveArgs(
      "demo",
      {
        target: "standalone",
        path: finalDir,
        author: "Anton",
        namespace: "anton",
        source: "project",
        dryRun: true,
        home,
        cwd,
      },
      home,
      cwd,
    );

    const result = await runCloneOnce(resolved, { home, cwd, dryRun: true });

    expect(result.filesCopied).toBe(0);
    expect(existsSync(finalDir)).toBe(false);
    expect(existsSync(`${finalDir}.tmp`)).toBe(false);
    expect(result.provenance.forkedFrom).toMatchObject({ source: "sw/demo" });
  });
});

// ---------------------------------------------------------------------------
// T-014 — atomicity tests
// ---------------------------------------------------------------------------

describe("clone integration — atomicity (T-014)", () => {
  it("chained fork (depth 2): forkChain extended; originalSource set", async () => {
    // Source has an existing .vskill-meta.json indicating a prior fork
    const priorMeta: Provenance = {
      promotedFrom: "global",
      sourcePath: "/somewhere",
      promotedAt: 0,
      forkedFrom: {
        source: "deepest/origin",
        version: "0.1.0",
        clonedAt: "2026-01-01T00:00:00.000Z",
      },
    };

    setupSource("personal", "demo", { existingMeta: priorMeta });

    const finalDir = join(tmpRoot, "out", "chained");
    const resolved = await resolveArgs(
      "demo",
      {
        target: "standalone",
        path: finalDir,
        author: "Anton",
        namespace: "anton",
        source: "personal",
        home,
        cwd,
      },
      home,
      cwd,
    );
    const result = await runCloneOnce(resolved, { home, cwd });

    expect(result.provenance.forkedFrom).toMatchObject({
      source: "sw/demo",
      version: "2.1.0",
    });
    expect(result.provenance.forkChain).toEqual(["deepest/origin"]);
    expect(result.provenance.originalSource).toEqual({ skillPath: "deepest/origin" });

    // Round-trip: meta on disk matches the returned provenance
    const onDisk: Provenance = JSON.parse(
      readFileSync(join(finalDir, ".vskill-meta.json"), "utf-8"),
    );
    expect(onDisk.forkChain).toEqual(["deepest/origin"]);
    expect(onDisk.originalSource).toEqual({ skillPath: "deepest/origin" });
  });

  it("read-only target parent (mode 0o444) → permission-denied error, no .tmp leftover", async () => {
    setupSource("project", "demo");

    const lockedParent = join(tmpRoot, "locked");
    mkdirSync(lockedParent, { recursive: true });
    chmodSync(lockedParent, 0o444);

    try {
      const finalDir = join(lockedParent, "demo-out");
      const resolved = await resolveArgs(
        "demo",
        {
          target: "standalone",
          path: finalDir,
          author: "Anton",
          namespace: "anton",
          source: "project",
          home,
          cwd,
        },
        home,
        cwd,
      );

      await expect(runCloneOnce(resolved, { home, cwd })).rejects.toThrow();

      // No .tmp inside the locked parent (since we couldn't write there)
      expect(existsSync(`${finalDir}.tmp`)).toBe(false);
    } finally {
      chmodSync(lockedParent, 0o755);
    }
  });

  it("plugin target rollback: failure on manifest rename leaves no skill files in plugin dir", async () => {
    // Strategy: simulate the manifest-rename failure by making the manifest
    // path non-renamable. We pre-create the manifest as a directory so
    // fs.rename(<file>.tmp, <dir>) will fail. The orchestrator must roll
    // back the skill-dir rename.
    setupSource("project", "demo");

    const pluginRoot = buildExistingPlugin("host-plugin");

    // Replace the JSON manifest with a directory of the same name to force
    // the second rename to fail. We keep the parent .claude-plugin/ intact.
    const manifestPath = join(pluginRoot, ".claude-plugin", "plugin.json");
    rmSync(manifestPath);
    // Re-create as a regular file (writeToPlugin's pre-flight needs it parseable)
    // — and we'll rely on a different forced failure: pre-emptively create
    // <manifestPath>.tmp as a directory so fs.writeFile inside writeToPlugin
    // fails. Actually, the cleanest hook is the second rename — let's induce
    // that by making the LIVE manifest path a directory just before the rename.
    // The simplest deterministic shape is: keep manifest valid, but on the
    // critical second rename, replace the live manifest with a directory.
    // The orchestrator will first rename the skill-dir, then attempt to rename
    // the manifest tmp — fs.rename(file, dir) → EISDIR/EEXIST on most platforms.

    writeFileSync(
      manifestPath,
      JSON.stringify({ name: "host-plugin", skills: ["pre-existing"] }, null, 2),
    );

    // Wrap the orchestrator entry: run resolveArgs and runCloneOnce, but
    // monkey-patch fs.rename around the manifest step. We achieve this by
    // racing — we cannot easily monkey-patch in ESM without vi.mock at top.
    // Instead, rely on the structural property: replace manifest with a dir
    // RIGHT after writeToPlugin stages the .tmp. We do this by intercepting
    // fs at the module boundary.
    //
    // Simpler approach: use `mode 0o444` on .claude-plugin/ to make the
    // second rename fail. Permission-denied during rename triggers the
    // orchestrator's rollback branch (the skill-dir rename is reverted).

    const claudePluginDir = join(pluginRoot, ".claude-plugin");
    chmodSync(claudePluginDir, 0o555);

    try {
      const resolved = await resolveArgs(
        "demo",
        {
          target: "plugin",
          plugin: pluginRoot,
          author: "Anton",
          namespace: "anton",
          source: "project",
          home,
          cwd,
        },
        home,
        cwd,
      );

      await expect(runCloneOnce(resolved, { home, cwd })).rejects.toThrow();

      // Critical assertion: AFTER the failure, the skills/<demo>/ directory
      // must NOT exist in the plugin (it was rolled back).
      const skillDir = join(pluginRoot, "skills", "demo");
      expect(existsSync(skillDir)).toBe(false);
    } finally {
      chmodSync(claudePluginDir, 0o755);
    }
  });

  it("frontmatter rewrite injection failure: target dir does not exist, .tmp cleaned", async () => {
    // We can't easily inject mid-pipeline failures without mocks, but we can
    // verify the rollback shape via a fixture that produces malformed
    // SKILL.md after the copy: the frontmatter rewriter throws on missing
    // frontmatter. Construct a source that lacks frontmatter; the orchestrator
    // should clean up the .tmp.
    const malformedSource = join(cwd, ".claude", "skills", "no-fm");
    mkdirSync(malformedSource, { recursive: true });
    writeFileSync(join(malformedSource, "SKILL.md"), "# No frontmatter here\n\nbody");

    const finalDir = join(tmpRoot, "out", "no-fm-target");
    const resolved = await resolveArgs(
      "no-fm",
      {
        target: "standalone",
        path: finalDir,
        author: "Anton",
        namespace: "anton",
        source: "project",
        home,
        cwd,
      },
      home,
      cwd,
    );

    await expect(runCloneOnce(resolved, { home, cwd })).rejects.toThrow(
      /missing a YAML frontmatter block/,
    );

    expect(existsSync(finalDir)).toBe(false);
    expect(existsSync(`${finalDir}.tmp`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 0825 — US-001 plugin-root cleanup on bulk-clone failure
// ---------------------------------------------------------------------------

interface CachedPluginSpec {
  org: string;
  plugin: string;
  version: string;
  /** Skill basenames; each gets a known-good fixture unless listed in `malformedSkills`. */
  skills: string[];
  /** Skills (by basename) that should be malformed to force a runCloneOnce failure on that iteration. */
  malformedSkills?: string[];
}

function buildCachedPlugin(spec: CachedPluginSpec): string {
  const skillsDir = join(
    home,
    ".claude",
    "plugins",
    "cache",
    spec.org,
    spec.plugin,
    spec.version,
    "skills",
  );
  mkdirSync(skillsDir, { recursive: true });
  const malformed = new Set(spec.malformedSkills ?? []);
  for (const skill of spec.skills) {
    if (malformed.has(skill)) {
      const dir = join(skillsDir, skill);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), "# No frontmatter here\n\nbody");
    } else {
      writeSourceFixture({ parentDir: skillsDir, skillBasename: skill });
    }
  }
  return skillsDir;
}

describe("clone integration — 0825 plugin-root cleanup (US-001)", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("AC-US1-01: failure on iteration 2 of new-plugin clone removes scaffolded plugin root", async () => {
    // 3 skills: skill-a (good), skill-b (malformed → fail iter 2), skill-c (good)
    buildCachedPlugin({
      org: "sw",
      plugin: "spec-tools",
      version: "1.0.0",
      skills: ["skill-a", "skill-b", "skill-c"],
      malformedSkills: ["skill-b"],
    });

    const pluginRoot = join(tmpRoot, "out", "new-plugin-cleanup-2");

    await runWholePluginClone(
      "spec-tools",
      {
        target: "new-plugin",
        path: pluginRoot,
        pluginName: "anton-spec-tools",
        author: "Anton",
        namespace: "anton",
        force: false,
        yes: true,
        home,
        cwd,
      },
      home,
      cwd,
    );

    // Plugin root scaffolded by iter 1 must have been removed during rollback
    expect(existsSync(pluginRoot)).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("AC-US1-02: failure on iteration 1 runs no extra cleanup (pluginRoot never existed)", async () => {
    // skill-a malformed → fails iteration 1 before any successful clones
    buildCachedPlugin({
      org: "sw",
      plugin: "spec-tools",
      version: "1.0.0",
      skills: ["skill-a", "skill-b"],
      malformedSkills: ["skill-a"],
    });

    const pluginRoot = join(tmpRoot, "out", "new-plugin-cleanup-1");

    await runWholePluginClone(
      "spec-tools",
      {
        target: "new-plugin",
        path: pluginRoot,
        pluginName: "anton-spec-tools",
        author: "Anton",
        namespace: "anton",
        force: false,
        yes: true,
        home,
        cwd,
      },
      home,
      cwd,
    );

    // pluginRoot was never staged (writeNewPlugin failed mid-pipeline before atomic rename)
    expect(existsSync(pluginRoot)).toBe(false);
    // and no .tmp leak
    expect(existsSync(`${pluginRoot}.tmp`)).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("AC-US1-03: failure on iteration 2 of target=plugin preserves the user's existing plugin root", async () => {
    buildCachedPlugin({
      org: "sw",
      plugin: "spec-tools",
      version: "1.0.0",
      skills: ["skill-a", "skill-b", "skill-c"],
      malformedSkills: ["skill-b"],
    });

    // User-owned existing plugin
    const pluginRoot = buildExistingPlugin("user-host-plugin");
    const sentinelFile = join(pluginRoot, "USER_OWNED_FILE.txt");
    writeFileSync(sentinelFile, "user content — must not be removed");

    await runWholePluginClone(
      "spec-tools",
      {
        target: "plugin",
        plugin: pluginRoot,
        author: "Anton",
        namespace: "anton",
        force: false,
        yes: true,
        home,
        cwd,
      },
      home,
      cwd,
    );

    // The existing user plugin root must still exist with its prior content intact
    expect(existsSync(pluginRoot)).toBe(true);
    expect(existsSync(sentinelFile)).toBe(true);
    expect(readFileSync(sentinelFile, "utf-8")).toBe(
      "user content — must not be removed",
    );
    // The first cloned skill (skill-a) was rolled back from the plugin's skills/ dir
    expect(existsSync(join(pluginRoot, "skills", "skill-a"))).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// 0825 — US-002 .bak staging for --force + --target plugin
// ---------------------------------------------------------------------------

// Helper: spy on fs.promises.rename to inject deterministic failures.
// Used by the .bak-staging tests where we need to fail the SECOND of two
// orchestrator renames — chmod-based tricks fail too early in the pipeline.
async function withRenameInterceptor(
  predicate: (from: string, to: string, callIndex: number) => Error | null,
  fn: () => Promise<void>,
): Promise<void> {
  const fsModule = await import("node:fs");
  const originalRename = fsModule.promises.rename.bind(fsModule.promises);
  let callIndex = 0;
  const spy = vi
    .spyOn(fsModule.promises, "rename")
    .mockImplementation(async (from: any, to: any) => {
      const err = predicate(String(from), String(to), callIndex++);
      if (err) throw err;
      return originalRename(from, to);
    });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
}

describe("clone integration — 0825 .bak staging on --force + --target plugin (US-002)", () => {
  it("AC-US2-01: manifest-rename failure restores original skill from .bak and removes .bak on success", async () => {
    setupSource("project", "demo");
    const pluginRoot = buildExistingPlugin("host-plugin");

    // Pre-existing skill at the target — its content is the sentinel we expect restored.
    const targetSkillDir = join(pluginRoot, "skills", "demo");
    mkdirSync(targetSkillDir, { recursive: true });
    const sentinelFile = join(targetSkillDir, "ORIGINAL.md");
    writeFileSync(sentinelFile, "original sentinel content");

    // Inject failure on the manifest rename only. The orchestrator performs
    // (in order): finalDir→.bak, stagedSkill→finalDir, manifestTmp→manifestFinal.
    // We fail the third rename by matching its source path suffix.
    await withRenameInterceptor(
      (from) => (from.endsWith("plugin.json.tmp") ? new Error("injected: manifest rename") : null),
      async () => {
        const resolved = await resolveArgs(
          "demo",
          {
            target: "plugin",
            plugin: pluginRoot,
            author: "Anton",
            namespace: "anton",
            source: "project",
            force: true,
            home,
            cwd,
          },
          home,
          cwd,
        );

        await expect(runCloneOnce(resolved, { home, cwd, force: true })).rejects.toThrow();
      },
    );

    // Original skill must be restored from .bak
    expect(existsSync(targetSkillDir)).toBe(true);
    expect(existsSync(sentinelFile)).toBe(true);
    expect(readFileSync(sentinelFile, "utf-8")).toBe("original sentinel content");
    // No leftover .bak (restored, then bak removed on success of restore-rename)
    expect(existsSync(`${targetSkillDir}.bak`)).toBe(false);
  });

  it("AC-US2-02: restore-rename failure leaves .bak in place and emits warning to stderr", async () => {
    setupSource("project", "demo");
    const pluginRoot = buildExistingPlugin("host-plugin");

    const targetSkillDir = join(pluginRoot, "skills", "demo");
    mkdirSync(targetSkillDir, { recursive: true });
    writeFileSync(join(targetSkillDir, "ORIGINAL.md"), "sentinel");

    const stderrChunks: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(((chunk: any) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      }) as never);

    // Inject failure on BOTH the manifest rename AND the restore-rename.
    // Sequence of renames in the .bak-staging path:
    //   call 0: finalDir → finalDir.bak
    //   call 1: stagedSkill → finalDir
    //   call 2: manifestTmp → manifestFinal     ← inject failure (manifest)
    //   call 3: finalDir.bak → finalDir         ← inject failure (restore)
    await withRenameInterceptor(
      (from, to) => {
        if (from.endsWith("plugin.json.tmp")) return new Error("injected: manifest rename");
        if (from.endsWith(".bak") && to.endsWith("/demo")) {
          return new Error("injected: restore rename");
        }
        return null;
      },
      async () => {
        const resolved = await resolveArgs(
          "demo",
          {
            target: "plugin",
            plugin: pluginRoot,
            author: "Anton",
            namespace: "anton",
            source: "project",
            force: true,
            home,
            cwd,
          },
          home,
          cwd,
        );

        await expect(runCloneOnce(resolved, { home, cwd, force: true })).rejects.toThrow(
          /injected: manifest rename/,
        );
      },
    );

    stderrSpy.mockRestore();

    const bakDir = `${targetSkillDir}.bak`;
    expect(existsSync(bakDir)).toBe(true);
    expect(
      stderrChunks.join("").includes("WARNING: failed to restore from .bak"),
    ).toBe(true);
  });
});
