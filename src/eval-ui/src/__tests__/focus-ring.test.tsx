/**
 * T-045 — Focus-visible rings (AC-US8-03, AC-US8-06).
 *
 * Asserts:
 *   - globals.css exposes a 2px outline in var(--border-focus) with 2px offset
 *     for :focus-visible on body, .focus-ring utility, and common role-based
 *     interactive elements.
 *   - [data-contrast="more"] widens the outline to 3px.
 *   - The rule targets :focus-visible (keyboard), NOT :focus (mouse).
 *
 * These are CSS-source assertions — JSDOM does not synthesise
 * :focus-visible state accurately enough to probe via getComputedStyle.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.resolve(__dirname, "../styles/globals.css"),
  "utf8",
);

describe("T-045: focus-visible rings", () => {
  it("defines the default :focus-visible outline on the document root", () => {
    // Original rule from Phase 1 (T-002): :focus-visible { outline: 2px solid var(--border-focus); outline-offset: 2px; }
    const block = CSS.match(/:focus-visible\s*\{[\s\S]*?\}/);
    expect(block?.[0] ?? "").toMatch(/outline:\s*2px\s+solid\s+var\(--border-focus\)/);
    expect(block?.[0] ?? "").toMatch(/outline-offset:\s*2px/);
  });

  it("provides a .focus-ring helper class for custom interactive elements", () => {
    expect(CSS).toMatch(/\.focus-ring:focus-visible/);
  });

  it("applies focus ring to role-based interactive elements", () => {
    for (const role of ["button", "menuitem", "tab", "option"]) {
      expect(CSS, `missing [role="${role}"]:focus-visible rule`).toMatch(
        new RegExp(`\\[role="${role}"\\]:focus-visible`),
      );
    }
  });

  it("widens the outline to 3px under [data-contrast=\"more\"]", () => {
    expect(CSS).toMatch(/\[data-contrast="more"\][\s\S]*:focus-visible[\s\S]*outline-width:\s*3px/);
  });

  it("uses :focus-visible (keyboard) rather than :focus (mouse)", () => {
    // There must be NO plain `button:focus { outline: ... }` ring rule — we
    // only set outlines under :focus-visible selectors. We allow `input:focus`
    // style hooks (border-color, box-shadow) because those are not outlines.
    const rawButtonFocus =
      /^\s*button:focus\s*\{[^}]*outline:\s*\d+px\s+solid/m;
    expect(CSS).not.toMatch(rawButtonFocus);
  });
});
