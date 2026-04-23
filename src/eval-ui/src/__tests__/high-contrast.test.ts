/**
 * T-046 — High-contrast variant [data-contrast="more"] (AC-US8-09).
 *
 * Scope:
 *   1. globals.css defines [data-contrast="more"] overrides that tighten
 *      --color-ink-muted and --color-rule for both light and dark themes.
 *   2. globals.css widens focus rings to 3px under [data-contrast="more"].
 *   3. index.html inline script sets data-contrast="more" when
 *      matchMedia("(prefers-contrast: more)").matches is true.
 *   4. ThemeProvider has a runtime handler that keeps data-contrast in sync
 *      if the OS preference toggles while the app is running.
 *   5. Contrast in the high-contrast variant stays ≥ 4.5:1 for muted text.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./theme-contrast.test";

const CSS = readFileSync(
  path.resolve(__dirname, "../styles/globals.css"),
  "utf8",
);
const HTML = readFileSync(
  path.resolve(__dirname, "../../index.html"),
  "utf8",
);
const PROVIDER = readFileSync(
  path.resolve(__dirname, "../theme/ThemeProvider.tsx"),
  "utf8",
);

describe("T-046: [data-contrast=\"more\"] tokens", () => {
  it("defines a light-mode high-contrast override block", () => {
    // [data-contrast="more"] { --color-ink-muted: #3D3A36; --color-rule: #B8AD9A; }
    const lightBlock = CSS.match(
      /\[data-contrast="more"\]\s*\{[\s\S]*?\}/,
    );
    expect(lightBlock?.[0] ?? "").toMatch(/--color-ink-muted:\s*#3D3A36/);
    expect(lightBlock?.[0] ?? "").toMatch(/--color-rule:\s*#B8AD9A/);
  });

  it("defines a dark-mode high-contrast override block", () => {
    // [data-theme="dark"][data-contrast="more"] { --color-ink-muted: #D4CBBA; ... }
    const darkBlock = CSS.match(
      /\[data-theme="dark"\]\[data-contrast="more"\]\s*\{[\s\S]*?\}/,
    );
    expect(darkBlock?.[0] ?? "").toMatch(/--color-ink-muted:\s*#D4CBBA/);
  });

  it("widens focus-visible outline to 3px under high contrast", () => {
    expect(CSS).toMatch(
      /\[data-contrast="more"\][^{]*:focus-visible[\s\S]*?outline-width:\s*3px/,
    );
  });
});

describe("T-046: FOUC script sets data-contrast=\"more\" on first paint", () => {
  it("inline script reads prefers-contrast: more and sets dataset.contrast", () => {
    expect(HTML).toMatch(/prefers-contrast:\s*more/);
    expect(HTML).toMatch(/dataset\.contrast\s*=\s*"more"/);
  });
});

describe("T-046: ThemeProvider runtime glue for prefers-contrast", () => {
  it("subscribes to matchMedia(\"(prefers-contrast: more)\") change events", () => {
    expect(PROVIDER).toMatch(/prefers-contrast:\s*more/);
    expect(PROVIDER).toMatch(/addEventListener\("change"/);
  });

  it("applies data-contrast when the media query matches and removes it otherwise", () => {
    expect(PROVIDER).toMatch(/dataset\.contrast\s*=\s*"more"/);
    expect(PROVIDER).toMatch(/delete\s+targetRef\.dataset\.contrast/);
  });
});

describe("T-046: muted-text contrast in high-contrast mode stays ≥ 4.5:1", () => {
  it("light high-contrast: #3D3A36 on #FBF8F3 ≥ 4.5:1", () => {
    const ratio = contrastRatio("#3D3A36", "#FBF8F3");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("dark high-contrast: #D4CBBA on #1A1814 ≥ 4.5:1", () => {
    const ratio = contrastRatio("#D4CBBA", "#1A1814");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
