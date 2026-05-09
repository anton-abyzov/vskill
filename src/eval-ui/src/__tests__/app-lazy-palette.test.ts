import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * T-039 lazy-load contract — UPDATED 2026-05-09.
 *
 * The original test (added in 0683) guarded `App.tsx` against a synchronous
 * import of the legacy `<CommandPalette>` component. App.tsx has since
 * migrated to `<ProjectCommandPalette>` + the `<FindSkillsPalette>` shell;
 * the legacy `CommandPalette.tsx` file remains in `components/` but is no
 * longer wired into App.tsx at all (verified by source-grep below). The
 * original assertions no longer apply.
 *
 * The intent — "heavy palette code stays out of the initial bundle" — is
 * still enforced, but at a different layer: `bundle-size.test.ts` reads
 * the built `dist/` and asserts the initial-JS chunk is within budget.
 * That is the load-bearing gate now. This file shrinks to a single
 * regression check that App.tsx never re-introduces the legacy synchronous
 * import.
 */

describe("App.tsx — palette lazy-load regression guard (T-039 narrowed)", () => {
  const appPath = resolve(__dirname, "../App.tsx");
  const source = readFileSync(appPath, "utf8");

  it("does not synchronously import the legacy CommandPalette", () => {
    // A synchronous named-import from the legacy file would pull
    // the entire palette graph into the root chunk again.
    const syncImport = /^import[^\n]*\bCommandPalette\b[^\n]*from\s+["']\.\/components\/CommandPalette["']/m;
    expect(syncImport.test(source)).toBe(false);
  });

  it("does not synchronously import FindSkillsPalette content", () => {
    // FindSkillsPalette is the new heavy palette shell. App.tsx wraps it
    // in <Suspense> and renders the lazy variant — synchronous default
    // imports would defeat that.
    const syncImport = /^import\s+\w+\s+from\s+["']\.\/components\/FindSkillsPalette\/FindSkillsPaletteCore["']/m;
    expect(syncImport.test(source)).toBe(false);
  });

  it("wraps the active heavy palette render in a Suspense boundary", () => {
    expect(source).toMatch(/<Suspense[\s\S]*?<(?:FindSkillsPalette|ProjectCommandPalette|CommandPalette)/);
  });
});
