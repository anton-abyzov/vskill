/**
 * vskill/no-raw-color — bans hex/rgb/hsl color literals in .ts/.tsx files.
 *
 * Rationale: every color in the studio must resolve through Layer 2 semantic
 * tokens (var(--text-primary)) or Tailwind utilities generated from @theme
 * (bg-ink, text-ink-muted). Raw literals break theming (no dark-mode flip)
 * and drift from the token palette defined in ADR-0674-01.
 *
 * Where raw colors ARE allowed:
 *   - `src/eval-ui/src/styles/globals.css` — the single source of Layer 1
 *     token definitions. Enforced via ESLint config files-pattern, not here.
 *
 * The rule itself is a classic ESLint "problem" rule with a Literal visitor.
 * The heavy lifting — matching hex/rgb/hsl — is a pure helper
 * (`detectRawColor`) kept testable in isolation.
 */

// ---------------------------------------------------------------------------
// Pure detection helper (also exported for direct unit testing).
// ---------------------------------------------------------------------------

export type RawColorKind = "hex" | "rgb" | "hsl";

export interface RawColorMatch {
  kind: RawColorKind;
  value: string;
  /** 1-based line number of the match. */
  line: number;
  /** 0-based column of the match within its line. */
  column: number;
}

// Hex: #RGB | #RGBA | #RRGGBB | #RRGGBBAA
// Rgb: rgb(...) or rgba(...) followed by a paren
// Hsl: hsl(...) or hsla(...) followed by a paren
const HEX_RE = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1}|[0-9a-fA-F]{3}|[0-9a-fA-F]{5})?\b/g;
const RGB_RE = /\brgba?\s*\(/gi;
const HSL_RE = /\bhsla?\s*\(/gi;

/** Detect raw color literals inside arbitrary source text. */
export function detectRawColor(source: string): RawColorMatch[] {
  const matches: RawColorMatch[] = [];
  const lineStarts = computeLineStarts(source);

  pushAll(source, HEX_RE, "hex", matches, lineStarts);
  pushAll(source, RGB_RE, "rgb", matches, lineStarts);
  pushAll(source, HSL_RE, "hsl", matches, lineStarts);

  matches.sort((a, b) => a.line - b.line || a.column - b.column);
  return matches;
}

function pushAll(
  source: string,
  re: RegExp,
  kind: RawColorKind,
  out: RawColorMatch[],
  lineStarts: number[],
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const { line, column } = offsetToLineCol(m.index, lineStarts);
    out.push({ kind, value: m[0], line, column });
  }
}

function computeLineStarts(source: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

function offsetToLineCol(
  offset: number,
  lineStarts: number[],
): { line: number; column: number } {
  // Binary search for the largest line start <= offset.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - (lineStarts[lo] ?? 0) };
}

/** Quick predicate for a single string value (rule fast-path). */
export function isRawColorLiteral(value: unknown): RawColorKind | null {
  if (typeof value !== "string") return null;
  if (HEX_RE.test(value)) {
    HEX_RE.lastIndex = 0;
    return "hex";
  }
  HEX_RE.lastIndex = 0;
  if (RGB_RE.test(value)) {
    RGB_RE.lastIndex = 0;
    return "rgb";
  }
  RGB_RE.lastIndex = 0;
  if (HSL_RE.test(value)) {
    HSL_RE.lastIndex = 0;
    return "hsl";
  }
  HSL_RE.lastIndex = 0;
  return null;
}

// ---------------------------------------------------------------------------
// ESLint rule definition (flat-config compatible).
// ESLint isn't a runtime dependency of vskill, so we use structural types
// rather than pulling the @types/eslint package. The shape still matches
// ESLint's flat-config plugin contract.
// ---------------------------------------------------------------------------

interface MinimalNode {
  type: string;
  value?: unknown;
  loc?: { start: { line: number; column: number } };
}

interface MinimalContext {
  report: (descriptor: {
    node: MinimalNode;
    message: string;
    messageId?: string;
    data?: Record<string, string>;
  }) => void;
  getSourceCode: () => { getText: (node?: MinimalNode) => string };
}

export const rule = {
  meta: {
    type: "problem" as const,
    docs: {
      description:
        "Disallow hex/rgb/hsl color literals in studio TypeScript/TSX. Use var(--token) or theme-derived Tailwind utilities.",
      recommended: true,
    },
    schema: [],
    messages: {
      rawColor:
        "Raw {{kind}} color '{{value}}' is not allowed. Use a theme token (var(--text-primary)) or Tailwind utility (bg-ink) instead.",
    },
  },
  create(context: MinimalContext) {
    return {
      Literal(node: MinimalNode) {
        const kind = isRawColorLiteral(node.value);
        if (!kind) return;
        context.report({
          node,
          messageId: "rawColor",
          data: { kind, value: String(node.value) },
          message: `Raw ${kind} color '${String(node.value)}' is not allowed. Use a theme token (var(--text-primary)) or Tailwind utility (bg-ink) instead.`,
        });
      },
    };
  },
};

export default rule;
