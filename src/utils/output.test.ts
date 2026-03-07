import { describe, it, expect } from "vitest";
import { formatInstalls } from "./output.js";

describe("formatInstalls", () => {
  it("returns raw number below 1000", () => {
    expect(formatInstalls(0)).toBe("0");
    expect(formatInstalls(999)).toBe("999");
  });

  it("formats exact thousands without decimal", () => {
    expect(formatInstalls(1000)).toBe("1K");
  });

  it("formats thousands with one decimal", () => {
    expect(formatInstalls(1200)).toBe("1.2K");
    expect(formatInstalls(1250)).toBe("1.3K");
    expect(formatInstalls(9999)).toBe("10K");
  });

  it("formats ten-thousands without decimal", () => {
    expect(formatInstalls(10000)).toBe("10K");
    expect(formatInstalls(999999)).toBe("999K");
  });

  it("formats exact millions without decimal", () => {
    expect(formatInstalls(1000000)).toBe("1M");
  });

  it("formats millions with one decimal", () => {
    expect(formatInstalls(3400000)).toBe("3.4M");
    expect(formatInstalls(10000000)).toBe("10M");
  });
});
