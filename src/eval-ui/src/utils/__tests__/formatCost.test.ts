import { describe, it, expect } from "vitest";
import { formatCost, formatTokens } from "../formatCost";

describe("formatCost", () => {
  it("formats small costs with 4 decimal places", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
  });

  it("formats larger costs with 2 decimal places", () => {
    expect(formatCost(1.23456)).toBe("$1.23");
  });

  it("formats zero cost", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("returns N/A for null cost", () => {
    expect(formatCost(null)).toBe("N/A");
  });

  it("returns Free for free billing mode", () => {
    expect(formatCost(0, "free")).toBe("Free");
  });

  it("returns Free for null cost with free billing mode", () => {
    expect(formatCost(null, "free")).toBe("Free");
  });

  it("returns Subscription for subscription billing mode", () => {
    expect(formatCost(null, "subscription")).toBe("Subscription");
  });

  it("formats very small costs with enough precision", () => {
    expect(formatCost(0.0000105)).toBe("$0.0000105");
  });

  it("formats costs between 0.01 and 1 with 4 decimal places", () => {
    expect(formatCost(0.0525)).toBe("$0.0525");
  });

  it("formats costs >= 1 with 2 decimal places", () => {
    expect(formatCost(12.5)).toBe("$12.50");
  });
});

describe("formatTokens", () => {
  it("formats input and output tokens", () => {
    expect(formatTokens(1234, 567)).toBe("1,234 in / 567 out");
  });

  it("returns N/A for null input", () => {
    expect(formatTokens(null, 500)).toBe("N/A");
  });

  it("returns N/A for null output", () => {
    expect(formatTokens(1000, null)).toBe("N/A");
  });

  it("returns N/A for both null", () => {
    expect(formatTokens(null, null)).toBe("N/A");
  });

  it("formats large numbers with commas", () => {
    expect(formatTokens(1234567, 890123)).toBe("1,234,567 in / 890,123 out");
  });

  it("formats zero tokens", () => {
    expect(formatTokens(0, 0)).toBe("0 in / 0 out");
  });
});
