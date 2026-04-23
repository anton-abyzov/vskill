import { describe, expect, it } from "vitest";
import {
  detectRawColor,
  rule as noRawColorRule,
  type RawColorMatch,
} from "../../eslint-rules/no-raw-color";

describe("T-007: vskill/no-raw-color — detectRawColor (AC-US2-06)", () => {
  it("flags 6-digit hex literals", () => {
    const m = detectRawColor(`const style = { color: "#FF0000" };`);
    expect(m.length).toBe(1);
    expect(m[0]?.kind).toBe("hex");
    expect(m[0]?.value).toBe("#FF0000");
  });

  it("flags 3-digit hex literals", () => {
    const m = detectRawColor(`color: "#fff"`);
    expect(m.length).toBe(1);
    expect(m[0]?.kind).toBe("hex");
  });

  it("flags rgb() literals", () => {
    const m = detectRawColor(`background: "rgb(0,0,0)"`);
    expect(m.length).toBe(1);
    expect(m[0]?.kind).toBe("rgb");
  });

  it("flags rgba() literals", () => {
    const m = detectRawColor(`background: "rgba(10, 20, 30, 0.5)"`);
    expect(m.length).toBe(1);
    expect(m[0]?.kind).toBe("rgb");
  });

  it("flags hsl() literals", () => {
    const m = detectRawColor(`color: "hsl(210 50% 50%)"`);
    expect(m.length).toBe(1);
    expect(m[0]?.kind).toBe("hsl");
  });

  it("does NOT flag var(--text-primary) references", () => {
    const m = detectRawColor(`color: "var(--text-primary)"`);
    expect(m.length).toBe(0);
  });

  it("does NOT flag Tailwind utility class tokens like bg-ink", () => {
    const m = detectRawColor(`className="bg-ink text-ink-muted"`);
    expect(m.length).toBe(0);
  });

  it("does NOT flag non-color strings that look similar", () => {
    const m = detectRawColor(`description: "the argb container is fine"`);
    // "argb" is prefixed — rgb( with paren is the signal
    expect(m.length).toBe(0);
  });

  it("flags every violation in a mixed sample", () => {
    const src = `
      const A = { color: "#FF0000", bg: "rgb(10,20,30)", shadow: "hsl(210, 30%, 40%)" };
      const B = { color: "var(--text-primary)" };
    `;
    const m = detectRawColor(src);
    expect(m.length).toBe(3);
    const kinds = m.map((x) => x.kind).sort();
    expect(kinds).toEqual(["hex", "hsl", "rgb"]);
  });

  it("reports a 1-based line number per match", () => {
    const src = [
      "const a = 1;",
      "const b = 2;",
      'const c = "#AABBCC";',
    ].join("\n");
    const m = detectRawColor(src);
    expect(m.length).toBe(1);
    expect((m[0] as RawColorMatch).line).toBe(3);
  });
});

describe("T-007: vskill/no-raw-color rule export shape", () => {
  it("exports an ESLint-style rule object with meta + create", () => {
    expect(noRawColorRule.meta).toBeDefined();
    expect(noRawColorRule.meta.type).toBe("problem");
    expect(typeof noRawColorRule.create).toBe("function");
  });

  it("rule create() returns a Literal visitor that reports raw colors", () => {
    const reports: unknown[] = [];
    const fakeContext = {
      report: (r: unknown) => reports.push(r),
      getSourceCode: () => ({
        getText: () => '"#FF0000"',
      }),
    };
    const visitor = noRawColorRule.create(fakeContext as never);
    expect(visitor.Literal).toBeDefined();
    // Simulate visiting a Literal node that holds the raw color.
    visitor.Literal?.({
      type: "Literal",
      value: "#FF0000",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } },
    } as never);
    expect(reports.length).toBe(1);
  });

  it("rule ignores Literal nodes that are not raw-color strings", () => {
    const reports: unknown[] = [];
    const fakeContext = {
      report: (r: unknown) => reports.push(r),
      getSourceCode: () => ({ getText: () => '"hello"' }),
    };
    const visitor = noRawColorRule.create(fakeContext as never);
    visitor.Literal?.({
      type: "Literal",
      value: "hello",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 7 } },
    } as never);
    expect(reports.length).toBe(0);
  });
});

describe("T-007: eslint.config.js registers the rule", () => {
  it("imports the no-raw-color module and exposes the rule under vskill/no-raw-color", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const cfgPath = resolve(__dirname, "../../../../eslint.config.js");
    const cfg = readFileSync(cfgPath, "utf8");
    expect(cfg).toMatch(/no-raw-color/);
    expect(cfg).toMatch(/vskill/);
  });
});
