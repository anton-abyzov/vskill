// U-INSTALL — verifies vskill install <source> via a local plugin-dir fixture.
//
// Pattern: every fixture spawns the real vskill bin as a child process with
// CLAUDE_HOME / cwd set to a tmp workdir so nothing leaks into the user's
// real ~/.claude. The surface is { exitCode, installed[], lockfile, ... }
// computed from the filesystem after the run.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { registerUnit } from "../registry.mjs";

// 0857: re-rooted for the in-repo harness location <vskill>/test/verify/units.
const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const VSKILL_BIN = join(REPO_ROOT, "dist/bin.js");
const FIXTURE_SOURCE = join(import.meta.dirname, "..", "fixtures", "tiny-skill-source");

/** Read installed-skills surface from every agent dir vskill writes to. */
function readInstallSurface(workdir, runResult) {
  // vskill 1.0.18 cross-installs to every detected agent. We discover all of
  // them rather than hardcode .claude — the surface MUST reflect reality.
  const AGENT_DIRS = [".claude", ".cursor", ".codex", ".kiro", ".aider", ".pi"];
  /** @type {{agent:string,plugin:string,name:string,path:string,bytes:number,frontmatterName?:string}[]} */
  const installed = [];
  for (const agentDir of AGENT_DIRS) {
    const skillsRoot = join(workdir, agentDir, "skills");
    if (!existsSync(skillsRoot)) continue;
    // Layout: <skillsRoot>/<plugin>/<skill>/SKILL.md  (vskill nests under plugin name)
    for (const plugin of readdirSync(skillsRoot)) {
      const pluginDir = join(skillsRoot, plugin);
      if (!statSync(pluginDir).isDirectory()) continue;
      for (const skill of readdirSync(pluginDir)) {
        const skillMd = join(pluginDir, skill, "SKILL.md");
        if (!existsSync(skillMd)) continue;
        const buf = readFileSync(skillMd, "utf8");
        const fm = /^---\s*\n([\s\S]*?)\n---/m.exec(buf);
        const nameLine = fm ? /^name:\s*(.+)$/m.exec(fm[1]) : null;
        installed.push({
          agent: agentDir,
          plugin,
          name: skill,
          path: skillMd,
          bytes: statSync(skillMd).size,
          frontmatterName: nameLine ? nameLine[1].trim() : undefined,
        });
      }
    }
  }

  // Lockfile location: vskill 1.0.18 writes <workdir>/vskill.lock when --cwd is used.
  const lockCandidates = [
    join(workdir, "vskill.lock"),
    join(workdir, ".specweave", "state", "vskill.lock"),
    join(workdir, ".claude", "vskill.lock"),
  ];
  /** @type {string|null} */
  let lockfilePath = null;
  /** @type {any} */
  let lockfileBody = null;
  for (const p of lockCandidates) {
    if (existsSync(p)) {
      lockfilePath = p;
      try {
        lockfileBody = JSON.parse(readFileSync(p, "utf8"));
      } catch {
        lockfileBody = null;
      }
      break;
    }
  }

  return {
    unit: "U-INSTALL",
    command: "vskill install --plugin-dir <fixture> --plugin tiny-test-plugin --no-enable",
    workdir,
    exitCode: runResult.status,
    stdoutLen: (runResult.stdout || "").length,
    stderrLen: (runResult.stderr || "").length,
    installed,
    lockfile: { path: lockfilePath, entryCount: lockfileBody?.skills?.length ?? lockfileBody?.entries?.length ?? null },
  };
}

/** Invoke vskill install inside workdir with isolated env. */
function runInstall(ctx) {
  const env = {
    ...process.env,
    HOME: ctx.workdir, // critical: redirect ~/.claude lookups
    CLAUDE_HOME: join(ctx.workdir, ".claude"),
    XDG_CONFIG_HOME: join(ctx.workdir, ".config"),
    VSKILL_DISABLE_TELEMETRY: "1",
    NO_COLOR: "1",
    ...ctx.env,
  };
  return spawnSync(
    process.execPath,
    [
      VSKILL_BIN,
      "install",
      "--plugin-dir",
      FIXTURE_SOURCE,
      "--plugin",
      "tiny-test-plugin",
      "--cwd",
      "--no-enable",
      "--yes",
    ],
    { cwd: ctx.workdir, env, encoding: "utf8", timeout: 30000 },
  );
}

registerUnit({
  id: "U-INSTALL",
  command: "vskill install --plugin-dir <local> --plugin tiny-test-plugin --no-enable",
  surfaceSchema: {
    // Inline minimal validator — no Zod dep needed in umbrella.
    safeParse(s) {
      const errs = [];
      if (s?.unit !== "U-INSTALL") errs.push(`unit mismatch: ${s?.unit}`);
      if (typeof s?.exitCode !== "number") errs.push(`exitCode must be number`);
      if (!Array.isArray(s?.installed)) errs.push(`installed must be array`);
      if (!s?.lockfile || typeof s.lockfile !== "object") errs.push(`lockfile missing`);
      return errs.length ? { success: false, error: { issues: errs } } : { success: true, data: s };
    },
  },
  invariants: [
    {
      id: "exit-zero",
      description: "vskill install exits with code 0",
      predicate: (s) => s.exitCode === 0,
    },
    {
      id: "skill-present-in-claude",
      description: "hello-world SKILL.md landed under .claude/skills/tiny-test-plugin/",
      predicate: (s) =>
        s.installed.some(
          (i) => i.agent === ".claude" && i.plugin === "tiny-test-plugin" && i.name === "hello-world" && i.bytes > 0,
        ),
    },
    {
      id: "cross-agent-install",
      description: "vskill cross-installs to ≥4 detected agents (claude/cursor/codex/kiro/aider/pi)",
      predicate: (s) => new Set(s.installed.map((i) => i.agent)).size >= 4,
    },
    {
      id: "frontmatter-name-matches",
      description: "frontmatter name matches the skill directory name",
      predicate: (s) => s.installed.every((i) => !i.frontmatterName || i.frontmatterName === i.name),
    },
    {
      id: "lockfile-written",
      description: "vskill.lock written to workdir",
      predicate: (s) => !!s.lockfile.path,
    },
  ],
  fixtures: [
    {
      id: "happy-fresh-install",
      description: "fresh workdir, single install — surface contains exactly 1 skill",
      probe: false,
      act: async (ctx) => {
        const r = runInstall(ctx);
        return readInstallSurface(ctx.workdir, r);
      },
    },
    {
      id: "probe-double-install-idempotent",
      description: "running install twice in a row leaves exactly 1 entry, not 2",
      probe: true,
      act: async (ctx) => {
        runInstall(ctx); // first run
        const second = runInstall(ctx); // second run — should be idempotent
        const surface = readInstallSurface(ctx.workdir, second);
        // probe assertion baked into surface so invariants see it
        surface.helloWorldCount = surface.installed.filter((i) => i.name === "hello-world").length;
        return surface;
      },
    },
  ],
});

// Probe-specific invariant: registered at module level via push so it runs for both fixtures.
// We append directly to the registered unit's invariants by re-registering would duplicate — instead
// we use a post-registration mutation pattern via the registry's listUnits().
// Simpler: include the probe assertion in the surface and add to invariants list above.
// (Done — `helloWorldCount` is keyed only in probe surface; invariant below tolerates absence.)
import { listUnits } from "../registry.mjs";
const u = listUnits().find((x) => x.id === "U-INSTALL");
u.invariants.push({
  id: "probe-idempotent",
  description: "(probe-only) re-install does not duplicate hello-world per agent",
  predicate: (s) => {
    if (s.helloWorldCount === undefined) return true; // happy fixture — skip
    // hello-world should appear exactly once per agent it landed in.
    const perAgent = {};
    for (const i of s.installed) {
      if (i.name !== "hello-world") continue;
      perAgent[i.agent] = (perAgent[i.agent] || 0) + 1;
    }
    return Object.values(perAgent).every((c) => c === 1);
  },
});
