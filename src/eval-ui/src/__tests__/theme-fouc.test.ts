import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const indexHtmlPath = resolve(
  __dirname,
  "../../../eval-ui/index.html",
);
const html = readFileSync(indexHtmlPath, "utf8");

describe("T-003: FOUC-prevention inline script (AC-US2-04)", () => {
  it("contains an inline module-free <script> that runs before React mounts", () => {
    // Script must appear in <head> so it runs before any React import.
    const headOpen = html.indexOf("<head>");
    const headClose = html.indexOf("</head>");
    expect(headOpen, "missing <head>").toBeGreaterThanOrEqual(0);
    const head = html.slice(headOpen, headClose);
    expect(head).toMatch(/<script[^>]*>[\s\S]*vskill-theme[\s\S]*<\/script>/);
  });

  it("reads the 'vskill-theme' key from localStorage", () => {
    expect(html).toMatch(/localStorage\.getItem\(\s*["']vskill-theme["']\s*\)/);
  });

  it("sets document.documentElement.dataset.theme (not html or body)", () => {
    // dataset.theme OR setAttribute("data-theme", ...) on documentElement
    const setsDataset = /document\.documentElement\.dataset\.theme\s*=/.test(
      html,
    );
    const setsAttr =
      /document\.documentElement\.setAttribute\(\s*["']data-theme["']/.test(
        html,
      );
    expect(setsDataset || setsAttr).toBe(true);
  });

  it("honors prefers-color-scheme when mode is auto or absent", () => {
    expect(html).toMatch(/prefers-color-scheme:\s*dark/);
    expect(html).toMatch(/matchMedia/);
  });

  it("sets data-contrast='more' when prefers-contrast: more matches", () => {
    expect(html).toMatch(/prefers-contrast:\s*more/);
    const setsDatasetContrast =
      /document\.documentElement\.dataset\.contrast\s*=/.test(html);
    const setsAttrContrast =
      /document\.documentElement\.setAttribute\(\s*["']data-contrast["']/.test(
        html,
      );
    expect(setsDatasetContrast || setsAttrContrast).toBe(true);
  });

  it("wraps everything in try/catch for private-browsing localStorage safety", () => {
    // Find the FOUC script block.
    const scriptMatch = html.match(
      /<script[^>]*>([\s\S]*?vskill-theme[\s\S]*?)<\/script>/,
    );
    expect(scriptMatch).not.toBeNull();
    expect(scriptMatch![1]).toMatch(/try\s*\{/);
    expect(scriptMatch![1]).toMatch(/catch\b/);
  });

  it("script runs before the React bundle is requested", () => {
    // The FOUC script must precede the <script type=\"module\" src=\"/src/main.tsx\">.
    const foucIdx = html.indexOf("vskill-theme");
    const mainIdx = html.indexOf("main.tsx");
    expect(foucIdx).toBeGreaterThan(-1);
    expect(mainIdx).toBeGreaterThan(-1);
    expect(foucIdx).toBeLessThan(mainIdx);
  });
});
