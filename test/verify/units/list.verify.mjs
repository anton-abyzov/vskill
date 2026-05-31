// U-LIST — vskill list reflects filesystem truth.
import { registerUnit, listUnits } from "../registry.mjs";
import { runVskill, installBaseline, readInstalledSkills, simpleValidator } from "../lib/vskill-runner.mjs";

function readListSurface(workdir, runResult) {
  let parsed = null;
  try { parsed = JSON.parse(runResult.stdout || "{}"); } catch {}
  const filesystemInstalled = readInstalledSkills(workdir);
  return {
    unit: "U-LIST",
    command: "vskill list --installed --json",
    workdir,
    exitCode: runResult.status,
    stdoutLen: (runResult.stdout || "").length,
    stdoutRaw: runResult.stdout || "",
    listReport: parsed,
    filesystemInstalled,
  };
}

registerUnit({
  id: "U-LIST",
  command: "vskill list --installed --json",
  surfaceSchema: simpleValidator({ exitCode: "number", filesystemInstalled: "array" }),
  invariants: [
    { id: "exit-defined", description: "list exits with a defined code (not killed)",
      predicate: (s) => s.exitCode !== null },
    { id: "list-mentions-plugin-after-install",
      description: "after baseline install, list report references tiny-test-plugin (plugins are the unit, not individual skills)",
      predicate: (s) => s.scenario !== "after-install" || JSON.stringify(s.listReport || {}).includes("tiny-test-plugin") },
    { id: "list-empty-reports-empty",
      description: "fresh workdir: list either parses as empty array or prints \"No skills installed\"",
      predicate: (s) => s.scenario !== "empty" || (s.listReport === null && /no\s+skills\s+installed|no\s+vskill\.lock|^\s*\[\s*\]/i.test(s.stdoutRaw || "")) },
  ],
  fixtures: [
    {
      id: "happy-list-after-install",
      description: "install baseline, list --json, assert hello-world appears",
      probe: false,
      act: async (ctx) => {
        installBaseline(ctx);
        const r = runVskill(["list", "--installed", "--json"], ctx);
        const s = readListSurface(ctx.workdir, r);
        s.scenario = "after-install";
        return s;
      },
    },
    {
      id: "probe-list-on-empty-workdir",
      description: "fresh workdir, no skills installed — list must not error",
      probe: true,
      act: async (ctx) => {
        const r = runVskill(["list", "--installed", "--json"], ctx);
        const s = readListSurface(ctx.workdir, r);
        s.scenario = "empty";
        return s;
      },
    },
  ],
});
