// Bundle fetching: a skill installed without its scripts/ is broken, not merely
// degraded. These guard the allowlist that decides what travels with SKILL.md.

import { describe, it, expect } from "vitest";
import { BUNDLE_SUBDIRS, isBundleTextFile } from "../add.js";
import { assertSafeBundlePath } from "../../installer/bundle-files.js";

describe("BUNDLE_SUBDIRS", () => {
  it("covers every directory the installer is willing to write", () => {
    // Every fetched subdir must be writable by the installer, or the install
    // throws on an "Unsupported bundled skill file path".
    for (const dir of BUNDLE_SUBDIRS) {
      expect(() => assertSafeBundlePath(`${dir}/example.md`)).not.toThrow();
    }
  });

  it("includes scripts/ — the regression this fixes", () => {
    expect(BUNDLE_SUBDIRS).toContain("scripts");
    expect(BUNDLE_SUBDIRS).toContain("references");
  });
});

describe("isBundleTextFile", () => {
  it("accepts the text formats skills actually ship", () => {
    for (const name of [
      "SKILL.md", "notes.txt", "config.json", "data.yaml", "build.py",
      "run.sh", "helper.ts", "helper.mjs", "diagram.excalidraw", "icon.svg",
    ]) {
      expect(isBundleTextFile(name), name).toBe(true);
    }
  });

  it("rejects binaries that would be corrupted by string transport", () => {
    for (const name of ["logo.png", "clip.mp4", "font.woff2", "archive.zip", "lib.so"]) {
      expect(isBundleTextFile(name), name).toBe(false);
    }
  });

  it("rejects dotfiles such as .DS_Store", () => {
    expect(isBundleTextFile(".DS_Store")).toBe(false);
    expect(isBundleTextFile(".gitignore")).toBe(false);
  });

  it("is case-insensitive on the extension", () => {
    expect(isBundleTextFile("README.MD")).toBe(true);
    expect(isBundleTextFile("Script.PY")).toBe(true);
  });
});
