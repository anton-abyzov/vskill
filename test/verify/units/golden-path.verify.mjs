// U-GOLDEN — the core regression guarantee (0857).
//
// Proves the whole product promise end to end, deterministically, with NO
// network / API key / `claude` binary:
//
//   create-skill  (vskill skill new --provider stub --model <NON-DEFAULT>)
//        ↓
//   install-skill (vskill install --plugin-dir <wrapped> --copy --no-enable)
//        ↓
//   run-skill     (VSKILL_EVAL_PROVIDER=stub VSKILL_EVAL_MODEL=<NON-DEFAULT>
//                  vskill eval init + run)
//
// REGRESSION GUARD: the model that actually ran (benchmark.json `model`) MUST
// equal the model we requested. If a refactor drops the `--model` /
// `--judge-model` flag, `ranModel` falls back to the CLI default ("sonnet") and
// this unit FAILs — which is the entire point.
//
// The non-default model alias is `opus` (the claude-cli default is `sonnet`).

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";

import { registerUnit } from "../registry.mjs";

// 0857: re-rooted for the in-repo harness location <vskill>/test/verify/units.
const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const VSKILL_BIN = join(REPO_ROOT, "dist/bin.js");

const REQUESTED_MODEL = "opus"; // NON-DEFAULT — the CLI default is "sonnet".
const CLI_DEFAULT_MODEL = "sonnet";

/** Spawn vskill in a tmp-isolated HOME/CLAUDE_HOME workdir. */
function runVskill(args, workdir, extraEnv = {}) {
  const env = {
    ...process.env,
    HOME: workdir,
    CLAUDE_HOME: join(workdir, ".claude"),
    XDG_CONFIG_HOME: join(workdir, ".config"),
    VSKILL_DISABLE_TELEMETRY: "1",
    NO_COLOR: "1",
    ...extraEnv,
  };
  return spawnSync(process.execPath, [VSKILL_BIN, ...args], {
    cwd: workdir,
    env,
    encoding: "utf8",
    timeout: 60000,
  });
}

/** Parse the first `---`-fenced frontmatter block of a SKILL.md. */
function readFrontmatter(skillMdPath) {
  const buf = readFileSync(skillMdPath, "utf8");
  const fm = /^---\s*\n([\s\S]*?)\n---/m.exec(buf);
  const fields = {};
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line.trim());
      if (m) fields[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return fields;
}

/** Find the single created SKILL.md under .claude/skills/<slug>/SKILL.md. */
function findCreatedSkill(workdir) {
  const root = join(workdir, ".claude", "skills");
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    const md = join(root, entry, "SKILL.md");
    if (existsSync(md)) return { slug: entry, path: md };
  }
  return null;
}

/**
 * Drive the full create -> install -> run pipeline in an isolated workdir.
 * Returns the assertable surface.
 *
 * @param {string} requestedModel  the model alias we ask for everywhere.
 * @param {string} workdir
 */
function runGoldenPath(requestedModel, workdir) {
  // (a) CREATE — real `vskill skill new` driven by the deterministic stub.
  //     Target claude-code so the `model:` frontmatter is emitted (universal
  //     agents bind the model at the host level and drop it).
  const created = runVskill(
    [
      "skill",
      "new",
      "--prompt",
      "create a deterministic hello greeter skill for the verify harness",
      "--provider",
      "stub",
      "--model",
      requestedModel,
      "--targets",
      "claude-code",
    ],
    workdir,
  );

  const skill = findCreatedSkill(workdir);
  const createSurface = {
    exitCode: created.status,
    slug: skill?.slug ?? null,
    skillMd: skill?.path ?? null,
    frontmatter: skill ? readFrontmatter(skill.path) : {},
  };

  // (b) INSTALL — wrap the created skill into a minimal local plugin-dir, then
  //     install via the real `vskill install` with --copy --no-enable so we do
  //     not need the `claude plugin install` enable hook.
  let installSurface = {
    exitCode: null,
    lockfilePath: null,
    installedSkillMdCount: 0,
  };
  let pluginSrc = null;
  if (skill) {
    pluginSrc = join(workdir, "plugin-src");
    const skillDst = join(pluginSrc, "plugins", "golden-plugin", "skills", skill.slug);
    mkdirSync(join(pluginSrc, ".claude-plugin"), { recursive: true });
    mkdirSync(skillDst, { recursive: true });
    writeFileSync(join(skillDst, "SKILL.md"), readFileSync(skill.path, "utf8"));
    writeFileSync(
      join(pluginSrc, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "golden-marketplace",
        owner: { name: "0857-golden", email: "noreply@example.com" },
        plugins: [
          {
            name: "golden-plugin",
            source: "./plugins/golden-plugin",
            version: "1.0.0",
            description: "0857 golden-path plugin",
            category: "developer-tools",
          },
        ],
      }),
    );
    writeFileSync(
      join(pluginSrc, "plugins", "golden-plugin", "plugin.json"),
      JSON.stringify({
        name: "golden-plugin",
        version: "1.0.0",
        description: "0857 golden-path plugin",
        skills: [`./skills/${skill.slug}`],
      }),
    );

    const installed = runVskill(
      [
        "install",
        "--plugin-dir",
        pluginSrc,
        "--plugin",
        "golden-plugin",
        "--cwd",
        "--copy",
        "--no-enable",
        "--yes",
      ],
      workdir,
    );

    // Lockfile + installed SKILL.md files under .claude/skills.
    const lockCandidates = [
      join(workdir, "vskill.lock"),
      join(workdir, ".specweave", "state", "vskill.lock"),
      join(workdir, ".claude", "vskill.lock"),
    ];
    const lockfilePath = lockCandidates.find((p) => existsSync(p)) ?? null;

    let installedSkillMdCount = 0;
    const claudeSkills = join(workdir, ".claude", "skills");
    if (existsSync(claudeSkills)) {
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (name === "SKILL.md" && statSync(full).size > 0) installedSkillMdCount++;
        }
      };
      walk(claudeSkills);
    }

    installSurface = {
      exitCode: installed.status,
      lockfilePath,
      installedSkillMdCount,
    };
  }

  // (c) RUN — generate evals (stub) then run the eval against the SAME model.
  //     We point --root at the authored plugin source so the eval surface lives
  //     beside the skill we created.
  let runSurface = { ranModel: null, benchmark: { cases: 0, passed: 0 } };
  if (skill && pluginSrc) {
    const target = `golden-plugin/${skill.slug}`;
    const stubEnv = { VSKILL_EVAL_PROVIDER: "stub", VSKILL_EVAL_MODEL: requestedModel };

    runVskill(["eval", "init", target, "--root", pluginSrc], workdir, stubEnv);
    runVskill(["eval", "run", target, "--root", pluginSrc], workdir, stubEnv);

    const benchmarkPath = join(
      pluginSrc,
      "plugins",
      "golden-plugin",
      "skills",
      skill.slug,
      "evals",
      "benchmark.json",
    );
    if (existsSync(benchmarkPath)) {
      const bench = JSON.parse(readFileSync(benchmarkPath, "utf8"));
      const cases = Array.isArray(bench.cases) ? bench.cases.length : 0;
      const passed = Array.isArray(bench.cases)
        ? bench.cases.filter((c) => c.status === "pass").length
        : 0;
      runSurface = { ranModel: bench.model ?? null, benchmark: { cases, passed } };
    }
  }

  return {
    unit: "U-GOLDEN",
    command: "vskill skill new --provider stub --model <m> → install → eval run",
    requestedModel,
    created: createSurface.exitCode === 0 && !!createSurface.slug,
    createSurface,
    installed: installSurface.exitCode === 0 && installSurface.installedSkillMdCount > 0,
    installSurface,
    ranModel: runSurface.ranModel,
    benchmark: runSurface.benchmark,
  };
}

registerUnit({
  id: "U-GOLDEN",
  command: "create-skill → install → run-with-non-default-model (deterministic)",
  surfaceSchema: {
    safeParse(s) {
      const errs = [];
      if (s?.unit !== "U-GOLDEN") errs.push(`unit mismatch: ${s?.unit}`);
      if (typeof s?.requestedModel !== "string") errs.push("requestedModel must be string");
      if (typeof s?.created !== "boolean") errs.push("created must be boolean");
      if (typeof s?.installed !== "boolean") errs.push("installed must be boolean");
      if (!s?.benchmark || typeof s.benchmark !== "object") errs.push("benchmark missing");
      return errs.length ? { success: false, error: { issues: errs } } : { success: true, data: s };
    },
  },
  invariants: [
    {
      id: "skill-created",
      description: "skill new (provider=stub) wrote a SKILL.md with a name",
      predicate: (s) => s.created === true && !!s.createSurface.frontmatter.name,
    },
    {
      id: "model-frontmatter-honored",
      description: "the emitted claude-code SKILL.md carries the requested model in frontmatter",
      predicate: (s) => s.createSurface.frontmatter.model === s.requestedModel,
    },
    {
      id: "skill-installed",
      description: "install produced a lockfile entry + SKILL.md files under .claude/skills",
      predicate: (s) => s.installed === true && !!s.installSurface.lockfilePath,
    },
    {
      id: "benchmark-ran",
      description: "eval run produced a benchmark with ≥1 passing case",
      predicate: (s) => s.benchmark.cases >= 1 && s.benchmark.passed >= 1,
    },
    {
      // THE REGRESSION GUARD — catches a dropped --model / --judge-model flag.
      id: "ran-model-equals-requested",
      description: "ranModel === requestedModel (dropped --model flag would fall back to the default)",
      predicate: (s) => s.ranModel === s.requestedModel,
    },
  ],
  fixtures: [
    {
      id: "happy-create-install-run-opus",
      description: "create(stub,opus) → install → eval run(stub,opus); ranModel must equal opus",
      probe: false,
      act: async () => {
        const workdir = mkdtempSync(join(tmpdir(), "verify-golden-happy-"));
        return runGoldenPath(REQUESTED_MODEL, workdir);
      },
    },
    {
      // PROBE 1 — unknown provider must surface as BLOCKED (act-time throw),
      // never a silent green. `skill new --provider does-not-exist` exits
      // non-zero, so `created` is false and we throw to force BLOCKED.
      id: "probe-unknown-provider-blocked",
      description: "an unknown generation provider must BLOCK, not pass",
      probe: true,
      expect: "BLOCKED",
      act: async () => {
        const workdir = mkdtempSync(join(tmpdir(), "verify-golden-unknown-"));
        const r = runVskill(
          [
            "skill",
            "new",
            "--prompt",
            "x",
            "--provider",
            "does-not-exist",
            "--model",
            REQUESTED_MODEL,
            "--targets",
            "claude-code",
          ],
          workdir,
        );
        const skill = findCreatedSkill(workdir);
        if (r.status === 0 && skill) {
          // The harness only BLOCKs on a thrown error; a clean exit here would
          // be a real bug (unknown provider silently accepted).
          return {
            unit: "U-GOLDEN",
            command: "probe: unknown provider",
            requestedModel: REQUESTED_MODEL,
            created: true,
            createSurface: { frontmatter: {} },
            installed: false,
            installSurface: {},
            ranModel: null,
            benchmark: { cases: 0, passed: 0 },
          };
        }
        throw new Error(
          `unknown provider correctly rejected (exit=${r.status}) — BLOCKED, not a pass`,
        );
      },
    },
    {
      // PROBE 2 — requested-model-ignored must FAIL. We simulate the dropped
      // flag by asking for opus but recording the CLI default as ranModel; the
      // regression-guard invariant must FAIL.
      id: "probe-requested-model-ignored-fails",
      description: "if the run ignores the requested model (falls back to default), the guard FAILs",
      probe: true,
      expect: "FAIL",
      act: async () => ({
        unit: "U-GOLDEN",
        command: "probe: model-ignored",
        requestedModel: REQUESTED_MODEL,
        created: true,
        createSurface: { frontmatter: { name: "x", model: REQUESTED_MODEL } },
        installed: true,
        installSurface: { lockfilePath: "/dev/null" },
        // The lie: the run used the CLI default instead of the requested model.
        ranModel: CLI_DEFAULT_MODEL,
        benchmark: { cases: 1, passed: 1 },
      }),
    },
  ],
});
