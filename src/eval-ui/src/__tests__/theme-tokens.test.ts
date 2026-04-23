import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalsPath = resolve(
  __dirname,
  "../../../eval-ui/src/styles/globals.css",
);
const css = readFileSync(globalsPath, "utf8");

// Extract the first CSS block immediately following a literal selector.
function blockOf(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return "";
  const openBrace = css.indexOf("{", start);
  const closeBrace = css.indexOf("}", openBrace);
  if (openBrace === -1 || closeBrace === -1) return "";
  return css.slice(openBrace + 1, closeBrace);
}

describe("T-002: warm-neutral tokens in globals.css (AC-US2-01, AC-US2-06)", () => {
  const lightBlock = blockOf(":root");
  const darkBlock = blockOf(`[data-theme="dark"]`);

  it("defines all Layer-1 raw tokens at :root (light defaults)", () => {
    const required = [
      "--color-paper",
      "--color-surface",
      "--color-ink",
      "--color-ink-muted",
      "--color-rule",
      "--color-accent",
      "--color-accent-ink",
      "--color-installed",
      "--color-own",
      "--color-focus",
    ];
    for (const token of required) {
      expect(lightBlock, `missing ${token} in :root`).toContain(token);
    }
  });

  it(":root uses warm off-white paper and near-black ink (Anthropic palette)", () => {
    expect(lightBlock).toMatch(/--color-paper:\s*#FBF8F3/i);
    expect(lightBlock).toMatch(/--color-ink:\s*#191919/i);
    expect(lightBlock).toMatch(/--color-accent:\s*#D4A27F/i);
  });

  it("[data-theme=dark] keeps the warmth — warm near-black, not cool slate", () => {
    expect(darkBlock, "missing [data-theme=dark] block").not.toBe("");
    expect(darkBlock).toMatch(/--color-paper:\s*#1A1814/i);
    expect(darkBlock).toMatch(/--color-ink:\s*#F2ECE1/i);
    expect(darkBlock).not.toMatch(/#0A0A0A/i);
    expect(darkBlock).not.toMatch(/#0B0D11/i);
  });

  it("dark override redeclares every Layer-1 token", () => {
    const required = [
      "--color-paper",
      "--color-surface",
      "--color-ink",
      "--color-ink-muted",
      "--color-rule",
      "--color-accent",
      "--color-installed",
      "--color-own",
      "--color-focus",
    ];
    for (const token of required) {
      expect(darkBlock, `missing ${token} in [data-theme=dark]`).toContain(
        token,
      );
    }
  });

  it("defines Layer-2 semantic tokens that reference Layer-1 raw tokens", () => {
    const required = [
      "--bg-canvas",
      "--text-primary",
      "--border-default",
      "--status-installed",
      "--status-own",
    ];
    for (const token of required) {
      expect(css, `missing semantic token ${token}`).toContain(token);
    }
    // Semantic tokens must reference raw tokens via var(), not hardcoded hex.
    const semanticRefRe =
      /--(bg-canvas|text-primary|border-default|status-installed|status-own):\s*var\(/g;
    const matches = css.match(semanticRefRe) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });

  it("deletes .skeleton shimmer class and @keyframes shimmer", () => {
    expect(css).not.toMatch(/@keyframes\s+shimmer/);
    expect(css).not.toMatch(/\.skeleton\s*{/);
  });

  it("replaces shimmer with a static .placeholder class", () => {
    expect(css).toMatch(/\.placeholder\s*{/);
  });

  it("respects prefers-reduced-motion with a global override", () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("declares a [data-contrast='more'] overlay for high-contrast mode", () => {
    expect(css).toMatch(/\[data-contrast=(?:"|')more(?:"|')\]/);
  });
});
