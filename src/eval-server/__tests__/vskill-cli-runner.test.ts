// 1126 P1-5 / P0-1: the bundled CLI runs asynchronously, and a `vskill
// update` run is classified from its output, not only its exit code.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  classifyUpdateRun,
  resolveBundledCliEntry,
  runCommand,
  stripAnsi,
  type VskillRunResult,
} from "../vskill-cli-runner.js";

const run = (stdout: string, code: number | null = 0, extra: Partial<VskillRunResult> = {}): VskillRunResult => ({
  code,
  stdout,
  stderr: "",
  timedOut: false,
  bundled: true,
  ...extra,
});

describe("resolveBundledCliEntry", () => {
  it("finds dist/index.js next to the compiled server module", () => {
    const dist = mkdtempSync(join(tmpdir(), "vskill-dist-"));
    mkdirSync(join(dist, "eval-server"));
    writeFileSync(join(dist, "index.js"), "");
    const moduleUrl = pathToFileURL(join(dist, "eval-server", "vskill-cli-runner.js")).href;
    expect(resolveBundledCliEntry(moduleUrl)).toBe(join(dist, "index.js"));
  });

  it("returns null when the entry is absent (SEA sidecar, source checkout)", () => {
    const dir = mkdtempSync(join(tmpdir(), "vskill-nodist-"));
    mkdirSync(join(dir, "eval-server"));
    expect(resolveBundledCliEntry(pathToFileURL(join(dir, "eval-server", "x.js")).href)).toBeNull();
    expect(resolveBundledCliEntry("")).toBeNull();
  });
});

describe("runCommand", () => {
  it("runs asynchronously and captures output and exit code", async () => {
    const r = await runCommand(process.execPath, ["-e", "console.log('hello'); console.error('warn'); process.exit(3)"], {
      cwd: tmpdir(),
    });
    expect(r.code).toBe(3);
    expect(r.stdout.trim()).toBe("hello");
    expect(r.stderr.trim()).toBe("warn");
    expect(r.timedOut).toBe(false);
  }, 30_000);

  it("reports ENOENT as a spawn error instead of throwing", async () => {
    const r = await runCommand("definitely-not-a-vskill-binary-1126", ["update"], { cwd: tmpdir() });
    expect(r.spawnError).toMatch(/ENOENT/);
    expect(classifyUpdateRun(r)).toEqual(
      expect.objectContaining({ status: "error", message: expect.stringContaining("not found") }),
    );
    // Desktop has no bundled CLI yet (1126 known gap): say how to get one.
    expect(classifyUpdateRun(r).message).toContain("npm i -g vskill");
  }, 30_000);

  it("kills a run that exceeds its timeout", async () => {
    const r = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
      cwd: tmpdir(),
      timeoutMs: 200,
    });
    expect(r.timedOut).toBe(true);
    expect(classifyUpdateRun(r).status).toBe("error");
  }, 30_000);
});

describe("classifyUpdateRun", () => {
  it("pinned skip is skipped with the pinned version", () => {
    expect(classifyUpdateRun(run("foo: pinned at 1.2.0 — skipping\n\nNo updates available"))).toEqual(
      expect.objectContaining({ status: "skipped", reason: "pinned", pinnedVersion: "1.2.0" }),
    );
  });

  it("exit-0 failure lines are errors", () => {
    for (const line of [
      "  foo: could not fetch update from any source",
      "  Refusing to update foo: scan FAILED",
      "  foo: could not write the update (EACCES)",
      "  foo: update failed (network down)",
      "No skills installed. Nothing to update.",
    ]) {
      expect(classifyUpdateRun(run(line)).status).toBe("error");
    }
  });

  it("not-installed with exit 1 is an error with the CLI's message", () => {
    const r = run("", 1, { stderr: '\u001b[31mSkill "foo" is not installed.\u001b[39m' });
    expect(classifyUpdateRun(r)).toEqual({ status: "error", message: 'Skill "foo" is not installed.' });
  });

  it("a version bump is done with the new version", () => {
    expect(classifyUpdateRun(run("foo: 1.0.0 -> 1.1.0 (metadata-only bump)\n\n1 skill updated"))).toEqual({
      status: "done",
      toVersion: "1.1.0",
    });
  });

  it("already up to date is done with reason up-to-date", () => {
    expect(classifyUpdateRun(run("foo: already up to date\n\nNo updates available"))).toEqual({
      status: "done",
      reason: "up-to-date",
    });
  });

  it("plugin-owned skills are skipped", () => {
    expect(classifyUpdateRun(run("foo: plugin — update it with claude plugin update x; skipping")).status).toBe("skipped");
  });

  it("strips ANSI colour codes", () => {
    expect(stripAnsi("\u001b[2mdim\u001b[22m")).toBe("dim");
  });
});
