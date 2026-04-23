import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mainPath = resolve(__dirname, "../../../eval-ui/src/main.tsx");
const src = readFileSync(mainPath, "utf8");

describe("T-005: main.tsx imports fonts and wraps App with ThemeProvider (AC-US2-01)", () => {
  it("imports the three @fontsource-variable packages", () => {
    // Tolerates both "@fontsource-variable/<pkg>" and explicit "/index.css".
    expect(src).toMatch(
      /import\s+["']@fontsource-variable\/source-serif-4(?:\/[\w.-]+)?["']/,
    );
    expect(src).toMatch(
      /import\s+["']@fontsource-variable\/inter-tight(?:\/[\w.-]+)?["']/,
    );
    expect(src).toMatch(
      /import\s+["']@fontsource-variable\/jetbrains-mono(?:\/[\w.-]+)?["']/,
    );
  });

  it("imports ThemeProvider from the local theme module", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*ThemeProvider[^}]*\}\s*from\s*["']\.\/theme\/ThemeProvider["']/,
    );
  });

  it("wraps <App /> with <ThemeProvider>", () => {
    // Tolerate whitespace/newlines but require <ThemeProvider> to be an
    // ancestor of <App /> somewhere in the tree.
    const tp = src.indexOf("<ThemeProvider");
    const tpClose = src.indexOf("</ThemeProvider>");
    const app = src.indexOf("<App");
    expect(tp, "missing <ThemeProvider>").toBeGreaterThan(-1);
    expect(tpClose, "missing </ThemeProvider>").toBeGreaterThan(tp);
    expect(app, "missing <App />").toBeGreaterThan(tp);
    expect(app).toBeLessThan(tpClose);
  });

  it("still imports the global stylesheet after fonts (so tokens cascade correctly)", () => {
    const firstFontImport = Math.min(
      ...[
        src.indexOf("@fontsource-variable/source-serif-4"),
        src.indexOf("@fontsource-variable/inter-tight"),
        src.indexOf("@fontsource-variable/jetbrains-mono"),
      ].filter((i) => i >= 0),
    );
    const globals = src.indexOf("./styles/globals.css");
    expect(globals).toBeGreaterThan(-1);
    expect(firstFontImport).toBeLessThan(globals);
  });
});
