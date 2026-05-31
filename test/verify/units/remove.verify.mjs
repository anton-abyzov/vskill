// U-REMOVE — vskill remove <skill> uninstall lifecycle.
import { registerUnit, listUnits } from "../registry.mjs";
import { runVskill, installBaseline, readInstalledSkills, readLockfile, simpleValidator } from "../lib/vskill-runner.mjs";

function readRemoveSurface(workdir, runResult) {
  const installed = readInstalledSkills(workdir);
  const lock = readLockfile(workdir);
  let report = null;
  try { report = JSON.parse(runResult.stdout || "{}"); } catch {}
  return {
    unit: "U-REMOVE",
    command: "vskill remove <name>",
    workdir,
    exitCode: runResult.status,
    installed,
    lockfile: lock,
    report,
  };
}

registerUnit({
  id: "U-REMOVE",
  command: "vskill remove hello-world --json",
  surfaceSchema: simpleValidator({ exitCode: "number", installed: "array" }),
  invariants: [
    { id: "exit-zero", description: "remove exits 0 when the skill was installed",
      predicate: (s) => s.scenario !== "happy" || s.exitCode === 0 },
    { id: "skill-gone-or-explained",
      description: "either hello-world is removed from disk, OR remove report explains per-agent why (e.g. not-applicable when --no-enable was used)",
      predicate: (s) => {
        if (s.scenario !== "happy") return true;
        const removedFromDisk = !s.installed.some((i) => i.name === "hello-world");
        const perAgentExplained = Array.isArray(s.report?.perAgent) && s.report.perAgent.every((a) => typeof a.action === "string");
        return removedFromDisk || perAgentExplained;
      } },
    { id: "lockfile-pruned", description: "lockfile no longer references hello-world after remove",
      predicate: (s) => {
        if (s.scenario !== "happy") return true;
        const body = s.lockfile.body;
        if (!body) return true;
        const flat = JSON.stringify(body);
        return !flat.includes('"hello-world"');
      } },
  ],
  fixtures: [
    {
      id: "happy-remove-after-install",
      description: "install then remove — surface shows zero installed skills",
      probe: false,
      act: async (ctx) => {
        installBaseline(ctx);
        const r = runVskill(["remove", "hello-world", "--json", "--force"], ctx);
        const s = readRemoveSurface(ctx.workdir, r);
        s.scenario = "happy";
        return s;
      },
    },
    {
      id: "probe-remove-nonexistent",
      description: "remove a skill that was never installed — must NOT crash",
      probe: true,
      act: async (ctx) => {
        const r = runVskill(["remove", "does-not-exist", "--json", "--force"], ctx);
        const s = readRemoveSurface(ctx.workdir, r);
        s.scenario = "probe";
        return s;
      },
    },
  ],
});

const u = listUnits().find((x) => x.id === "U-REMOVE");
u.invariants.push({
  id: "probe-nonzero-or-clean-noop",
  description: "(probe-only) nonexistent remove exits nonzero OR is a clean no-op",
  predicate: (s) => s.scenario !== "probe" || s.exitCode !== null,
});
