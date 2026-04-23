import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * T-039 lazy-load contract:
 *
 * App.tsx MUST import CommandPalette via React.lazy(() => import(...)) so
 * the palette chunk stays out of the initial bundle. This test guards the
 * contract by inspecting the source — a synchronous `import { CommandPalette }`
 * would pull the component into the root graph and blow past the initial-JS
 * bundle budget.
 */

describe("App.tsx — CommandPalette lazy-load contract (T-039)", () => {
  const appPath = resolve(__dirname, "../App.tsx");
  const source = readFileSync(appPath, "utf8");

  it("does not import CommandPalette synchronously", () => {
    // Any named-import or default-import from the CommandPalette module file
    // at the top level would defeat lazy-loading.
    const syncImport = /^import[^\n]*\bCommandPalette\b[^\n]*from\s+["']\.\/components\/CommandPalette["']/m;
    expect(syncImport.test(source)).toBe(false);
  });

  it("uses React.lazy() for CommandPalette", () => {
    expect(source).toMatch(/lazy\(\s*\(\)\s*=>\s*import\(\s*["']\.\/components\/CommandPalette["']\s*\)\s*\)/);
  });

  it("wraps CommandPalette render in a Suspense boundary", () => {
    expect(source).toMatch(/<Suspense[\s\S]*?<CommandPalette/);
  });
});
