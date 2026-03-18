import { describe, it, expect } from "vitest";
import { sanitizeTestType } from "../WorkspaceContext";

describe("sanitizeTestType", () => {
  it('returns "unit" when passed "unit"', () => {
    expect(sanitizeTestType("unit")).toBe("unit");
  });

  it('returns "integration" when passed "integration"', () => {
    expect(sanitizeTestType("integration")).toBe("integration");
  });

  it("returns undefined when passed an object (MouseEvent-like)", () => {
    const mouseEventLike = { type: "click", target: {} };
    expect(sanitizeTestType(mouseEventLike)).toBeUndefined();
  });

  it("returns undefined when passed an empty object", () => {
    expect(sanitizeTestType({} as any)).toBeUndefined();
  });

  it("returns undefined when passed a number", () => {
    expect(sanitizeTestType(42)).toBeUndefined();
  });

  it("returns undefined when passed null", () => {
    expect(sanitizeTestType(null)).toBeUndefined();
  });

  it("returns undefined when passed undefined", () => {
    expect(sanitizeTestType(undefined)).toBeUndefined();
  });

  it("returns undefined when passed an unrecognized string", () => {
    expect(sanitizeTestType("e2e")).toBeUndefined();
  });
});
