// U-INFO — vskill info <skill> produces output mentioning the queried name.
import { registerUnit, listUnits } from "../registry.mjs";
import { runVskill, installBaseline, simpleValidator } from "../lib/vskill-runner.mjs";

registerUnit({
  id: "U-INFO",
  command: "vskill info <name>",
  surfaceSchema: simpleValidator({ exitCode: "number", stdout: "string" }),
  invariants: [
    { id: "exit-defined", description: "info exits with a defined code (registry lookup may fail offline)",
      predicate: (s) => s.exitCode !== null },
    { id: "stdout-mentions-name",
      description: "stdout OR stderr mentions the queried skill name (whether lookup succeeded or not)",
      predicate: (s) => {
        const all = ((s.stdout || "") + (s.stderr || "")).toLowerCase();
        return all.includes(s.scenario === "happy" ? "hello-world" : "no-such-skill");
      } },
    { id: "probe-handles-missing",
      description: "(probe) info on missing skill does NOT hang or segfault — exits within timeout",
      predicate: (s) => s.scenario !== "probe" || s.exitCode !== null },
  ],
  fixtures: [
    {
      id: "happy-info-on-installed",
      description: "install baseline, ask for info on hello-world",
      probe: false,
      act: async (ctx) => {
        installBaseline(ctx);
        const r = runVskill(["info", "hello-world"], ctx);
        return {
          unit: "U-INFO", command: "vskill info hello-world", workdir: ctx.workdir,
          exitCode: r.status, stdout: r.stdout || "", stderr: r.stderr || "",
          scenario: "happy",
        };
      },
    },
    {
      id: "probe-info-on-missing",
      description: "info on a skill that does not exist — must exit cleanly (not crash)",
      probe: true,
      act: async (ctx) => {
        const r = runVskill(["info", "no-such-skill-anywhere-12345"], ctx);
        return {
          unit: "U-INFO", command: "vskill info <missing>", workdir: ctx.workdir,
          exitCode: r.status, stdout: r.stdout || "", stderr: r.stderr || "",
          scenario: "probe",
        };
      },
    },
  ],
});
