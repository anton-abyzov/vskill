// 0932 (AC-11): the install summary says "copied" when the folders were copied.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installMethodLabel } from "../install-resolution.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vskill-method-"));
  dirs.push(root);
  const real = join(root, "real");
  const copy = join(root, "copy");
  const link = join(root, "link");
  mkdirSync(real);
  mkdirSync(copy);
  symlinkSync(real, link, "dir");
  return { copy, link };
}

describe("installMethodLabel", () => {
  it("says copied when every folder is a real directory", () => {
    const { copy } = setup();
    expect(installMethodLabel([copy], false)).toBe("copied");
  });

  it("says symlinked when every folder is a link", () => {
    const { link } = setup();
    expect(installMethodLabel([link], false)).toBe("symlinked");
  });

  it("counts both when mixed", () => {
    const { copy, link } = setup();
    expect(installMethodLabel([copy, link], false)).toBe("1 copied, 1 symlinked");
  });

  it("honours --copy", () => {
    const { link } = setup();
    expect(installMethodLabel([link], true)).toBe("copied");
  });
});
