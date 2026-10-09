import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { macosPlatformKeys } from "./macos-platform-keys.mjs";

const script = fileURLToPath(new URL("./macos-platform-keys.mjs", import.meta.url));

describe("generic macOS updater bundle architecture", () => {
  it.each([
    ["aarch64", ["darwin-aarch64"]],
    ["x86_64", ["darwin-x86_64"]],
    ["universal", ["darwin-aarch64", "darwin-x86_64"]],
  ])("advertises only the explicitly built %s targets", (arch, keys) => {
    expect(macosPlatformKeys(arch)).toEqual(keys);
    expect(execFileSync(process.execPath, [script, arch], { encoding: "utf8" }).trim().split(" ")).toEqual(keys);
  });

  it.each([undefined, "", "arm64", "unknown"])("refuses an ambiguous build target %s before publishing", (arch) => {
    expect(() => macosPlatformKeys(arch)).toThrow(/MACOS_ARCH/);
    expect(() => execFileSync(process.execPath, [script, ...(arch === undefined ? [] : [arch])], { stdio: "pipe" })).toThrow();
  });
});
