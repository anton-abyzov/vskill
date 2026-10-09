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

const HEADING_RE = /^## Test Cases[ \t]*\r?\n/im;
const PAIR_RE = /-\s*Prompt:\s*"([^"]+)"\s*\n\s*Expected:\s*"([^"]+)"/gi;

export function parseTestCases(content: string): ParsedTestCase[] {
  if (!content) return [];
  const bounds = findSection(content);
  if (!bounds) return [];
  const section = content.slice(bounds.bodyStart, bounds.end);

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
  const section = findSection(trimmed);

  if (prompts.length === 0) {
    if (!section) return content;
    return (trimmed.slice(0, section.start) + trimmed.slice(section.end))
      .replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  const block = serializeTestCases(prompts).trimEnd();
  if (section) {
    // Slices preserve literal $&, $` and $' in user-authored prompts.
    return trimmed.slice(0, section.start) + block + trimmed.slice(section.end) + "\n";
  }
  return trimmed + "\n\n" + block + "\n";
}

/** Locate real section boundaries, ignoring headings inside a quoted prompt.
 * Keep raw prompt text for compatibility with existing published SKILL.md files.
 */
function findSection(content: string): { start: number; bodyStart: number; end: number } | null {
  const heading = HEADING_RE.exec(content);
  if (!heading) return null;
  const bodyStart = heading.index + heading[0].length;
  const body = content.slice(bodyStart);
  const pairs = [...body.matchAll(new RegExp(PAIR_RE.source, "gi"))];
  const boundaries = body.matchAll(/^##[ \t]+|^---[ \t]*(?:\r?$)/gm);
  for (const boundary of boundaries) {
    const index = boundary.index!;
    if (pairs.some((pair) => index >= pair.index! && index < pair.index! + pair[0].length)) continue;
    // Leave the newline before the next heading intact when replacing.
    let end = bodyStart + index;
    if (content[end - 1] === "\n") end--;
    if (content[end - 1] === "\r") end--;
    return { start: heading.index, bodyStart, end };
  }
  return { start: heading.index, bodyStart, end: content.length };
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
