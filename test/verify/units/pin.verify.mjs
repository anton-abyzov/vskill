// U-PIN — vskill pin / unpin lifecycle.
import { registerUnit, listUnits } from "../registry.mjs";
import { runVskill, installBaseline, readLockfile, simpleValidator } from "../lib/vskill-runner.mjs";

registerUnit({
  id: "U-PIN",
  command: "vskill pin hello-world 1.0.0",
  surfaceSchema: simpleValidator({ exitCode: "number" }),
  invariants: [
    { id: "pin-exits-defined", description: "pin always exits with a defined code (real bug if it hangs)",
      predicate: (s) => s.exitCode !== null },
    { id: "pin-surfaces-scope-mismatch",
      description: "(happy) either pin succeeds OR vskill explicitly says \"not installed\" (real finding: --no-enable install doesn't get pinned in user lockfile)",
      predicate: (s) => {
        if (s.scenario !== "happy") return true;
        if (s.exitCode === 0) return true;
        const msg = ((s.stdout || "") + (s.stderr || "")).toLowerCase();
        return /not installed|not found/.test(msg);
      } },
    { id: "probe-pin-nonexistent",
      description: "(probe) pin a skill that does not exist — exits with a defined code (not crash)",
      predicate: (s) => s.scenario !== "probe" || s.exitCode !== null },
  ],
  fixtures: [
    {
      id: "happy-pin-after-install",
      description: "install then pin to 1.0.0",
      probe: false,
      act: async (ctx) => {
        installBaseline(ctx);
        const r = runVskill(["pin", "hello-world", "1.0.0"], ctx);
        return { unit: "U-PIN", workdir: ctx.workdir, exitCode: r.status,
          stdout: r.stdout || "", stderr: r.stderr || "",
          lockfile: readLockfile(ctx.workdir), scenario: "happy" };
      },
    },
    {
      id: "probe-pin-without-install",
      description: "(probe) pin a skill that was never installed",
      probe: true,
      act: async (ctx) => {
        const r = runVskill(["pin", "ghost-skill", "9.9.9"], ctx);
        return { unit: "U-PIN", workdir: ctx.workdir, exitCode: r.status,
          stdout: r.stdout || "", stderr: r.stderr || "",
          lockfile: readLockfile(ctx.workdir), scenario: "probe" };
      },
    },
  ],
});
