import { describe, it, expect } from "vitest";
import { passRateColor, passRateBackground } from "../passRateColor.js";

describe("passRateColor", () => {
  it("returns green for passRate >= 0.7", () => {
    expect(passRateColor(0.7)).toBe("var(--green)");
    expect(passRateColor(0.85)).toBe("var(--green)");
    expect(passRateColor(1.0)).toBe("var(--green)");
  });

  it("returns yellow for passRate >= 0.4 and < 0.7", () => {
    expect(passRateColor(0.4)).toBe("var(--yellow)");
    expect(passRateColor(0.45)).toBe("var(--yellow)");
    expect(passRateColor(0.69)).toBe("var(--yellow)");
  });

  it("returns red for passRate < 0.4", () => {
    expect(passRateColor(0.0)).toBe("var(--red)");
    expect(passRateColor(0.15)).toBe("var(--red)");
    expect(passRateColor(0.39)).toBe("var(--red)");
  });

  it("returns tertiary for null/undefined", () => {
    expect(passRateColor(null)).toBe("var(--text-tertiary)");
    expect(passRateColor(undefined)).toBe("var(--text-tertiary)");
  });
});

describe("passRateBackground", () => {
  it("returns green-muted for passRate >= 0.7", () => {
    expect(passRateBackground(0.7)).toBe("var(--green-muted)");
    expect(passRateBackground(0.85)).toBe("var(--green-muted)");
    expect(passRateBackground(1.0)).toBe("var(--green-muted)");
  });

  it("returns yellow-muted for passRate >= 0.4 and < 0.7", () => {
    expect(passRateBackground(0.4)).toBe("var(--yellow-muted)");
    expect(passRateBackground(0.45)).toBe("var(--yellow-muted)");
    expect(passRateBackground(0.69)).toBe("var(--yellow-muted)");
  });

  it("returns red-muted for passRate < 0.4", () => {
    expect(passRateBackground(0.0)).toBe("var(--red-muted)");
    expect(passRateBackground(0.15)).toBe("var(--red-muted)");
    expect(passRateBackground(0.39)).toBe("var(--red-muted)");
  });

  it("returns surface-3 for null/undefined", () => {
    expect(passRateBackground(null)).toBe("var(--surface-3)");
    expect(passRateBackground(undefined)).toBe("var(--surface-3)");
  });
});
