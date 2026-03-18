import { describe, it, expect, vi } from "vitest";
import { safeStringify } from "../sse";

describe("safeStringify — edge cases", () => {
  // ── Circular reference variants ──────────────────────────────────────

  it("handles deeply nested circular references (A -> B -> C -> A)", () => {
    const a: any = { name: "a" };
    const b: any = { name: "b" };
    const c: any = { name: "c" };
    a.child = b;
    b.child = c;
    c.child = a; // cycle
    const result = safeStringify(a);
    expect(result).toBeDefined();
    expect(() => JSON.parse(result!)).not.toThrow();
    const parsed = JSON.parse(result!);
    expect(parsed.child.child.child).toBe("[Circular]");
  });

  it("handles multiple references to the same object (diamond shape)", () => {
    const shared = { value: 42 };
    const obj = { left: shared, right: shared };
    // Not circular — same ref appears twice but no cycle
    // Standard JSON.stringify handles this fine (duplicate but no error)
    const result = safeStringify(obj);
    expect(result).toBeDefined();
    const parsed = JSON.parse(result!);
    expect(parsed.left.value).toBe(42);
    expect(parsed.right.value).toBe(42);
  });

  it("handles circular reference inside an array", () => {
    const arr: any[] = [1, 2];
    arr.push(arr); // array referencing itself
    const result = safeStringify(arr);
    expect(result).toBeDefined();
    expect(() => JSON.parse(result!)).not.toThrow();
  });

  // ── Objects with getters that throw ──────────────────────────────────

  it("handles objects with getters that throw errors", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const obj = {
      normal: "value",
      get explosive() {
        throw new Error("getter detonated");
      },
    };
    // JSON.stringify will call the getter and throw — safeStringify should handle it
    const result = safeStringify(obj);
    expect(result).toBeDefined();
    expect(() => JSON.parse(result!)).not.toThrow();
    spy.mockRestore();
  });

  // ── toJSON that returns circular structures ──────────────────────────

  it("handles objects with toJSON that returns a circular structure", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const inner: any = { x: 1 };
    inner.self = inner;
    const obj = {
      toJSON() {
        return inner;
      },
    };
    const result = safeStringify(obj);
    expect(result).toBeDefined();
    expect(() => JSON.parse(result!)).not.toThrow();
    spy.mockRestore();
  });

  it("handles objects with toJSON that throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const obj = {
      toJSON() {
        throw new Error("toJSON exploded");
      },
    };
    const result = safeStringify(obj);
    expect(result).toBeDefined();
    expect(() => JSON.parse(result!)).not.toThrow();
    spy.mockRestore();
  });

  // ── BigInt values ───────────────────────────────────────────────────

  it("handles BigInt values (JSON.stringify throws on BigInt)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const obj = { count: BigInt(9007199254740991) };
    // JSON.stringify throws "Do not know how to serialize a BigInt"
    // The replacer in the fallback path also cannot handle BigInt
    // It should still produce some valid JSON (the final fallback)
    const result = safeStringify(obj);
    expect(result).toBeDefined();
    expect(() => JSON.parse(result!)).not.toThrow();
    spy.mockRestore();
  });

  // ── null vs undefined body ──────────────────────────────────────────

  it("returns 'null' (the string) for null input", () => {
    const result = safeStringify(null);
    expect(result).toBe("null");
  });

  it("returns undefined for undefined input (already tested but verify contract)", () => {
    expect(safeStringify(undefined)).toBeUndefined();
  });

  // ── Empty containers ───────────────────────────────────────────────

  it("serializes empty object {} correctly", () => {
    expect(safeStringify({})).toBe("{}");
  });

  it("serializes empty array [] correctly", () => {
    expect(safeStringify([])).toBe("[]");
  });

  // ── Functions as values ────────────────────────────────────────────

  it("drops function values (same as JSON.stringify behavior)", () => {
    const obj = { name: "test", handler: () => {} };
    const result = safeStringify(obj);
    expect(result).toBeDefined();
    const parsed = JSON.parse(result!);
    expect(parsed.name).toBe("test");
    expect(parsed.handler).toBeUndefined();
  });

  it("returns undefined for a bare function (same as JSON.stringify)", () => {
    const result = safeStringify(() => {});
    expect(result).toBeUndefined();
  });

  // ── Special built-in types ─────────────────────────────────────────

  it("serializes Date objects (toJSON returns ISO string)", () => {
    const d = new Date("2025-01-15T12:00:00Z");
    const result = safeStringify(d);
    expect(result).toBe('"2025-01-15T12:00:00.000Z"');
  });

  it("serializes RegExp to empty object (standard JSON behavior)", () => {
    const result = safeStringify(/test/gi);
    expect(result).toBe("{}");
  });

  it("serializes Map to empty object (standard JSON behavior — Map is not iterable by JSON.stringify)", () => {
    const m = new Map([["key", "value"]]);
    const result = safeStringify(m);
    expect(result).toBe("{}");
  });

  it("serializes Set to empty object (standard JSON behavior)", () => {
    const s = new Set([1, 2, 3]);
    const result = safeStringify(s);
    expect(result).toBe("{}");
  });

  // ── Symbol keys ────────────────────────────────────────────────────

  it("ignores Symbol keys (standard JSON behavior)", () => {
    const sym = Symbol("secret");
    const obj = { normal: "visible", [sym]: "hidden" };
    const result = safeStringify(obj);
    const parsed = JSON.parse(result!);
    expect(parsed.normal).toBe("visible");
    expect(Object.keys(parsed)).toEqual(["normal"]);
  });

  // ── Primitive types ────────────────────────────────────────────────

  it("serializes string primitives", () => {
    expect(safeStringify("hello")).toBe('"hello"');
  });

  it("serializes number primitives", () => {
    expect(safeStringify(42)).toBe("42");
  });

  it("serializes boolean primitives", () => {
    expect(safeStringify(true)).toBe("true");
    expect(safeStringify(false)).toBe("false");
  });

  it("serializes NaN to 'null' (standard JSON behavior)", () => {
    expect(safeStringify(NaN)).toBe("null");
  });

  it("serializes Infinity to 'null' (standard JSON behavior)", () => {
    expect(safeStringify(Infinity)).toBe("null");
  });

  // ── Performance: large objects ─────────────────────────────────────

  it("handles moderately large objects without significant delay", () => {
    const largeObj: Record<string, number> = {};
    for (let i = 0; i < 10_000; i++) {
      largeObj[`key_${i}`] = i;
    }
    const start = performance.now();
    const result = safeStringify(largeObj);
    const elapsed = performance.now() - start;
    expect(result).toBeDefined();
    // Should complete in under 500ms even on slow CI
    expect(elapsed).toBeLessThan(500);
  });

  // ── Nested arrays with holes (sparse arrays) ──────────────────────

  it("handles sparse arrays (holes become null)", () => {
    const arr = [1, , , 4]; // eslint-disable-line no-sparse-arrays
    const result = safeStringify(arr);
    expect(result).toBe("[1,null,null,4]");
  });

  // ── Object with prototype pollution keys ───────────────────────────

  it("handles object with __proto__ key safely", () => {
    // Using Object.create(null) to avoid prototype chain issues
    const obj = JSON.parse('{"__proto__": "polluted", "safe": true}');
    const result = safeStringify(obj);
    expect(result).toBeDefined();
    const parsed = JSON.parse(result!);
    expect(parsed.safe).toBe(true);
  });

  // ── Deeply nested but non-circular objects ─────────────────────────

  it("handles deeply nested objects (100 levels deep)", () => {
    let obj: any = { value: "leaf" };
    for (let i = 0; i < 100; i++) {
      obj = { child: obj };
    }
    const result = safeStringify(obj);
    expect(result).toBeDefined();
    expect(() => JSON.parse(result!)).not.toThrow();
  });
});
