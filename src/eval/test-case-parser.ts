// ---------------------------------------------------------------------------
// test-case-parser.ts — author-anchored activation-test fixtures in SKILL.md
//
// Ports the `## Test Cases` parser from vskill-platform's
// src/lib/eval/prompt-generator.ts:22-48 (parseAuthorTestCases) and adds a
// matching writer + upsert helper. The shape is intentionally identical to the
// platform's so a single SKILL.md can be consumed by both systems.
//
// See increment 0776 for the why.
// ---------------------------------------------------------------------------

export type TestCaseExpected = "should_activate" | "should_not_activate" | "auto";

export interface ParsedTestCase {
  prompt: string;
  expected: TestCaseExpected;
}

const SECTION_RE = /## Test Cases\s*\n([\s\S]*?)(?=\n## |\n---|\n$|$)/i;
const PAIR_RE = /-\s*Prompt:\s*"([^"]+)"\s*\n\s*Expected:\s*"([^"]+)"/gi;

export function parseTestCases(content: string): ParsedTestCase[] {
  if (!content) return [];
  const sectionMatch = content.match(SECTION_RE);
  if (!sectionMatch) return [];
  const section = sectionMatch[1];

  const cases: ParsedTestCase[] = [];
  // Reset lastIndex via a fresh regex each call to keep this function pure
  const pair = new RegExp(PAIR_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = pair.exec(section)) !== null) {
    cases.push({ prompt: m[1], expected: textToExpected(m[2]) });
  }
  return cases;
}

export function serializeTestCases(prompts: ParsedTestCase[]): string {
  if (prompts.length === 0) return "";
  const lines = prompts.map(
    (p) => `- Prompt: "${p.prompt}"\n  Expected: "${expectedToText(p.expected)}"`,
  );
  return `## Test Cases\n\n${lines.join("\n")}\n`;
}

// Replace-or-append the `## Test Cases` block. Empty prompts → remove the
// section entirely (keeps SKILL.md clean when the author clears fixtures).
export function upsertTestCasesIntoSkillMd(
  content: string,
  prompts: ParsedTestCase[],
): string {
  const trimmed = content.replace(/\s+$/, "");
  const hasSection = SECTION_RE.test(trimmed);

  if (prompts.length === 0) {
    if (!hasSection) return content;
    return removeSection(trimmed) + "\n";
  }

  const block = serializeTestCases(prompts).trimEnd();
  if (hasSection) {
    return trimmed.replace(SECTION_RE, block) + "\n";
  }
  return trimmed + "\n\n" + block + "\n";
}

function removeSection(content: string): string {
  // Match the heading + body + trailing whitespace up to the next section
  // boundary, then collapse the gap to a single blank line.
  return content
    .replace(/\n*## Test Cases\s*\n[\s\S]*?(?=\n## |\n---|\n$|$)/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "");
}

function textToExpected(raw: string): TestCaseExpected {
  const norm = raw.trim().toLowerCase();
  if (norm === "should activate") return "should_activate";
  if (norm === "should not activate") return "should_not_activate";
  return "auto";
}

function expectedToText(expected: TestCaseExpected): string {
  if (expected === "should_activate") return "should activate";
  if (expected === "should_not_activate") return "should not activate";
  return "auto";
}
