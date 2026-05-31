// U-OUTDATED — vskill outdated --json drift detection.
import { registerUnit, listUnits } from "../registry.mjs";
import { runVskill, installBaseline, simpleValidator } from "../lib/vskill-runner.mjs";

registerUnit({
  id: "U-OUTDATED",
  command: "vskill outdated --json",
  surfaceSchema: simpleValidator({ exitCode: "number", stdout: "string" }),
  invariants: [
    { id: "exit-defined", description: "outdated exits with a defined code (not killed)",
      predicate: (s) => s.exitCode !== null },
    { id: "stdout-is-json-or-friendly-empty",
      description: "stdout parses as JSON when --json passed, OR is the friendly \"No skills installed\" message",
      predicate: (s) => {
        const t = (s.stdout || "").trim();
        if (!t) return true;
        if (/^no skills installed/i.test(t)) return true;
        try { JSON.parse(t); return true; } catch { return false; }
      } },
    { id: "happy-no-stale-on-fresh-install",
      description: "(happy) freshly installed skill is NOT reported as outdated",
      predicate: (s) => {
        if (s.scenario !== "happy") return true;
        return !(s.stdout || "").toLowerCase().includes('"outdated"');
      } },
  ],
  fixtures: [
    {
      id: "happy-outdated-after-fresh-install",
      description: "install baseline, outdated --json — expect zero drift",
      probe: false,
      act: async (ctx) => {
        installBaseline(ctx);
        const r = runVskill(["outdated", "--json"], ctx);
        return { unit: "U-OUTDATED", workdir: ctx.workdir, exitCode: r.status,
          stdout: r.stdout || "", stderr: r.stderr || "", scenario: "happy" };
      },
    },
    {
      id: "probe-outdated-empty-workdir",
      description: "(probe) no lockfile at all — must not crash",
      probe: true,
      act: async (ctx) => {
        const r = runVskill(["outdated", "--json"], ctx);
        return { unit: "U-OUTDATED", workdir: ctx.workdir, exitCode: r.status,
          stdout: r.stdout || "", stderr: r.stderr || "", scenario: "probe" };
      },
    },
  ],
});
