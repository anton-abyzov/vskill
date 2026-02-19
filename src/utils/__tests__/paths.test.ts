import { describe, it, expect } from "vitest";
import os from "node:os";
import { resolveTilde } from "../paths.js";

describe("resolveTilde (T-004)", () => {
  const home = os.homedir();

  it("TC-009: resolves ~ to home directory", () => {
    expect(resolveTilde("~/some/path")).toBe(`${home}/some/path`);
  });

  it("TC-010: passes through absolute paths unchanged", () => {
    expect(resolveTilde("/usr/local/bin")).toBe("/usr/local/bin");
  });

  it("TC-011: passes through relative paths unchanged", () => {
    expect(resolveTilde("./local/dir")).toBe("./local/dir");
  });

  it("resolves bare ~ to home directory", () => {
    expect(resolveTilde("~")).toBe(home);
  });

  it("does not resolve tilde in middle of path", () => {
    expect(resolveTilde("/some/~/path")).toBe("/some/~/path");
  });
});
