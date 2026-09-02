// ---------------------------------------------------------------------------
// Publish-path guard.
//
// The committed `.npmrc` sets ignore-scripts=true to block DEPENDENCY install
// scripts. npm does not scope that flag to dependencies: it also suppresses the
// package's own lifecycle hooks, so `npm publish` skips `prepublishOnly` — the
// build, the eval-ui bundle, the README badge sync and the git guard all vanish
// silently. dist/ is gitignored, so the result is not a stale tarball but an
// EMPTY one: `npm pack --dry-run` on release/2.0 reported 5 entries, none of
// them under dist/, while `bin.vskill` points at ./dist/bin.js. npm publishes
// that with exit 0 and no warning.
//
// npm offers no hook that survives ignore-scripts, so the guard has to live
// here and in CI: this test asserts the publish path is wired to force hooks
// back on and to run the preflight that inspects the real tarball.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");
const pkg = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
) as {
  scripts: Record<string, string>;
  files?: string[];
  main?: string;
  bin?: Record<string, string>;
};
const npmrc = readFileSync(path.join(repoRoot, ".npmrc"), "utf8");

const ignoresScripts = /^\s*ignore-scripts\s*=\s*true\s*$/m.test(npmrc);

describe("publish path survives .npmrc ignore-scripts", () => {
  it("the .npmrc really does set ignore-scripts=true (premise of this suite)", () => {
    expect(ignoresScripts).toBe(true);
  });

  it("ships a `release` script that forces the package's own hooks back on", () => {
    const release = pkg.scripts.release ?? "";
    expect(
      release,
      "no `release` script: a hand publish would run bare `npm publish` and " +
        "skip prepublishOnly entirely",
    ).toBeTruthy();
    expect(release).toMatch(/npm publish\b/);
    expect(
      release,
      "`npm run release` must pass --ignore-scripts=false or prepublishOnly " +
        "is suppressed exactly as it is for a bare `npm publish`",
    ).toContain("--ignore-scripts=false");
  });

  it("prepublishOnly still builds BOTH artifacts and ends in the preflight", () => {
    const hook = pkg.scripts.prepublishOnly ?? "";
    expect(hook).toContain("npm run build");
    expect(hook).toContain("npm run build:eval-ui");
    expect(
      hook,
      "prepublishOnly must end in the preflight so a half-run chain cannot " +
        "publish an incomplete tarball",
    ).toContain("release:preflight");
  });

  it("the preflight script exists and inspects the tarball, not the worktree", () => {
    const preflightCmd = pkg.scripts["release:preflight"] ?? "";
    expect(preflightCmd).toBeTruthy();
    const rel = preflightCmd.replace(/^node\s+/, "").trim();
    const file = path.join(repoRoot, rel);
    expect(existsSync(file), `${rel} is referenced but missing`).toBe(true);
    const src = readFileSync(file, "utf8");
    // The whole point: assert against what npm would upload. Checking the
    // working tree would pass on a machine that happens to have a stale dist/.
    expect(src).toMatch(/npm.*pack.*--dry-run/s);
  });

  it("every declared entrypoint lives under a `files` entry the build produces", () => {
    const entrypoints = [
      ...(pkg.main ? [pkg.main] : []),
      ...Object.values(pkg.bin ?? {}),
    ].map((p) => p.replace(/^\.\//, ""));
    expect(entrypoints.length).toBeGreaterThan(0);
    for (const ep of entrypoints) {
      expect(
        (pkg.files ?? []).some((f) => ep === f || ep.startsWith(`${f}/`)),
        `${ep} is not covered by package.json "files" — it would never ship`,
      ).toBe(true);
      // Every entrypoint is build output (dist/), which is gitignored — hence
      // the preflight, and hence the CI publish-guard job.
      expect(ep.startsWith("dist/")).toBe(true);
    }
  });

  it("documents the caveat in .npmrc so the next person does not re-learn it", () => {
    expect(npmrc.toLowerCase()).toContain("npm run release");
  });
});
