// U-INIT — vskill init agent + lockfile bootstrap.
import { registerUnit, listUnits } from "../registry.mjs";
import { runVskill, readLockfile, simpleValidator } from "../lib/vskill-runner.mjs";

registerUnit({
  id: "U-INIT",
  command: "vskill init",
  surfaceSchema: simpleValidator({ exitCode: "number" }),
  invariants: [
    { id: "exit-zero", description: "init exits 0 on a fresh workdir",
      predicate: (s) => s.exitCode === 0 },
    { id: "first-run-creates-lockfile",
      description: "(happy) first run creates or detects a lockfile",
      predicate: (s) => s.scenario !== "first-run" || s.lockfile?.path !== null || /lockfile|created|detected/i.test(s.stdout) },
    { id: "second-run-idempotent",
      description: "(probe) running init twice exits 0 both times",
      predicate: (s) => s.scenario !== "double" || s.exitCode === 0 },
  ],
  fixtures: [
    {
      id: "happy-init-empty-workdir",
      description: "run init in a fresh workdir, lockfile present after",
      probe: false,
      act: async (ctx) => {
        const r = runVskill(["init"], ctx);
        return { unit: "U-INIT", workdir: ctx.workdir, exitCode: r.status,
          stdout: r.stdout || "", stderr: r.stderr || "",
          lockfile: readLockfile(ctx.workdir), scenario: "first-run" };
      },
    },
    {
      id: "probe-init-twice",
      description: "(probe) init then init again — must not double-write or crash",
      probe: true,
      act: async (ctx) => {
        runVskill(["init"], ctx);
        const r = runVskill(["init"], ctx);
        return { unit: "U-INIT", workdir: ctx.workdir, exitCode: r.status,
          stdout: r.stdout || "", stderr: r.stderr || "",
          lockfile: readLockfile(ctx.workdir), scenario: "double" };
      },
    },
  ],
});
