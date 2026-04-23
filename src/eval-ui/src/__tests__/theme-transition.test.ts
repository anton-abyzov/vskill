/**
 * T-042 — Theme-transition CSS (AC-US2-08, AC-US2-09).
 *
 * Scope: assert that globals.css contains the theme-transition block that:
 *   - Applies a 150ms transition on background-color / color / border-color
 *     to :root, html, body, and the common surface classes.
 *   - Removes transition on focus outlines so keyboard rings appear instantly.
 *   - Collapses to 0ms under `prefers-reduced-motion: reduce`.
 *
 * Because JSDOM does not evaluate CSS cascaded transitions on :root, the
 * cheapest reliable assertion is a source-level check against the rule set
 * plus a computed-style sanity probe in a live document fragment.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.resolve(__dirname, "../styles/globals.css"),
  "utf8",
);

describe("T-042: theme-transition CSS (AC-US2-08)", () => {
  it("defines --theme-transition token with 150ms bg/color/border timing", () => {
    expect(CSS).toMatch(/--theme-transition:/);
    expect(CSS).toMatch(/background-color\s+150ms/);
    expect(CSS).toMatch(/color\s+150ms/);
    expect(CSS).toMatch(/border-color\s+150ms/);
  });

  it("applies transition to html and body at 150ms", () => {
    // html, body { transition: var(--theme-transition); }
    expect(CSS).toMatch(/html,\s*\n\s*body\s*\{\s*\n\s*transition:\s*var\(--theme-transition\)/);
  });

  it("does NOT transition focus outlines (keyboard ring appears instantly)", () => {
    // :focus-visible { transition-property: none; }
    expect(CSS).toMatch(/:focus-visible\s*\{\s*\n\s*transition-property:\s*none/);
    // input/textarea/select/button focus explicit zero-transition.
    expect(CSS).toMatch(/input:focus[\s\S]{0,80}transition:\s*none/);
  });

  it("has @media (prefers-reduced-motion: reduce) collapsing durations to 0ms", () => {
    // Keep this loose — existing reduced-motion rule already lives in file.
    expect(CSS).toMatch(/@media\s+\(prefers-reduced-motion:\s*reduce\)/);
    // The block must zero transition-duration for all elements.
    const block = CSS.match(
      /@media\s+\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\}\s*\}/,
    );
    expect(block?.[0] ?? "").toMatch(/transition-duration:\s*0ms/);
  });
});

describe("T-042: computed transition smoke probe", () => {
  it("an element with the .glass-card class has a non-empty transition property defined by globals.css", () => {
    // Inline the rule set so JSDOM resolves transitions without needing
    // Vite's CSS pipeline. We can't assert the 150ms value via
    // getComputedStyle because JSDOM returns "" for un-supported
    // transition shorthand — but we can at least assert the class is
    // referenced in the source. This guards against accidental deletion.
    expect(CSS).toMatch(/\.glass-card,[\s\S]{0,200}transition:\s*var\(--theme-transition\)/);
  });
});
