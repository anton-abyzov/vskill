/**
 * 0803 T-001 — pill::before regression guard (AC-US1-01, AC-US1-02).
 *
 * Why source-level assertions: JSDOM does not resolve cascaded ::before
 * pseudo-elements consistently, so the existing convention in this repo
 * (see __tests__/theme-transition.test.ts) is to grep the CSS source.
 *
 * Contract:
 *   - Base `.pill` declares NO `::before` rule (no leading bullet on filled
 *     status badges, verdict pills, leaderboard chips, etc).
 *   - `.pill-installed` and `.pill-own` keep the `::before` bullet so
 *     status indicators retain the dot when re-introduced.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.resolve(__dirname, "../globals.css"),
  "utf8",
);

describe("0803: .pill::before is scoped to indicator modifiers", () => {
  it("does NOT declare `.pill::before` on the base class", () => {
    // A bare `.pill::before {` rule (no other selector) would reintroduce
    // the stray dot on every filled badge.
    const baseRule = CSS.match(/(?:^|\n)\s*\.pill::before\s*\{/);
    expect(baseRule).toBeNull();
  });

  it("does declare `::before` on `.pill-installed` / `.pill-own` indicator modifiers", () => {
    expect(CSS).toMatch(
      /\.pill-installed::before[\s\S]*\.pill-own::before|\.pill-installed::before,\s*\n\s*\.pill-own::before/,
    );
    // The bullet is a 6×6 disc filled with currentColor.
    const indicatorBlock = CSS.match(
      /\.pill-(?:installed|own)::before[\s\S]*?\}/,
    );
    expect(indicatorBlock?.[0] ?? "").toMatch(/width:\s*6px/);
    expect(indicatorBlock?.[0] ?? "").toMatch(/border-radius:\s*50%/);
    expect(indicatorBlock?.[0] ?? "").toMatch(/background:\s*currentColor/);
  });

  it("retains the base `.pill` layout block (display, gap, padding)", () => {
    expect(CSS).toMatch(/\.pill\s*\{[\s\S]*?display:\s*inline-flex/);
    expect(CSS).toMatch(/\.pill\s*\{[\s\S]*?gap:\s*6px/);
  });
});
