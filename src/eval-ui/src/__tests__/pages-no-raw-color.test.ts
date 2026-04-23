/**
 * T-043 — Token sweep verification.
 *
 * Scans every .ts/.tsx under src/eval-ui/src/pages/ for raw hex/rgb/hsl
 * color literals. Raw colors are allowed ONLY when the preceding non-blank
 * line carries an `eslint-disable-next-line vskill/no-raw-color` directive.
 *
 * This mirrors what `npx eslint src/eval-ui/src/pages/**` would report if
 * ESLint were installed as a runtime devDependency. Because it isn't,
 * this Vitest test is the CI gate.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectRawColor } from "../../eslint-rules/no-raw-color";

const PAGES_ROOT = resolve(__dirname, "../pages");
const EXT = new Set([".ts", ".tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const s = statSync(abs);
    if (s.isDirectory()) {
      walk(abs, out);
    } else if (EXT.has(abs.slice(abs.lastIndexOf(".")))) {
      out.push(abs);
    }
  }
  return out;
}

interface Offender {
  file: string;
  line: number;
  value: string;
}

function findUnapprovedRawColors(files: string[]): Offender[] {
  const offenders: Offender[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);
    const matches = detectRawColor(content);
    for (const m of matches) {
      // An `eslint-disable-next-line vskill/no-raw-color` on the previous
      // non-blank, non-comment-continuation line approves this instance.
      let approved = false;
      for (let prev = m.line - 2; prev >= 0; prev--) {
        const text = lines[prev] ?? "";
        if (text.trim() === "") continue;
        if (/eslint-disable-next-line[^\n]*vskill\/no-raw-color/.test(text)) {
          approved = true;
        }
        break;
      }
      if (!approved) {
        offenders.push({
          file: file.replace(resolve(__dirname, "../../../../"), ""),
          line: m.line,
          value: m.value,
        });
      }
    }
  }
  return offenders;
}

describe("T-043: no raw colors in src/eval-ui/src/pages/", () => {
  const files = walk(PAGES_ROOT);

  it("finds .ts/.tsx files under pages/ to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("has zero un-annotated raw hex/rgb/hsl color literals", () => {
    const offenders = findUnapprovedRawColors(files);
    const report = offenders
      .map((o) => `  ${o.file}:${o.line} — ${o.value}`)
      .join("\n");
    expect(
      offenders,
      `Found ${offenders.length} un-annotated raw color literal(s). ` +
        `Replace with a semantic token (var(--…)) or add ` +
        `\`// eslint-disable-next-line vskill/no-raw-color -- <rationale>\` ` +
        `on the line above:\n${report}`,
    ).toEqual([]);
  });
});
