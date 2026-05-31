// U-SKILL-NEW — verifies `vskill skill new` produces a SKILL.md with valid
// frontmatter, IN ISOLATION (no install/eval pipeline — that's U-GOLDEN's job).
//
// Spawns the REAL CLI driven by the deterministic `--provider stub` seam (added
// in 0857) in a tmp-isolated HOME, then asserts the EMITTED SKILL.md — never a
// test-written stub. If `skill new` were deleted, the spawn would exit non-zero,
// `findCreatedSkill` would return null, and every invariant would FAIL.

import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { registerUnit } from "../registry.mjs";

// 0857: re-rooted for the in-repo harness location <vskill>/test/verify/units.
const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const VSKILL_BIN = join(REPO_ROOT, "dist/bin.js");

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

/** Find every created SKILL.md under .claude/skills/<slug>/SKILL.md. */
function findCreatedSkills(workdir) {
  const root = join(workdir, ".claude", "skills");
  const out = [];
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    const md = join(root, entry, "SKILL.md");
    if (existsSync(md)) out.push({ slug: entry, path: md, bytes: statSync(md).size });
  }
  return out;
}

/** Drive a single real `vskill skill new` and read the emitted surface. */
function runSkillNew(prompt, workdir) {
  const created = runVskill(
    [
      "skill",
      "new",
      "--prompt",
      prompt,
      "--provider",
      "stub",
      "--model",
      "haiku",
      "--targets",
      "claude-code",
    ],
    workdir,
  );

  const skills = findCreatedSkills(workdir);
  const files = skills.map((s) => {
    const fm = readFrontmatter(s.path);
    return { path: s.path, bytes: s.bytes, frontmatterName: fm.name, slug: s.slug };
  });

  return {
    unit: "U-SKILL-NEW",
    command: "vskill skill new --provider stub --model haiku --targets claude-code",
    exitCode: created.status,
    files,
    divergence: [],
  };
}

registerUnit({
  id: "U-SKILL-NEW",
  command: "vskill skill new --provider stub (isolated emit)",
  surfaceSchema: {
    safeParse(s) {
      const errs = [];
      if (s?.unit !== "U-SKILL-NEW") errs.push(`unit mismatch: ${s?.unit}`);
      if (!Array.isArray(s?.files)) errs.push(`files must be array`);
      if (!Array.isArray(s?.divergence)) errs.push(`divergence must be array`);
      return errs.length ? { success: false, error: { issues: errs } } : { success: true, data: s };
    },
  },
  invariants: [
    {
      id: "cli-exits-clean",
      description: "the real `vskill skill new` exits 0 (proves the command exists & runs)",
      predicate: (s) => s.exitCode === 0,
    },
    {
      id: "one-skill-md",
      description: "exactly one SKILL.md emitted, non-empty",
      predicate: (s) => s.files.length === 1 && s.files[0].bytes > 0,
    },
    {
      id: "frontmatter-has-name",
      description: "the EMITTED frontmatter declares a name",
      predicate: (s) => !!s.files[0]?.frontmatterName,
    },
    {
      id: "frontmatter-name-matches-emit-dir",
      description: "frontmatter name == basename of the created skill directory",
      predicate: (s) => s.files[0]?.frontmatterName === s.files[0]?.slug,
    },
  ],
  fixtures: [
    {
      id: "happy-real-skill-new",
      description: "spawn real `vskill skill new --provider stub` and read the emitted SKILL.md surface",
      probe: false,
      act: async () => {
        const workdir = mkdtempSync(join(tmpdir(), "verify-skill-new-happy-"));
        return runSkillNew("create a deterministic hello greeter skill", workdir);
      },
    },
    {
      // PROBE — an unknown generation provider must surface as BLOCKED, never a
      // silent green. `--provider does-not-exist` exits non-zero and emits no
      // skill; a clean exit + emitted skill here would be a real bug.
      id: "probe-unknown-provider-blocked",
      description: "an unknown generation provider must BLOCK, not pass",
      probe: true,
      expect: "BLOCKED",
      act: async () => {
        const workdir = mkdtempSync(join(tmpdir(), "verify-skill-new-unknown-"));
        const r = runVskill(
          [
            "skill",
            "new",
            "--prompt",
            "x",
            "--provider",
            "does-not-exist",
            "--model",
            "haiku",
            "--targets",
            "claude-code",
          ],
          workdir,
        );
        const skills = findCreatedSkills(workdir);
        if (r.status === 0 && skills.length > 0) {
          return {
            unit: "U-SKILL-NEW",
            command: "probe: unknown provider",
            exitCode: 0,
            files: skills.map((s) => ({ path: s.path, bytes: s.bytes, slug: s.slug })),
            divergence: [],
          };
        }
        throw new Error(
          `unknown provider correctly rejected (exit=${r.status}) — BLOCKED, not a pass`,
        );
      },
    },
  ],
});
