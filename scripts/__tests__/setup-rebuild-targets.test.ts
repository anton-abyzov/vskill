// ---------------------------------------------------------------------------
// `npm run setup` is the only thing standing between the committed
// `ignore-scripts=true` .npmrc and a broken desktop build: it rebuilds the
// packages whose native install step the guard suppressed.
//
// `npm rebuild <pkg>` exits 0 when it matches nothing, so a rebuild target that
// is not a declared, top-level dependency is a silent no-op waiting to happen —
// it works only as long as npm keeps hoisting the transitive copy. esbuild
// (which the whole sidecar bundle runs through) was in exactly that state on
// release/2.0: reachable only via vite, absent from package.json.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");
const pkg = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
) as {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const lock = JSON.parse(
  readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"),
) as { packages: Record<string, { version?: string }> };

/** Package names passed to `npm rebuild` inside the `setup` script. */
function rebuildTargets(setup: string): string[] {
  const rebuild = setup
    .split("&&")
    .map((s) => s.trim())
    .find((s) => s.startsWith("npm rebuild"));
  if (!rebuild) return [];
  return rebuild
    .replace(/^npm rebuild\s*/, "")
    .split(/\s+/)
    .filter((t) => t && !t.startsWith("-"));
}

describe("npm run setup", () => {
  const targets = rebuildTargets(pkg.scripts.setup ?? "");

  it("rebuilds esbuild — the sidecar bundle cannot be built without it", () => {
    expect(targets).toContain("esbuild");
  });

  it.each(targets)(
    "%s is a declared dependency, so the rebuild cannot silently no-op",
    (name) => {
      const declared = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      expect(
        Object.keys(declared),
        `\`npm rebuild ${name}\` relies on npm hoisting a transitive copy; ` +
          "declare it in package.json so the rebuild target is explicit",
      ).toContain(name);
    },
  );

  it.each(targets)("%s is pinned to the version in the lockfile", (name) => {
    const declared = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    const locked = lock.packages[`node_modules/${name}`]?.version;
    expect(locked, `${name} missing from package-lock.json`).toBeDefined();
    // An exact pin keeps `npm ci` from resolving a different build of a package
    // whose native step we deliberately suppress at install time.
    expect(declared[name]).toBe(locked);
  });

  it("verifies the rebuild actually worked instead of trusting exit 0", () => {
    expect(pkg.scripts.setup).toContain("scripts/desktop/verify-esbuild.mjs");
  });
});
