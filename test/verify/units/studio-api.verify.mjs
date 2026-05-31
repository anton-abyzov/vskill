// U-STUDIO-API-INSTALL-STATE — directly addresses the 0850 UX-trap bug class.
// Starts vskill studio in background, hits GET /api/studio/install-state before
// and after install, asserts the API tells the truth about disk state.
import { registerUnit, listUnits } from "../registry.mjs";
import { runVskill, installBaseline, startStudio, stopStudio, httpGet, pickPort, simpleValidator } from "../lib/vskill-runner.mjs";

async function snapshotInstallState(port, token, skill) {
  const r = await httpGet(
    `http://127.0.0.1:${port}/api/studio/install-state?skill=${encodeURIComponent(skill)}`,
    { "x-studio-token": token },
  );
  return r.body;
}

registerUnit({
  id: "U-STUDIO-API-INSTALL-STATE",
  command: "GET /api/studio/install-state?skill=hello-world (vskill studio)",
  // 0858: spawns `vskill studio` (a real HTTP server serving the prebuilt
  // bundle) and drives its API. Not hermetic on a bare runner.
  ciSafe: false,
  ciSkipReason: "requires a spawnable vskill studio server (HTTP install-state API)",
  surfaceSchema: simpleValidator({ scenario: "string" }),
  invariants: [
    { id: "studio-started",
      description: "vskill studio process started and responded to /api on HTTP",
      predicate: (s) => s.studioStarted === true },
    { id: "happy-not-installed-before",
      description: "(happy) install-state reports project.installed === false before install",
      predicate: (s) => {
        if (s.scenario !== "happy") return true;
        return s.beforeInstall?.scopes?.project?.installed === false &&
               s.beforeInstall?.scopes?.user?.installed === false;
      } },
    { id: "happy-installed-after",
      description: "(happy) install-state flips project.installed → true after install (truthful API)",
      predicate: (s) => {
        if (s.scenario !== "happy") return true;
        return s.afterInstall?.scopes?.project?.installed === true;
      } },
    { id: "happy-version-reported",
      description: "(happy) after install, scope.project.version is 1.0.0 (matches fixture)",
      predicate: (s) => {
        if (s.scenario !== "happy") return true;
        return s.afterInstall?.scopes?.project?.version === "1.0.0";
      } },
    { id: "probe-survives-bad-skill-name",
      description: "(probe) API does not crash on a never-installed skill name",
      predicate: (s) => s.scenario !== "probe" || s.bogusBody !== undefined },
  ],
  fixtures: [
    {
      id: "happy-install-state-truthful",
      description: "start studio → snapshot before → install → snapshot after — both must reflect disk",
      probe: false,
      act: async (ctx) => {
        const port = await pickPort();
        let child;
        let result = { unit: "U-STUDIO-API-INSTALL-STATE", workdir: ctx.workdir, scenario: "happy", studioStarted: false };
        try {
          const started = await startStudio(ctx, port);
          child = started.child;
          result.studioStarted = true;
          result.studioToken = "*** (redacted)";
          // Lockfile keys by PLUGIN name, not skill name — install-state API expects plugin.
          result.beforeInstall = await snapshotInstallState(port, started.token, "tiny-test-plugin");
          installBaseline(ctx);
          // Re-detect: install-state reads lockfile + filesystem at call time, so re-call works.
          result.afterInstall = await snapshotInstallState(port, started.token, "tiny-test-plugin");
        } finally {
          stopStudio(child);
        }
        return result;
      },
    },
    {
      id: "probe-install-state-bogus-name",
      description: "(probe) ask for a never-installed name — API returns 200 with empty agents",
      probe: true,
      act: async (ctx) => {
        const port = await pickPort();
        let child;
        let result = { unit: "U-STUDIO-API-INSTALL-STATE", workdir: ctx.workdir, scenario: "probe", studioStarted: false };
        try {
          const started = await startStudio(ctx, port);
          child = started.child;
          result.studioStarted = true;
          result.bogusBody = await snapshotInstallState(port, started.token, "no-such-skill-9999");
        } finally {
          stopStudio(child);
        }
        return result;
      },
    },
  ],
});
