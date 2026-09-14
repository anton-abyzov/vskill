import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveLocalSkillRoot } from "./local-root.js";

let root: string;
let child: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vskill-local-root-"));
  child = join(root, "child", "src");
  mkdirSync(child, { recursive: true });
  mkdirSync(join(root, ".specweave"));
  writeFileSync(join(root, ".specweave", "config.json"), "{}");
  vi.spyOn(process, "cwd").mockReturnValue(child);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});
it("finds a nearer lockfile before the SpecWeave umbrella", () => {
  writeFileSync(join(root, "vskill.lock"), "{}");
  writeFileSync(join(root, "child", "vskill.lock"), "{}");
  expect(resolveLocalSkillRoot()).toBe(join(root, "child"));
});
it("keeps the current installation boundary even when its lockfile is malformed", () => {
  writeFileSync(join(child, "vskill.lock"), "broken");
  expect(resolveLocalSkillRoot()).toBe(child);
});
it("preserves the SpecWeave root when no nested installation owns a lockfile", () => {
  expect(resolveLocalSkillRoot()).toBe(root);
});
it("falls back to the current directory outside a SpecWeave project", () => {
  rmSync(join(root, ".specweave"), { recursive: true });
  expect(resolveLocalSkillRoot()).toBe(child);
});
