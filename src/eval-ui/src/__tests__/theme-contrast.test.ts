import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// WCAG 2.1 relative-luminance + contrast-ratio implementation.
// Kept inline (pure TS, zero deps) — equivalent to the `wcag-contrast` package
// but avoids pulling an extra devDependency for a ~40-line formula.
// Reference: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
// ---------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const m = hex.replace("#", "").toLowerCase();
  if (m.length !== 6 && m.length !== 3) {
    throw new Error(`Unsupported hex color: ${hex}`);
  }
  const expanded =
    m.length === 3
      ? m
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : m;
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ];
}

function srgbChannel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * srgbChannel(r) +
    0.7152 * srgbChannel(g) +
    0.0722 * srgbChannel(b)
  );
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// Token values — mirrored from ADR-0674-01 (warm-neutral palette).
// If these drift from globals.css, the theme-tokens.test.ts will catch it,
// and this test's numeric assertions will still gate actual contrast.
// ---------------------------------------------------------------------------
const LIGHT = {
  paper: "#FBF8F3",
  surface: "#FFFFFF",
  ink: "#191919",
  inkMuted: "#5A5651",
  rule: "#E8E1D6",
  accent: "#D4A27F",
  installed: "#2F6A4A",
  own: "#8A5A1F",
  focus: "#3B6EA8",
} as const;

const DARK = {
  paper: "#1A1814",
  surface: "#221F1A",
  ink: "#F2ECE1",
  inkMuted: "#A59D8F",
  rule: "#2E2A24",
  accent: "#E0B793",
  installed: "#86C9A5",
  own: "#E6B877",
  focus: "#7CA8D9",
} as const;

describe("T-006: WCAG AA contrast gates (AC-US2-02) — light theme", () => {
  it("--ink on --paper ≥ 7:1 (AAA body)", () => {
    expect(contrastRatio(LIGHT.ink, LIGHT.paper)).toBeGreaterThanOrEqual(7);
  });

  it("--ink on --surface ≥ 7:1 (AAA body)", () => {
    expect(contrastRatio(LIGHT.ink, LIGHT.surface)).toBeGreaterThanOrEqual(7);
  });

  it("--ink-muted on --paper ≥ 4.5:1 (AA body)", () => {
    expect(
      contrastRatio(LIGHT.inkMuted, LIGHT.paper),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("--installed on --paper ≥ 3:1 (AA UI)", () => {
    expect(
      contrastRatio(LIGHT.installed, LIGHT.paper),
    ).toBeGreaterThanOrEqual(3);
  });

  it("--own on --paper ≥ 3:1 (AA UI)", () => {
    expect(contrastRatio(LIGHT.own, LIGHT.paper)).toBeGreaterThanOrEqual(3);
  });

  it("--focus on --paper ≥ 3:1 (AA UI)", () => {
    expect(contrastRatio(LIGHT.focus, LIGHT.paper)).toBeGreaterThanOrEqual(3);
  });
});

describe("T-006: WCAG AA contrast gates (AC-US2-02) — dark theme", () => {
  it("--ink on --paper ≥ 7:1 (AAA body)", () => {
    expect(contrastRatio(DARK.ink, DARK.paper)).toBeGreaterThanOrEqual(7);
  });

  it("--ink on --surface ≥ 7:1 (AAA body)", () => {
    expect(contrastRatio(DARK.ink, DARK.surface)).toBeGreaterThanOrEqual(7);
  });

  it("--ink-muted on --paper ≥ 4.5:1 (AA body)", () => {
    expect(contrastRatio(DARK.inkMuted, DARK.paper)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("--installed on --paper ≥ 3:1 (AA UI)", () => {
    expect(contrastRatio(DARK.installed, DARK.paper)).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("--own on --paper ≥ 3:1 (AA UI)", () => {
    expect(contrastRatio(DARK.own, DARK.paper)).toBeGreaterThanOrEqual(3);
  });

  it("--focus on --paper ≥ 3:1 (AA UI)", () => {
    expect(contrastRatio(DARK.focus, DARK.paper)).toBeGreaterThanOrEqual(3);
  });
});

describe("T-006: self-check — the contrast test MUST fail on a regressed token", () => {
  it("fails when --ink is pulled down into medium-gray range", () => {
    // If someone lowers --ink to #777777 on --paper, body contrast drops below
    // AAA. This test proves the gate detects the regression.
    const regressed = "#777777";
    expect(
      contrastRatio(regressed, LIGHT.paper),
    ).toBeLessThan(4.5);
  });

  it("fails when --ink-muted is pulled below AA on paper", () => {
    const regressed = "#BFBAB3"; // too close to --paper
    expect(
      contrastRatio(regressed, LIGHT.paper),
    ).toBeLessThan(4.5);
  });
});

describe("T-006: contrastRatio / relativeLuminance sanity", () => {
  it("white on black is ~21:1", () => {
    const r = contrastRatio("#FFFFFF", "#000000");
    expect(r).toBeGreaterThan(20.9);
    expect(r).toBeLessThan(21.1);
  });

  it("same color on same color is 1:1", () => {
    expect(contrastRatio("#FBF8F3", "#FBF8F3")).toBeCloseTo(1, 5);
  });
});
