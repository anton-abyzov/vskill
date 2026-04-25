// ---------------------------------------------------------------------------
// 0728 — checkDistFreshness helper
//
// AC-US3-01: scans src/eval-server/ + src/utils/ vs dist/eval-server/ + dist/utils/.
// AC-US3-02: returns { stale: true, details } when src is newer than dist.
// AC-US3-03: returns { stale: false } when dist is current OR dist/ is missing.
// AC-US3-04: never throws; fs errors are swallowed silently.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { checkDistFreshness } from "../check-dist-freshness.js";

function setMtime(path: string, secondsAgo: number): void {
  const now = Date.now() / 1000;
  const mtime = now - secondsAgo;
  utimesSync(path, mtime, mtime);
}

describe("0728 — checkDistFreshness", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vskill-0728-freshness-"));
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* */ }
  });

  function makeFile(rel: string, secondsAgo: number): void {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "// stub\n", "utf-8");
    setMtime(full, secondsAgo);
  }

  it("AC-US3-02: returns { stale: true } when src is newer than dist", () => {
    makeFile("src/eval-server/server.ts", 1);     // 1s ago — newer
    makeFile("src/utils/version.ts", 1);
    makeFile("dist/eval-server/server.js", 600);  // 10 min ago — stale
    makeFile("dist/utils/version.js", 600);

    const result = checkDistFreshness(root);
    expect(result.stale).toBe(true);
    expect(result.details).toBeTruthy();
    expect(typeof result.details).toBe("string");
  });

  it("AC-US3-03: returns { stale: false } when dist is newer than src", () => {
    makeFile("src/eval-server/server.ts", 600);   // 10 min ago — older
    makeFile("src/utils/version.ts", 600);
    makeFile("dist/eval-server/server.js", 1);    // 1s ago — fresh
    makeFile("dist/utils/version.js", 1);

    const result = checkDistFreshness(root);
    expect(result.stale).toBe(false);
  });

  it("AC-US3-03: returns { stale: false } when dist directory does not exist", () => {
    makeFile("src/eval-server/server.ts", 1);
    makeFile("src/utils/version.ts", 1);
    // No dist/ created — production install scenario.

    const result = checkDistFreshness(root);
    expect(result.stale).toBe(false);
  });

  it("AC-US3-03: returns { stale: false } when src directory does not exist", () => {
    makeFile("dist/eval-server/server.js", 1);
    // No src/ — also a degenerate prod-install case.

    const result = checkDistFreshness(root);
    expect(result.stale).toBe(false);
  });

  it("AC-US3-04: never throws on a non-existent root path", () => {
    const bogus = join(tmpdir(), "vskill-0728-bogus-does-not-exist-" + Date.now());
    expect(() => checkDistFreshness(bogus)).not.toThrow();
    const result = checkDistFreshness(bogus);
    expect(result.stale).toBe(false);
  });

  it("AC-US3-04: never throws when given a path that is a file, not a directory", () => {
    const filePath = join(root, "not-a-dir.txt");
    writeFileSync(filePath, "x", "utf-8");
    expect(() => checkDistFreshness(filePath)).not.toThrow();
  });

  it("AC-US3-01: scans both src/eval-server/ and src/utils/ — staleness in either subtree triggers stale=true", () => {
    // dist mtime 10s ago; src/eval-server stale, but src/utils NEWER than dist.
    makeFile("dist/eval-server/server.js", 10);
    makeFile("dist/utils/version.js", 10);
    makeFile("src/eval-server/old.ts", 600);  // older — wouldn't trigger
    makeFile("src/utils/version.ts", 1);      // newer — must trigger

    const result = checkDistFreshness(root);
    expect(result.stale).toBe(true);
  });
});
