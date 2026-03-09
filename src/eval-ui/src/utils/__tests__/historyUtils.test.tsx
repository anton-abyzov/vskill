import { describe, it, expect } from "vitest";
import { passRateColor, shortDate, fmtDuration, MiniTrend } from "../historyUtils";
import type { CaseHistoryEntry } from "../../types";

describe("passRateColor", () => {
  it("returns green for rate >= 0.8", () => {
    expect(passRateColor(0.9)).toBe("var(--green)");
    expect(passRateColor(0.8)).toBe("var(--green)");
    expect(passRateColor(1.0)).toBe("var(--green)");
  });

  it("returns yellow for rate >= 0.5 and < 0.8", () => {
    expect(passRateColor(0.65)).toBe("var(--yellow)");
    expect(passRateColor(0.5)).toBe("var(--yellow)");
    expect(passRateColor(0.79)).toBe("var(--yellow)");
  });

  it("returns red for rate < 0.5", () => {
    expect(passRateColor(0.3)).toBe("var(--red)");
    expect(passRateColor(0.0)).toBe("var(--red)");
    expect(passRateColor(0.49)).toBe("var(--red)");
  });
});

describe("shortDate", () => {
  it("formats ISO string to short date with time", () => {
    // Use a fixed UTC date and check the output contains expected parts
    const result = shortDate("2026-03-09T14:30:00.000Z");
    // Should contain month abbreviation and day
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/9|09/);
    // Should contain time portion
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
});

describe("fmtDuration", () => {
  it("formats milliseconds >= 1000 as seconds", () => {
    expect(fmtDuration(2500)).toBe("2.5s");
    expect(fmtDuration(1000)).toBe("1.0s");
  });

  it("formats milliseconds < 1000 as ms", () => {
    expect(fmtDuration(450)).toBe("450ms");
    expect(fmtDuration(0)).toBe("0ms");
  });

  it("returns dash for undefined", () => {
    expect(fmtDuration(undefined)).toBe("--");
  });
});

function makeEntry(pass_rate: number, timestamp = "2026-03-09T12:00:00Z"): CaseHistoryEntry {
  return {
    timestamp,
    model: "sonnet",
    type: "benchmark",
    pass_rate,
    assertions: [],
  };
}

describe("MiniTrend", () => {
  it("returns null for empty entries", () => {
    const result = MiniTrend({ entries: [] });
    expect(result).toBeNull();
  });

  it("returns null for one entry", () => {
    const result = MiniTrend({ entries: [makeEntry(0.8)] });
    expect(result).toBeNull();
  });

  it("returns SVG element for two entries", () => {
    const entries = [makeEntry(0.8), makeEntry(0.6)];
    const result = MiniTrend({ entries });
    expect(result).not.toBeNull();
    // JSX element has type "svg"
    expect(result?.type).toBe("svg");
  });

  it("returns SVG element for many entries", () => {
    const entries = [makeEntry(0.9), makeEntry(0.7), makeEntry(0.8), makeEntry(0.6), makeEntry(1.0)];
    const result = MiniTrend({ entries });
    expect(result).not.toBeNull();
    expect(result?.type).toBe("svg");
  });
});
