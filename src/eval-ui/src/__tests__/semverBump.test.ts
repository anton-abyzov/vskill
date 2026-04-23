import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyBump, BUMP_COLORS } from "../utils/semverBump";

describe("classifyBump", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'major' when the major number increases", () => {
    expect(classifyBump("1.0.0", "2.0.0")).toBe("major");
  });

  it("returns 'minor' when only minor increases", () => {
    expect(classifyBump("1.0.0", "1.1.0")).toBe("minor");
  });

  it("returns 'patch' when only patch increases", () => {
    expect(classifyBump("1.0.0", "1.0.1")).toBe("patch");
  });

  it("returns 'patch' and warns when the installed version is unparseable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(classifyBump("abc", "1.0.0")).toBe("patch");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns 'patch' and warns when the latest version is unparseable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(classifyBump("1.0.0", "xyz")).toBe("patch");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("BUMP_COLORS exposes a bg/text pair for each bump kind", () => {
    expect(BUMP_COLORS.major.bg).toMatch(/red/);
    expect(BUMP_COLORS.minor.bg).toMatch(/yellow/);
    expect(BUMP_COLORS.patch.bg).toMatch(/green/);
  });
});
