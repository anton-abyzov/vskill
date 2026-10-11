// ---------------------------------------------------------------------------
// The CLI scanner and the vskill-platform scanner must flag the same text the
// same way for the rules they deliberately share. This reads the platform's
// patterns.ts and installer-hosts.ts when a checkout is present and checks
// that each shared rule's pattern expression and severity, and the fragments
// those expressions are built from, are byte-identical. Without a platform
// checkout (CI) the suite is skipped.
//
// The checkout is found at $VSKILL_PLATFORM_DIR, or next to this repo as
// vskill-platform-scanners or vskill-platform.
//
// Deliberate CLI differences, not checked here:
//  - CI-011 (PowerShell download-and-execute) exists only in the CLI.
//  - CT-004, CI-004 and CE-001 keep the CLI's regex; the CLI's CT-004 is the
//    narrower, later fix.
//  - CI-002, CI-005, PE-001, PE-002, PE-003, NA-003 and DE-005 keep the CLI's
//    severity (DE-005 takes the platform's regex). The platform relaxed them
//    because its LLM judge backs Tier 1; the CLI install gate runs on Tier 1
//    alone.
//  - The CLI's DOCUMENTATION_SAFE_PATTERNS set, its CI-010 exceptions and its
//    per-occurrence scoring.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const PLATFORM_SCANNER = join("src", "lib", "scanner");

/** Rules whose pattern expression and severity must match the platform. */
const SHARED_RULES = [
  "CI-006", "CI-008", "CT-001", "CT-005", "FS-002", "FS-003", "DE-004",
  "NA-002", "NA-004",
  "DCI-001", "DCI-002", "DCI-003", "DCI-004", "DCI-005", "DCI-006", "DCI-007",
  "DCI-008", "DCI-009", "DCI-010", "DCI-011", "DCI-012", "DCI-013", "DCI-014",
];
/** Rules whose pattern expression must match but whose severity is the CLI's. */
const SHARED_PATTERN_ONLY = ["DE-005"];

/** Fragments the shared expressions interpolate, by file. */
const SHARED_FRAGMENTS: Record<string, string[]> = {
  "patterns.ts": ["NETCAT_COMMAND", "OFFICIAL_INSTALLER_URL_SOURCE_NO_DOT_SEGMENTS", "FS_CALL", "SAFE_DCI_PATTERNS"],
  "installer-hosts.ts": [
    "OFFICIAL_INSTALLER_HOSTS",
    "OFFICIAL_INSTALLER_GITHUB_OWNERS",
    "OFFICIAL_INSTALLER_URL_SOURCE",
    "DOT_SEGMENT_URL_SOURCE",
    "DOT_SEGMENT_RE",
  ],
};

function platformScannerDir(): string | null {
  const candidates = [
    process.env.VSKILL_PLATFORM_DIR,
    join(REPO_ROOT, "..", "vskill-platform-scanners"),
    join(REPO_ROOT, "..", "vskill-platform"),
  ];
  for (const dir of candidates) {
    if (dir && existsSync(join(dir, PLATFORM_SCANNER, "patterns.ts"))) return join(dir, PLATFORM_SCANNER);
  }
  return null;
}

/** Drops whole-line `//` comments, which each repo words its own way. */
function withoutComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

interface RuleText {
  severity: string;
  pattern: string;
}

/** The severity and the `pattern:` expression of one SCAN_PATTERNS entry. */
function ruleText(source: string, id: string): RuleText | null {
  const at = source.indexOf(`id: "${id}",`);
  if (at < 0) return null;
  const end = source.indexOf("\n  },", at);
  const block = withoutComments(source.slice(at, end < 0 ? undefined : end));
  const severity = /\bseverity: "(\w+)"/.exec(block)?.[1] ?? "";
  const pattern = /\n\s*pattern:([\s\S]*?)\n\s*category:/.exec(block)?.[1]?.trim() ?? "";
  return { severity, pattern };
}

/** The statement defining a top-level const, from `const` to the first `;` that ends a line. */
function constText(source: string, name: string): string | null {
  const m = new RegExp(String.raw`^(?:export )?const ${name}\b`, "m").exec(source);
  if (!m) return null;
  const rest = source.slice(m.index);
  const end = /;\n/.exec(rest);
  return withoutComments(rest.slice(0, end ? end.index + 1 : rest.length)).replace(/^export /, "");
}

const platformDir = platformScannerDir();

describe.skipIf(!platformDir)("shared scanner rules match the platform", () => {
  const read = (dir: string, file: string): string => readFileSync(join(dir, file), "utf8");

  it("each shared rule has the platform's pattern expression and severity", () => {
    const platform = read(platformDir!, "patterns.ts");
    const cli = read(HERE, "patterns.ts");
    const drift: string[] = [];
    for (const id of [...SHARED_RULES, ...SHARED_PATTERN_ONLY]) {
      const p = ruleText(platform, id);
      const c = ruleText(cli, id);
      if (!p || !c) {
        drift.push(`${id} missing from ${p ? "CLI" : "platform"}`);
        continue;
      }
      if (!p.pattern) drift.push(`${id} pattern not parsed`);
      if (c.pattern !== p.pattern) drift.push(`${id} pattern`);
      if (SHARED_RULES.includes(id) && c.severity !== p.severity) drift.push(`${id} severity ${c.severity} != ${p.severity}`);
    }
    expect(drift).toEqual([]);
  });

  it("the fragments those rules are built from are identical", () => {
    const drift: string[] = [];
    for (const [file, names] of Object.entries(SHARED_FRAGMENTS)) {
      const platform = read(platformDir!, file);
      const cli = read(HERE, file);
      for (const name of names) {
        const p = constText(platform, name);
        const c = constText(cli, name);
        if (!p || !c) drift.push(`${file} ${name} missing from ${p ? "CLI" : "platform"}`);
        else if (c !== p) drift.push(`${file} ${name}`);
      }
    }
    expect(drift).toEqual([]);
  });
});
