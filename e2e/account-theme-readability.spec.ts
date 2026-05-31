// ---------------------------------------------------------------------------
// 0860 T-005 — Account-cabinet theme readability guard.
//
// Regression guard for the `--bg-elevated` fix that just landed in
// src/eval-ui/src/styles/globals.css (line 91):
//
//     --bg-elevated: var(--color-surface);
//
// Before the fix `--bg-elevated` was undefined → every component that read it
// (AccountShell SideNav/Header, PlanCard, TokensTable, ProfileForm, …) fell
// back to the literal `#fff`. In DARK theme those panels rendered WHITE behind
// light `--text-primary` text → ~1.18:1 contrast — the "My queue" / Account
// sub-nav tab labels were effectively invisible.
//
// This spec launches Studio (NO platform / wrangler required — it only needs
// the eval-ui shell), opens the Account cabinet, and for BOTH light and dark
// themes asserts that every Account-cabinet sub-nav tab label clears the
// WCAG-AA 4.5:1 text/background contrast threshold.
//
// Contrast is computed in-page exactly like WCAG 2.x: sRGB → relative
// luminance → (L_lighter + 0.05) / (L_darker + 0.05). The effective background
// is resolved by walking up the DOM until a non-transparent backgroundColor is
// found (the tabs themselves are `background: transparent` when inactive, so
// the SideNav's `--bg-elevated` background is what actually shows through —
// which is precisely the surface the fix repaired).
//
// MUST FAIL if `--bg-elevated` regresses to white in dark theme. Proven
// locally: blanking `--bg-elevated` back to `#ffffff` drops 7/8 tab ratios to
// ~1.14–1.17 (FAIL); with the fix in place they sit at ~13.9–15.1 (PASS).
//
// Determinism: theme is preseeded via localStorage (`vskill-theme`) BEFORE
// page load — see GOTCHA in the recon about the auto-explicit-vs-default-flip
// branch in nextMode(). We never rely on clicking the toggle to land on a
// specific theme; we set the start state and (separately) verify the toggle
// flips `data-theme`.
// ---------------------------------------------------------------------------
import { test, expect, type Page } from "@playwright/test";

const THEME_STORAGE_KEY = "vskill-theme"; // src/eval-ui/src/theme/theme-utils.ts
const MIN_CONTRAST = 4.5; // WCAG 2.x AA for normal-size text.

type RGB = [number, number, number];

// ---- WCAG relative-luminance + contrast, mirrored on the Node side so the
// assertion message can report exact ratios. The SAME math runs in-page (see
// `measureTabContrast`) against live computed styles. ----
function channelLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b);
}
function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

interface TabMeasurement {
  testid: string;
  label: string;
  fg: RGB;
  bg: RGB;
}

/**
 * In-page measurement: for every `[data-testid^="account-tab-"]` button read
 * the computed foreground color and resolve the effective background by
 * walking ancestors until a non-transparent fill is hit. Returns parsed RGB
 * triples so the contrast math (and a readable failure message) lives in the
 * test runner.
 */
async function measureTabContrast(page: Page): Promise<TabMeasurement[]> {
  return page.evaluate(() => {
    function parseColor(input: string): [number, number, number, number] | null {
      const m = input.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
      const [r, g, b] = parts;
      const a = parts[3] === undefined ? 1 : parts[3];
      return [r, g, b, a];
    }
    function effectiveBackground(node: Element): [number, number, number] {
      let cur: Element | null = node;
      while (cur) {
        const parsed = parseColor(getComputedStyle(cur).backgroundColor);
        if (parsed && parsed[3] !== 0) return [parsed[0], parsed[1], parsed[2]];
        cur = cur.parentElement;
      }
      // Reached <html> with no opaque fill: the viewport default is white.
      return [255, 255, 255];
    }
    const tabs = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="account-tab-"]'),
    );
    return tabs.map((el) => {
      const cs = getComputedStyle(el);
      const fg = parseColor(cs.color) ?? [0, 0, 0, 1];
      return {
        testid: el.getAttribute("data-testid") ?? "",
        label: (el.textContent ?? "").trim(),
        fg: [fg[0], fg[1], fg[2]] as [number, number, number],
        bg: effectiveBackground(el),
      };
    });
  });
}

/**
 * Preseed the theme in localStorage, load Studio, open the Account cabinet,
 * and confirm `data-theme` resolved to the expected value. Returns the page so
 * callers can measure. Reused by both light + dark cases for parity.
 */
async function openAccountCabinet(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage may be unavailable in some sandboxes — toggle path covers it */
      }
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Enter the Account cabinet (App.tsx toggles accountView → AccountShell).
  await page.getByTestId("account-sidebar-entry").click();
  await page.getByTestId("account-shell").waitFor({ state: "visible" });

  // The ThemeProvider writes the resolved theme to <html data-theme>. Assert
  // we actually landed on the theme we preseeded before measuring contrast.
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

for (const theme of ["light", "dark"] as const) {
  test(`Account-cabinet sub-nav tabs are readable in ${theme} theme (>= 4.5:1)`, async ({
    page,
  }) => {
    await openAccountCabinet(page, theme);

    const measurements = await measureTabContrast(page);

    // Sanity: all 8 cabinet tabs are present (Profile · Plan · Repos · Skills ·
    // My queue · Tokens · Notifications · Danger).
    expect(measurements.length).toBeGreaterThanOrEqual(8);
    const labels = measurements.map((m) => m.label);
    expect(labels).toContain("My queue");

    const failures: string[] = [];
    for (const m of measurements) {
      const ratio = contrastRatio(m.fg, m.bg);
      if (ratio < MIN_CONTRAST) {
        failures.push(
          `${m.testid} ("${m.label}"): ${ratio.toFixed(2)}:1 ` +
            `fg=rgb(${m.fg.join(",")}) bg=rgb(${m.bg.join(",")})`,
        );
      }
    }

    expect(
      failures,
      `Account-cabinet tab labels below ${MIN_CONTRAST}:1 in ${theme} theme ` +
        `(likely a --bg-elevated regression in globals.css):\n  ${failures.join("\n  ")}`,
    ).toEqual([]);
  });
}

// Independent assertion that the in-page contrast math is wired to the live
// `--bg-elevated` token: if it regresses to white in DARK theme, the inactive
// tabs MUST drop below 4.5:1. We simulate the regression by re-declaring the
// token (NOT a permanent change) and confirm the guard would catch it. This is
// the meta-test that proves the guard is not a tautology.
test("guard detects a --bg-elevated regression to white in dark theme", async ({ page }) => {
  await openAccountCabinet(page, "dark");

  // Simulate the pre-fix state: force the elevated-surface token back to white.
  // `--bg-elevated` resolves through `var(--color-surface)` (globals.css L91),
  // so we pin BOTH the semantic token and its Layer-1 source at the highest
  // specificity (`html[data-theme="dark"]`, !important) to defeat any inherited
  // re-declaration on intermediate cabinet wrappers. This reproduces exactly
  // what an undefined/white `--bg-elevated` did before the fix.
  await page.addStyleTag({
    content:
      'html[data-theme="dark"]{' +
      "--bg-elevated:#ffffff !important;" +
      "--color-surface:#ffffff !important;" +
      "}",
  });

  // Poll until the regression has actually propagated to the live SideNav
  // background, then measure. This avoids a race between style insertion and
  // React's next paint.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const sn = document.querySelector('[data-testid="account-shell-sidenav"]');
        return sn ? getComputedStyle(sn).backgroundColor : "";
      }),
    )
    .toBe("rgb(255, 255, 255)");

  const measurements = await measureTabContrast(page);
  const belowThreshold = measurements.filter(
    (m) => contrastRatio(m.fg, m.bg) < MIN_CONTRAST,
  );

  // With white --bg-elevated behind light text, the inactive tabs collapse to
  // ~1.1:1. At least one tab MUST fail — proving the guard above is load-bearing.
  expect(
    belowThreshold.length,
    "Regressing --bg-elevated to white should make >=1 tab fail the contrast guard",
  ).toBeGreaterThan(0);
});
