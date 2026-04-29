/**
 * 0803 T-003 — eval-cases responsive grid contract (AC-US2-01, AC-US2-02).
 *
 * Source-level assertions per the existing convention (theme-transition.test.ts):
 *   - `.eval-cases-grid` exists in globals.css with `display: grid` and
 *     `grid-template-columns: 280px 1fr` for desktop.
 *   - A `@media (max-width: 700px)` rule collapses the grid to a single
 *     column.
 *   - TestsPanel.tsx applies the className (no inline gridTemplateColumns).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.resolve(__dirname, "../globals.css"),
  "utf8",
);

const TESTS_PANEL = readFileSync(
  path.resolve(__dirname, "../../pages/workspace/TestsPanel.tsx"),
  "utf8",
);

describe("0803: .eval-cases-grid responsive contract", () => {
  it("declares `.eval-cases-grid` with `280px 1fr` desktop tracks", () => {
    const block = CSS.match(/\.eval-cases-grid\s*\{[\s\S]*?\}/);
    expect(block).not.toBeNull();
    const body = block?.[0] ?? "";
    expect(body).toMatch(/display:\s*grid/);
    expect(body).toMatch(/grid-template-columns:\s*280px\s+1fr/);
  });

  // AC-US2-03 hardening: AC-US2-03 says rows still truncate with ellipsis on
  // narrow widths (no horizontal overflow). The previous inline style carried
  // `overflow: hidden` and `min-height: 0`; the className swap must preserve
  // both or narrow-viewport content blows out of the grid track.
  it("preserves `overflow: hidden` and `min-height: 0` on the grid container", () => {
    const block = CSS.match(/\.eval-cases-grid\s*\{[\s\S]*?\}/);
    expect(block).not.toBeNull();
    const body = block?.[0] ?? "";
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/min-height:\s*0/);
  });

  it("collapses to a single column under `@media (max-width: 700px)`", () => {
    // The narrow-viewport rule must override grid-template-columns to 1fr.
    const narrow = CSS.match(
      /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.eval-cases-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr[\s\S]*?\}\s*\}/,
    );
    expect(narrow).not.toBeNull();
  });
});

describe("0803: TestsPanel uses className, not inline gridTemplateColumns", () => {
  it("applies className=\"eval-cases-grid\" to the eval-cases container", () => {
    expect(TESTS_PANEL).toMatch(/className="eval-cases-grid"/);
  });

  it("does NOT inline `gridTemplateColumns: \"280px 1fr\"`", () => {
    // The previous inline style hard-coded the grid; the responsive rule
    // can only win if the inline style is gone.
    expect(TESTS_PANEL).not.toMatch(/gridTemplateColumns:\s*"280px\s+1fr"/);
  });
});
