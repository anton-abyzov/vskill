// 0845 T-010 — safeAppendYamlList edge-case coverage (ADR-0845-03).
//
// Algorithm contract:
//   1. File missing  → create file with `key:\n  - value\n`, status "created"
//   2. Key missing in existing file → append `key:\n  - value\n`, status "appended", backup written
//   3. Key present as empty (`key:` then no items)  → replace with `key:\n  - value\n`, status "appended", backup written
//   4. Key present with items, value absent → insert `  - value` at end of list block, status "appended", backup written
//   5. Key present with items, value already in list → no write, status "already-present"
//   6. Malformed YAML (unclosed string, tab-only indent, leading garbage) → throw MalformedConfigError, file untouched
//   7. Key present as inline list (`key: [a, b]`) or scalar → throw IncompatibleConfigError, file untouched
//   8. .bak collision-safe: writes .bak first; if .bak exists, tries .bak.1, .bak.2, ...
//
// All tests run against a fresh tmpdir per case so they're independent and
// platform-portable.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  safeAppendYamlList,
  MalformedConfigError,
  IncompatibleConfigError,
} from "../yaml-safe-mutate.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "vskill-yaml-test-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function backupFiles(dir: string, name: string): string[] {
  return readdirSync(dir).filter((f) => f.startsWith(`${name}.bak`));
}

describe("safeAppendYamlList — file lifecycle", () => {
  it("creates the file when missing (status=created, no backup)", () => {
    const file = join(workDir, "conf.yml");
    const r = safeAppendYamlList(file, "read", "/path/a.md");
    expect(r.status).toBe("created");
    expect(read(file)).toBe("read:\n  - /path/a.md\n");
    expect(backupFiles(workDir, "conf.yml")).toHaveLength(0);
  });

  it("appends the value to an existing list (status=appended, backup written)", () => {
    const file = join(workDir, "conf.yml");
    writeFileSync(file, "read:\n  - /old.md\n");
    const r = safeAppendYamlList(file, "read", "/new.md");
    expect(r.status).toBe("appended");
    expect(read(file)).toBe("read:\n  - /old.md\n  - /new.md\n");
    expect(r.backupPath).toBeDefined();
    expect(backupFiles(workDir, "conf.yml")).toHaveLength(1);
    expect(read(r.backupPath!)).toBe("read:\n  - /old.md\n");
  });

  it("is idempotent — second call with the same value returns already-present (no write, no backup)", () => {
    const file = join(workDir, "conf.yml");
    writeFileSync(file, "read:\n  - /a.md\n");
    const r = safeAppendYamlList(file, "read", "/a.md");
    expect(r.status).toBe("already-present");
    expect(read(file)).toBe("read:\n  - /a.md\n");
    expect(backupFiles(workDir, "conf.yml")).toHaveLength(0);
  });
});

describe("safeAppendYamlList — key-state variants", () => {
  it("key absent in non-empty file → appends new list at end", () => {
    const file = join(workDir, "conf.yml");
    writeFileSync(file, "model: gpt-4\nauto-commits: true\n");
    const r = safeAppendYamlList(file, "read", "/new.md");
    expect(r.status).toBe("appended");
    expect(read(file)).toBe(
      "model: gpt-4\nauto-commits: true\nread:\n  - /new.md\n",
    );
  });

  it("key present with empty value (`read:` alone) → replaces with full list", () => {
    const file = join(workDir, "conf.yml");
    writeFileSync(file, "read:\nmodel: gpt-4\n");
    const r = safeAppendYamlList(file, "read", "/new.md");
    expect(r.status).toBe("appended");
    expect(read(file)).toBe("read:\n  - /new.md\nmodel: gpt-4\n");
  });

  it("4-space indented list — appends with the same indent it found", () => {
    const file = join(workDir, "conf.yml");
    writeFileSync(file, "read:\n    - /existing.md\n");
    const r = safeAppendYamlList(file, "read", "/new.md");
    expect(r.status).toBe("appended");
    expect(read(file)).toBe("read:\n    - /existing.md\n    - /new.md\n");
  });

  it("trailing whitespace on existing list lines is preserved as-is (no rewrite)", () => {
    const file = join(workDir, "conf.yml");
    writeFileSync(file, "read:\n  - /a.md  \n");
    const r = safeAppendYamlList(file, "read", "/b.md");
    expect(r.status).toBe("appended");
    // The existing line is preserved verbatim (trailing spaces intact); the
    // appended line uses canonical (no trailing whitespace) form.
    expect(read(file)).toBe("read:\n  - /a.md  \n  - /b.md\n");
  });

  it("missing trailing newline on source file → output ends with one newline", () => {
    const file = join(workDir, "conf.yml");
    writeFileSync(file, "read:\n  - /a.md");
    const r = safeAppendYamlList(file, "read", "/b.md");
    expect(r.status).toBe("appended");
    expect(read(file)).toBe("read:\n  - /a.md\n  - /b.md\n");
  });
});

describe("safeAppendYamlList — error paths (file unchanged)", () => {
  it("inline list (`read: [a, b]`) → IncompatibleConfigError, file unchanged", () => {
    const file = join(workDir, "conf.yml");
    const before = "read: [/a.md, /b.md]\n";
    writeFileSync(file, before);
    expect(() => safeAppendYamlList(file, "read", "/c.md")).toThrow(
      IncompatibleConfigError,
    );
    expect(read(file)).toBe(before);
    expect(backupFiles(workDir, "conf.yml")).toHaveLength(0);
  });

  it("scalar value at the key (`read: \"single\"`) → IncompatibleConfigError", () => {
    const file = join(workDir, "conf.yml");
    const before = `read: "single"\n`;
    writeFileSync(file, before);
    expect(() => safeAppendYamlList(file, "read", "/c.md")).toThrow(
      IncompatibleConfigError,
    );
    expect(read(file)).toBe(before);
  });

  it("tab-indented list → MalformedConfigError (tabs are illegal in YAML indent)", () => {
    const file = join(workDir, "conf.yml");
    const before = "read:\n\t- /a.md\n";
    writeFileSync(file, before);
    expect(() => safeAppendYamlList(file, "read", "/b.md")).toThrow(
      MalformedConfigError,
    );
    expect(read(file)).toBe(before);
  });

  it("unclosed quoted string in source → MalformedConfigError", () => {
    const file = join(workDir, "conf.yml");
    const before = `model: "gpt-4\nread:\n  - /a.md\n`;
    writeFileSync(file, before);
    expect(() => safeAppendYamlList(file, "read", "/b.md")).toThrow(
      MalformedConfigError,
    );
    expect(read(file)).toBe(before);
  });
});

describe("safeAppendYamlList — backup collision safety", () => {
  it(".bak collision uses .bak.1 instead of overwriting", () => {
    const file = join(workDir, "conf.yml");
    writeFileSync(file, "read:\n  - /old.md\n");
    writeFileSync(`${file}.bak`, "pre-existing-backup");
    const r = safeAppendYamlList(file, "read", "/new.md");
    expect(r.status).toBe("appended");
    expect(read(`${file}.bak`)).toBe("pre-existing-backup");
    expect(r.backupPath).toBe(`${file}.bak.1`);
    expect(existsSync(r.backupPath!)).toBe(true);
  });

  it(".bak and .bak.1 occupied → uses .bak.2", () => {
    const file = join(workDir, "conf.yml");
    writeFileSync(file, "read:\n  - /old.md\n");
    writeFileSync(`${file}.bak`, "b0");
    writeFileSync(`${file}.bak.1`, "b1");
    const r = safeAppendYamlList(file, "read", "/new.md");
    expect(r.backupPath).toBe(`${file}.bak.2`);
    expect(read(`${file}.bak`)).toBe("b0");
    expect(read(`${file}.bak.1`)).toBe("b1");
  });
});
