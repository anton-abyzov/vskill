/**
 * T-035 voice tests for src/eval-ui/src/strings.ts.
 *
 * Enforces US-010 AC-US10-01..AC-US10-05 at the unit-test level:
 *   - No "oops", "uh-oh", "awesome", "blazing-fast".
 *   - No celebration emoji (🎉 ✨ 🚀 ✅ 🎊 🔥 🙌 ⭐ 💫 🥳).
 *   - No value ending with "!" (empty-state pattern uses "." terminal).
 *   - No "!!" anywhere.
 *   - Success toasts are ≤ 5 words.
 *
 * Runs under Vitest. See also `scripts/check-strings-voice.ts` (T-036) which
 * runs the same regex pass from CI over the raw file source.
 */

import { describe, expect, it } from "vitest";
import { strings } from "../strings";

type Leaf = string;

function collectLeaves(
  node: unknown,
  path: string,
  out: Array<{ path: string; value: Leaf }>,
): void {
  if (typeof node === "string") {
    out.push({ path, value: node });
    return;
  }
  // Evaluate callable strings-as-functions with benign arguments so we cover
  // interpolated copy like `detail.loadErrorHeadline("foo")` too.
  if (typeof node === "function") {
    try {
      // Try a couple of benign argument shapes.
      const zero = (node as (...a: unknown[]) => unknown)();
      collectLeaves(zero, path + "()", out);
    } catch {
      /* ignore */
    }
    try {
      const one = (node as (...a: unknown[]) => unknown)("sample");
      collectLeaves(one, path + '("sample")', out);
    } catch {
      /* ignore */
    }
    try {
      const two = (node as (...a: unknown[]) => unknown)(3, 10);
      collectLeaves(two, path + "(3,10)", out);
    } catch {
      /* ignore */
    }
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      collectLeaves(value, path ? `${path}.${key}` : key, out);
    }
  }
}

const LEAVES = (() => {
  const out: Array<{ path: string; value: Leaf }> = [];
  collectLeaves(strings, "", out);
  return out;
})();

const FORBIDDEN_PHRASES: Array<{ label: string; re: RegExp }> = [
  { label: "oops", re: /\boops\b/i },
  { label: "uh-oh", re: /\buh[- ]?oh\b/i },
  { label: "awesome", re: /\bawesome\b/i },
  { label: "blazing-fast", re: /\bblazing[ -]?fast\b/i },
];

// Celebration emoji set. Anthropic voice = restrained, so we ban the
// confetti/rocket cohort explicitly (informational arrows / check glyphs
// remain allowed because they aren't "celebration").
const CELEBRATION_EMOJI = /[\u{1F389}\u{2728}\u{1F680}\u{2705}\u{1F38A}\u{1F525}\u{1F64C}\u{2B50}\u{1F4AB}\u{1F973}]/u;

describe("strings-voice (T-035 / AC-US10-01..06)", () => {
  it("has at least one leaf (module exports something)", () => {
    expect(LEAVES.length).toBeGreaterThan(0);
  });

  for (const { label, re } of FORBIDDEN_PHRASES) {
    it(`no string contains "${label}"`, () => {
      const offenders = LEAVES.filter((l) => re.test(l.value));
      expect(
        offenders,
        `Found forbidden phrase "${label}" in:\n` +
          offenders.map((o) => `  ${o.path}: ${JSON.stringify(o.value)}`).join("\n"),
      ).toEqual([]);
    });
  }

  it("no string contains celebration emoji", () => {
    const offenders = LEAVES.filter((l) => CELEBRATION_EMOJI.test(l.value));
    expect(
      offenders,
      "Celebration emoji are forbidden:\n" +
        offenders
          .map((o) => `  ${o.path}: ${JSON.stringify(o.value)}`)
          .join("\n"),
    ).toEqual([]);
  });

  it("no string ends with a single exclamation point", () => {
    const offenders = LEAVES.filter((l) => /[^!]!$/.test(l.value));
    expect(offenders).toEqual([]);
  });

  it("no string contains '!!' (two or more consecutive exclamation marks)", () => {
    const offenders = LEAVES.filter((l) => /!!+/.test(l.value));
    expect(offenders).toEqual([]);
  });

  it("success toasts are ≤ 5 words", () => {
    const successKeys = [
      "pathCopied",
      "configCopied",
      "skillDuplicated",
      "benchmarkQueued",
      "themeUpdated",
      "skillUpdated",
    ] as const;
    for (const key of successKeys) {
      const value = strings.toasts[key];
      const wordCount = value
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0).length;
      expect(
        wordCount,
        `toasts.${key} "${value}" should be ≤ 5 words`,
      ).toBeLessThanOrEqual(5);
    }
  });

  it("empty-state copy follows 'Statement. Next step.' pattern", () => {
    // Each headline + body pair should combine into two sentences with periods.
    const pairs: Array<{ headline: string; body: string }> = [
      {
        headline: strings.sidebar.emptyOwnHeadline,
        body: strings.sidebar.emptyOwnBody,
      },
      {
        headline: strings.sidebar.emptyInstalledHeadline,
        body: strings.sidebar.emptyInstalledBody,
      },
      {
        headline: strings.sidebar.emptyFilteredHeadline,
        body: strings.sidebar.emptyFilteredBody,
      },
      {
        headline: strings.detail.emptyHeadline,
        body: strings.detail.emptyBody,
      },
    ];
    for (const { headline, body } of pairs) {
      expect(headline).toMatch(/[.?]$/);
      expect(body).toMatch(/[.?]$/);
    }
  });
});
