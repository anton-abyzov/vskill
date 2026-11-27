// 1496: stripe-refund-auditor was sample output of the multi-file skill
// generator (0815) shipped in the personal plugin. The original now lives as
// an e2e fixture; the plugin copy is deprecated (1.0.1) and inert.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../eval-ui/src/utils/parseFrontmatter.js";
import { readDeprecation } from "../../lib/deprecation.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE_DIR = join(REPO, "e2e/fixtures/skills/stripe-refund-auditor");
const FIXTURE_SKILL_MD = join(FIXTURE_DIR, "SKILL.md");
const PLUGIN_SKILL_MD = join(REPO, "plugins/personal/skills/stripe-refund-auditor/SKILL.md");

/** Paths named in backticks under the SKILL.md "Files in this skill" section. */
function listedFiles(body: string): string[] {
  const section = body.split(/^## Files in this skill\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
}

describe("stripe-refund-auditor fixture", () => {
  it("loads through the Studio frontmatter parser with name equal to its folder", () => {
    const { metadata, body } = parseFrontmatter(readFileSync(FIXTURE_SKILL_MD, "utf8"));
    expect(metadata.name).toBe("stripe-refund-auditor");
    expect(metadata.name).toBe(FIXTURE_DIR.split("/").pop());
    expect(String(metadata.description)).toMatch(/Stripe refunds/);
    expect(String(metadata.description)).not.toMatch(/^DEPRECATED/);
    expect(metadata["integration-file"]).toBe("tests/integration_test.py");
    expect(body).toContain("# /stripe-refund-auditor");
    expect(readDeprecation(readFileSync(FIXTURE_SKILL_MD, "utf8"))).toBeNull();
  });

  it("ships every companion file its SKILL.md names", () => {
    const { body } = parseFrontmatter(readFileSync(FIXTURE_SKILL_MD, "utf8"));
    const files = listedFiles(body);
    expect(files).toEqual(
      expect.arrayContaining([
        "scripts/audit.py",
        "scripts/grader.py",
        "tests/integration_test.py",
        "references/refund-schema.md",
        "evals/evals.json",
        ".env.example",
      ]),
    );
    for (const rel of files) {
      expect(existsSync(join(FIXTURE_DIR, rel)), rel).toBe(true);
    }
    const evals = JSON.parse(readFileSync(join(FIXTURE_DIR, "evals/evals.json"), "utf8"));
    expect(evals).toBeTruthy();
    expect(dirname(FIXTURE_SKILL_MD)).toBe(FIXTURE_DIR);
  });
});

describe("stripe-refund-auditor plugin copy", () => {
  const content = readFileSync(PLUGIN_SKILL_MD, "utf8");

  it("declares the deprecation with the 1486 metadata keys", () => {
    expect(readDeprecation(content)).toEqual({
      message: "Generator sample output, not a user skill; moved to e2e fixtures.",
      replacedBy: "none",
      since: "1.0.1",
    });
    const { metadata } = parseFrontmatter(content);
    expect(metadata.name).toBe("stripe-refund-auditor");
    expect((metadata.metadata as Record<string, string>).version).toBe("1.0.1");
    expect(metadata.version).toBeUndefined();
  });

  it("is inert: no broad trigger and no unprompted run step", () => {
    const { metadata, body } = parseFrontmatter(content);
    expect(String(metadata.description)).toMatch(/^DEPRECATED: /);
    expect(String(metadata.description)).not.toMatch(/audit refunds|refund anomalies|refund activity/i);
    expect(body).not.toMatch(/Run this immediately|Trigger when/);
    expect(body).toContain("e2e/fixtures/skills/stripe-refund-auditor/");
  });
});
