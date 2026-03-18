import { describe, it, expect, vi } from "vitest";
import { safeStringify } from "../sse";

describe("safeStringify", () => {
  it("serializes plain objects identically to JSON.stringify", () => {
    const obj = { foo: "bar", count: 42 };
    expect(safeStringify(obj)).toBe(JSON.stringify(obj));
  });

  it("handles circular references without throwing", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    expect(() => safeStringify(obj)).not.toThrow();
    // Should return a valid JSON string
    expect(() => JSON.parse(safeStringify(obj)!)).not.toThrow();
  });

  it("handles DOM-like objects without throwing", () => {
    // Simulate a DOM node with circular fiber refs
    const domLike: any = { nodeType: 1, tagName: "BUTTON" };
    domLike.__reactFiber = { stateNode: domLike };
    expect(() => safeStringify(domLike)).not.toThrow();
  });

  it("logs technical details to console.error on circular refs", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const obj: any = { a: 1 };
    obj.self = obj;
    safeStringify(obj);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns undefined for undefined input", () => {
    expect(safeStringify(undefined)).toBeUndefined();
  });
});
