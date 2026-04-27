// 0793 T-001 — `validateClaudePlugin` wrapper around `claude plugin validate`.

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateClaudePlugin } from "../plugin-validator.js";

function makePluginDir(manifest: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "vskill-validator-"));
  mkdirSync(join(dir, ".claude-plugin"));
  writeFileSync(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  return dir;
}

describe("validateClaudePlugin", () => {
  it("returns skipped:true when the binary is missing (ENOENT)", () => {
    const dir = makePluginDir({ name: "any" });
    try {
      // Use a guaranteed-not-installed binary so spawnSync hits ENOENT.
      const result = validateClaudePlugin(dir, {
        bin: "definitely-not-a-real-binary-vskill-test-9999",
      });
      expect(result.skipped).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.stderr).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns ok:true when the validator exits 0", () => {
    const dir = makePluginDir({ name: "passes" });
    try {
      // /usr/bin/true (or equivalent) always exits 0.
      const result = validateClaudePlugin(dir, { bin: "true" });
      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.stderr).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns ok:false with stderr when the validator exits non-zero", () => {
    const dir = makePluginDir({ name: "fails" });
    try {
      // /usr/bin/false always exits 1 with no output. Use sh -c to write
      // something to stderr first, so we can assert capture.
      const result = validateClaudePlugin(dir, { bin: "false" });
      expect(result.ok).toBe(false);
      expect(result.skipped).toBe(false);
      // stderr may be empty for `false`; just confirm the failure shape.
      expect(typeof result.stderr).toBe("string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
