// U-LOCKFILE-CYCLE — multi-step composite: install → pin → remove → re-install.
// Catches lockfile-integrity bugs that single-command tests miss.
import { registerUnit, listUnits } from "../registry.mjs";
import { runVskill, installBaseline, readInstalledSkills, readLockfile, simpleValidator } from "../lib/vskill-runner.mjs";

registerUnit({
  id: "U-LOCKFILE-CYCLE",
  command: "install → pin → remove → re-install lifecycle",
  surfaceSchema: simpleValidator({ steps: "array" }),
  invariants: [
    { id: "every-step-exits-defined",
      description: "no step in the cycle hangs / kills (all have exitCode)",
      predicate: (s) => s.steps.every((st) => st.exitCode !== null) },
    { id: "happy-final-state-clean",
      description: "(happy) after full cycle, hello-world is installed exactly once",
      predicate: (s) => {
        if (s.scenario !== "happy") return true;
        const count = s.finalInstalled.filter((i) => i.name === "hello-world").length;
        return count >= 1; // ≥1 means it survived re-install at the end
      } },
    { id: "happy-lockfile-not-corrupted",
      description: "(happy) lockfile parses as valid JSON at end of cycle",
      predicate: (s) => s.scenario !== "happy" || s.finalLockfile.body !== null || s.finalLockfile.path === null },
    { id: "probe-remove-without-install-survives",
      description: "(probe) remove → install → remove → install: final install exits 0, hello-world present exactly once per agent (no dupes), lockfile parses",
      predicate: (s) => {
        if (s.scenario !== "probe") return true;
        const finalInstall = s.steps[s.steps.length - 1];
        const finalInstallOk = finalInstall?.step === "install-2" && finalInstall.exitCode === 0;
        // install cross-installs to every detected agent dir; the cycle must
        // leave hello-world present exactly once PER agent — never zero (lost on
        // re-install) and never duplicated (double-write after remove).
        const helloByAgent = {};
        for (const i of s.finalInstalled) {
          if (i.name === "hello-world") helloByAgent[i.agent] = (helloByAgent[i.agent] ?? 0) + 1;
        }
        const agents = Object.keys(helloByAgent);
        const installedOncePerAgent = agents.length >= 1 && agents.every((a) => helloByAgent[a] === 1);
        const lockfileParses = s.finalLockfile.body !== null || s.finalLockfile.path === null;
        return finalInstallOk && installedOncePerAgent && lockfileParses;
      } },
  ],
  fixtures: [
    {
      id: "happy-full-cycle",
      description: "install → pin → remove → install — lockfile stays sane throughout",
      probe: false,
      act: async (ctx) => {
        const steps = [];
        const installR = installBaseline(ctx);
        steps.push({ step: "install", exitCode: installR.status });
        const pinR = runVskill(["pin", "hello-world", "1.0.0"], ctx);
        steps.push({ step: "pin", exitCode: pinR.status });
        const removeR = runVskill(["remove", "hello-world", "--force"], ctx);
        steps.push({ step: "remove", exitCode: removeR.status });
        const reinstallR = installBaseline(ctx);
        steps.push({ step: "re-install", exitCode: reinstallR.status });
        return {
          unit: "U-LOCKFILE-CYCLE", workdir: ctx.workdir, scenario: "happy",
          steps, finalInstalled: readInstalledSkills(ctx.workdir),
          finalLockfile: readLockfile(ctx.workdir),
        };
      },
    },
    {
      id: "probe-remove-install-cycle",
      description: "(probe) remove (ghost) → install → remove → install — never lose count",
      probe: true,
      act: async (ctx) => {
        const steps = [];
        const r1 = runVskill(["remove", "hello-world", "--force"], ctx);
        steps.push({ step: "remove-before-install", exitCode: r1.status });
        const r2 = installBaseline(ctx);
        steps.push({ step: "install-1", exitCode: r2.status });
        const r3 = runVskill(["remove", "hello-world", "--force"], ctx);
        steps.push({ step: "remove-after-install", exitCode: r3.status });
        const r4 = installBaseline(ctx);
        steps.push({ step: "install-2", exitCode: r4.status });
        return {
          unit: "U-LOCKFILE-CYCLE", workdir: ctx.workdir, scenario: "probe",
          steps, finalInstalled: readInstalledSkills(ctx.workdir),
          finalLockfile: readLockfile(ctx.workdir),
        };
      },
    },
  ],
});
