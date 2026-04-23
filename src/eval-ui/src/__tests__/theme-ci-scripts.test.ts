import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  scanForShimmer,
  type ShimmerViolation,
} from "../../../../scripts/check-no-shimmer";

import {
  scanForSerifScope,
  type SerifViolation,
} from "../../../../scripts/check-serif-scope";

const repoRoot = resolve(__dirname, "../../../..");

// ---------------------------------------------------------------------------
// Sandbox helpers — build a temporary directory tree, run the scanners
// against it, then tear it down.
// ---------------------------------------------------------------------------
let sandbox = "";

function writeSandboxFile(rel: string, contents: string) {
  const abs = join(sandbox, rel);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, contents, "utf8");
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "vskill-ci-scripts-"));
});

afterEach(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

// ===========================================================================
// T-008A: check-no-shimmer
// ===========================================================================
describe("T-008: check-no-shimmer (AC-US2-01)", () => {
  it("returns no violations when sources are clean", () => {
    writeSandboxFile(
      "src/eval-ui/src/components/Clean.tsx",
      `export const X = () => <div className="placeholder" />;`,
    );
    const violations = scanForShimmer(sandbox);
    expect(violations).toEqual([]);
  });

  it("flags @keyframes shimmer in a css file", () => {
    writeSandboxFile(
      "src/eval-ui/src/styles/bad.css",
      `@keyframes shimmer { from { opacity: 0; } to { opacity: 1; } }`,
    );
    const violations = scanForShimmer(sandbox);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.pattern).toBe("@keyframes shimmer");
    expect(violations[0]?.file).toMatch(/bad\.css$/);
  });

  it("flags .skeleton { rules that include animation: (would resurrect shimmer)", () => {
    writeSandboxFile(
      "src/eval-ui/src/styles/bad.css",
      `.skeleton { background: linear-gradient(90deg, #aaa, #bbb); animation: shimmer 1.4s infinite; }`,
    );
    const violations = scanForShimmer(sandbox);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.pattern).toMatch(/\.skeleton.*animation/);
  });

  it("allows .skeleton alias without animation (legacy alias of .placeholder)", () => {
    writeSandboxFile(
      "src/eval-ui/src/styles/legacy-alias.css",
      `.placeholder, .skeleton { background: var(--border-default); border-radius: 4px; opacity: 0.6; }`,
    );
    const violations = scanForShimmer(sandbox);
    expect(violations).toEqual([]);
  });

  it("flags shimmer inside .tsx via @keyframes or animated .skeleton", () => {
    writeSandboxFile(
      "src/eval-ui/src/components/Bad.tsx",
      `const keyframes = "@keyframes shimmer { 0%{opacity:0} 100%{opacity:1} }";`,
    );
    const violations = scanForShimmer(sandbox);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    const patterns = violations.map((v: ShimmerViolation) => v.pattern);
    expect(patterns).toContain("@keyframes shimmer");
  });

  it("the real vskill repo is shimmer-free", () => {
    const violations = scanForShimmer(repoRoot);
    if (violations.length > 0) {
      // Print offenders for debugging before failing.
      for (const v of violations) {
        // eslint-disable-next-line no-console
        console.error(`[shimmer] ${v.file}:${v.line} — ${v.pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// ===========================================================================
// T-008B: check-serif-scope
// ===========================================================================
describe("T-008: check-serif-scope (AC-US1-01)", () => {
  it("allows --font-serif usage in globals.css", () => {
    writeSandboxFile(
      "src/eval-ui/src/styles/globals.css",
      `body { font-family: var(--font-serif); }`,
    );
    const violations = scanForSerifScope(sandbox);
    expect(violations).toEqual([]);
  });

  it("flags --font-serif usage inside workspace/ (out of scope)", () => {
    writeSandboxFile(
      "src/eval-ui/src/pages/workspace/BadHeading.tsx",
      `const style = { fontFamily: "var(--font-serif)" };`,
    );
    const violations = scanForSerifScope(sandbox);
    expect(violations.length).toBe(1);
    expect(violations[0]?.file).toMatch(/BadHeading\.tsx$/);
    expect(violations[0]?.pattern).toBe("var(--font-serif)");
  });

  it("flags font-family: var(--font-serif) in a workspace CSS file", () => {
    writeSandboxFile(
      "src/eval-ui/src/pages/workspace/bad.css",
      `.headline { font-family: var(--font-serif); }`,
    );
    const violations = scanForSerifScope(sandbox);
    expect(violations.length).toBe(1);
    expect(violations[0]?.file).toMatch(/bad\.css$/);
  });

  it("allows serif usage inside allow-listed selectors (detail-card title)", () => {
    writeSandboxFile(
      "src/eval-ui/src/components/DetailHeader.tsx",
      // Files at src/eval-ui/src/components/ are outside workspace — allowed.
      `const style = { fontFamily: "var(--font-serif)" };`,
    );
    const violations = scanForSerifScope(sandbox);
    expect(violations).toEqual([]);
  });

  it("allows serif usage in EmptyState component", () => {
    writeSandboxFile(
      "src/eval-ui/src/components/EmptyState.tsx",
      `const style = { fontFamily: "var(--font-serif)" };`,
    );
    const violations = scanForSerifScope(sandbox);
    expect(violations).toEqual([]);
  });

  it("the real vskill repo is serif-scope clean", () => {
    const violations = scanForSerifScope(repoRoot);
    if (violations.length > 0) {
      for (const v of violations) {
        // eslint-disable-next-line no-console
        console.error(
          `[serif-scope] ${v.file}:${v.line} — ${v.pattern}`,
        );
      }
    }
    expect(violations).toEqual([]);
  });
});

// ===========================================================================
// T-008C: package.json wires npm scripts
// ===========================================================================
describe("T-008: package.json exposes lint scripts", () => {
  it("defines a 'lint:shimmer' (or 'check:no-shimmer') script", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    );
    const names = Object.keys(pkg.scripts ?? {});
    const hasShimmer = names.some(
      (n) => n === "lint:shimmer" || n === "check:no-shimmer",
    );
    expect(hasShimmer).toBe(true);
  });

  it("defines a 'lint:serif-scope' (or 'check:serif-scope') script", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    );
    const names = Object.keys(pkg.scripts ?? {});
    const hasSerif = names.some(
      (n) => n === "lint:serif-scope" || n === "check:serif-scope",
    );
    expect(hasSerif).toBe(true);
  });
});

// Avoid "unused import" errors under strict TS settings when the
// imports above are only used as type references.
export type _Keep = SerifViolation | ShimmerViolation;
