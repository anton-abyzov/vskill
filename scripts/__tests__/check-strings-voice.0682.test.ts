// ---------------------------------------------------------------------------
// 0682 F-003 — Expand voice-lint scope from `strings.ts` only to the entire
// `src/eval-ui/src/**` and `src/eval-server/**` subtrees, with allowance
// only for `README.md` and `docs/**`.
//
// AC-US5-01(f): voice-lint must FAIL on `Max/Pro` / `subscription` anywhere
// in those subtrees. Pre-fix, TARGETS was `["src/eval-ui/src/strings.ts"]`
// only — a green check would pass even if a regression added `Max/Pro` to
// StatusBar.tsx or api-routes.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanForVoiceViolations } from "../check-strings-voice";

const tempDirs: string[] = [];

function makeFakeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "vskill-0682-voice-"));
  tempDirs.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    const dir = abs.substring(0, abs.lastIndexOf("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(abs, contents, "utf8");
  }
  return root;
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("0682 F-003: voice-lint scope covers all of src/eval-ui/src and src/eval-server", () => {
  it("flags 'Max/Pro' in src/eval-ui/src/components/StatusBar.tsx", () => {
    const root = makeFakeRepo({
      // strings.ts must exist or the script throws (existing behavior).
      "src/eval-ui/src/strings.ts": `export const strings = { hello: "hi" };\n`,
      "src/eval-ui/src/components/StatusBar.tsx":
        `export const tierLabel = "Max/Pro tier indicator regression";\n`,
    });
    const violations = scanForVoiceViolations(root);
    const offenders = violations.filter((v) => v.label === "Max/Pro");
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders[0]!.file).toMatch(/StatusBar\.tsx$/);
  });

  it("flags 'subscription' in src/eval-server/api-routes.ts", () => {
    const root = makeFakeRepo({
      "src/eval-ui/src/strings.ts": `export const strings = { hello: "hi" };\n`,
      "src/eval-server/api-routes.ts": `export const note = "your subscription is active";\n`,
    });
    const violations = scanForVoiceViolations(root);
    const offenders = violations.filter((v) => v.label === "subscription");
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders[0]!.file).toMatch(/api-routes\.ts$/);
  });

  it("ignores 'Max/Pro' in README.md and docs/** (carve-out for marketing-style copy)", () => {
    const root = makeFakeRepo({
      "src/eval-ui/src/strings.ts": `export const strings = { hello: "hi" };\n`,
      "README.md": `# vSkill\n\nAnthropic Max/Pro background context here.\n`,
      "docs/ARCHITECTURE.md": `## Auth\n\nThe legacy Max/Pro path exists for archival reasons.\n`,
    });
    const violations = scanForVoiceViolations(root);
    expect(violations.length).toBe(0);
  });

  it("does not flag the allowlisted '· subscription' billing-mode token in strings.ts", () => {
    const root = makeFakeRepo({
      "src/eval-ui/src/strings.ts":
        `export const strings = {\n  models: {\n    subscriptionBilling: "· subscription",\n  },\n};\n`,
    });
    const violations = scanForVoiceViolations(root);
    expect(violations.length).toBe(0);
  });

  it("flags 'Max/Pro' in nested directories (e.g., src/eval-ui/src/hooks/useFoo.ts)", () => {
    const root = makeFakeRepo({
      "src/eval-ui/src/strings.ts": `export const strings = { hello: "hi" };\n`,
      "src/eval-ui/src/hooks/useFoo.ts":
        `export const tier = "Max/Pro";\n`,
    });
    const violations = scanForVoiceViolations(root);
    const offenders = violations.filter((v) => v.label === "Max/Pro");
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders[0]!.file).toMatch(/useFoo\.ts$/);
  });
});
