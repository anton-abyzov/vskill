import { describe, it, expect } from "vitest";
import { sanitizeTestType } from "../WorkspaceContext";

describe("sanitizeTestType — edge cases", () => {
  // ── Empty and whitespace strings ───────────────────────────────────

  it('returns undefined for empty string ""', () => {
    expect(sanitizeTestType("")).toBeUndefined();
  });

  it('returns undefined for whitespace-padded " unit "', () => {
    expect(sanitizeTestType(" unit ")).toBeUndefined();
  });

  it('returns undefined for whitespace-padded " integration "', () => {
    expect(sanitizeTestType(" integration ")).toBeUndefined();
  });

  it("returns undefined for tab/newline whitespace", () => {
    expect(sanitizeTestType("\tunit\n")).toBeUndefined();
  });

  // ── Case sensitivity ──────────────────────────────────────────────

  it('returns undefined for "Unit" (capital U)', () => {
    expect(sanitizeTestType("Unit")).toBeUndefined();
  });

  it('returns undefined for "UNIT" (all caps)', () => {
    expect(sanitizeTestType("UNIT")).toBeUndefined();
  });

  it('returns undefined for "Integration" (capital I)', () => {
    expect(sanitizeTestType("Integration")).toBeUndefined();
  });

  it('returns undefined for "INTEGRATION" (all caps)', () => {
    expect(sanitizeTestType("INTEGRATION")).toBeUndefined();
  });

  it('returns undefined for "uNiT" (mixed case)', () => {
    expect(sanitizeTestType("uNiT")).toBeUndefined();
  });

  // ── Numeric edge cases ────────────────────────────────────────────

  it("returns undefined for 0", () => {
    expect(sanitizeTestType(0)).toBeUndefined();
  });

  it("returns undefined for 1", () => {
    expect(sanitizeTestType(1)).toBeUndefined();
  });

  it("returns undefined for NaN", () => {
    expect(sanitizeTestType(NaN)).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(sanitizeTestType(Infinity)).toBeUndefined();
  });

  it("returns undefined for -Infinity", () => {
    expect(sanitizeTestType(-Infinity)).toBeUndefined();
  });

  // ── Boolean values ─────────────────────────────────────────────────

  it("returns undefined for true", () => {
    expect(sanitizeTestType(true)).toBeUndefined();
  });

  it("returns undefined for false", () => {
    expect(sanitizeTestType(false)).toBeUndefined();
  });

  // ── null explicitly ────────────────────────────────────────────────

  it("returns undefined for null", () => {
    expect(sanitizeTestType(null)).toBeUndefined();
  });

  // ── Complex types ──────────────────────────────────────────────────

  it("returns undefined for array", () => {
    expect(sanitizeTestType(["unit"])).toBeUndefined();
  });

  it("returns undefined for nested object", () => {
    expect(sanitizeTestType({ type: "unit" })).toBeUndefined();
  });

  it("returns undefined for array containing 'unit'", () => {
    expect(sanitizeTestType(["unit", "integration"])).toBeUndefined();
  });

  // ── Prototype pollution attempts ───────────────────────────────────

  it("returns undefined for object with __proto__ set to 'unit'", () => {
    // This should NOT return "unit" — the value itself is an object
    const crafted = JSON.parse('{"__proto__": "unit"}');
    expect(sanitizeTestType(crafted)).toBeUndefined();
  });

  it("returns undefined for Object.create(null)", () => {
    expect(sanitizeTestType(Object.create(null))).toBeUndefined();
  });

  // ── Symbol values ──────────────────────────────────────────────────

  it("returns undefined for Symbol", () => {
    expect(sanitizeTestType(Symbol("unit"))).toBeUndefined();
  });

  it("returns undefined for Symbol.iterator", () => {
    expect(sanitizeTestType(Symbol.iterator)).toBeUndefined();
  });

  // ── Function values ────────────────────────────────────────────────

  it("returns undefined for a function", () => {
    expect(sanitizeTestType(() => "unit")).toBeUndefined();
  });

  // ── Similar but incorrect strings ─────────────────────────────────

  it('returns undefined for "units" (close but not exact)', () => {
    expect(sanitizeTestType("units")).toBeUndefined();
  });

  it('returns undefined for "unittest" (no space)', () => {
    expect(sanitizeTestType("unittest")).toBeUndefined();
  });

  it('returns undefined for "unit test"', () => {
    expect(sanitizeTestType("unit test")).toBeUndefined();
  });

  it('returns undefined for "e2e"', () => {
    expect(sanitizeTestType("e2e")).toBeUndefined();
  });

  it('returns undefined for "benchmark"', () => {
    expect(sanitizeTestType("benchmark")).toBeUndefined();
  });

  // ── Valid values still work (sanity) ───────────────────────────────

  it('returns "unit" for exact "unit"', () => {
    expect(sanitizeTestType("unit")).toBe("unit");
  });

  it('returns "integration" for exact "integration"', () => {
    expect(sanitizeTestType("integration")).toBe("integration");
  });
});
