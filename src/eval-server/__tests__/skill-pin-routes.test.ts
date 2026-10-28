// 1126 P1-3 / P2-8 / AC-03: pin and unpin, install an exact version, and push
// a version to every fleet machine through the SpecWithCode CLI.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, homedir: () => env.home };
});

import {
  buildFleetSkillsArgv,
  buildInstallVersionArgv,
  buildPrivateInstallArgv,
  getFleetStatus,
  helpListsSkills,
  isExactVersion,
  isFleetSkillName,
  parseFleetSkillsOutput,
  pushSkillToFleet,
  registerSkillPinRoutes,
  FLEET_SKILLS_UNAVAILABLE,
  type FleetDeps,
} from "../skill-pin-routes.js";
import type { VskillRunResult } from "../vskill-cli-runner.js";
import { findSkillLockEntry } from "../skill-lock-lookup.js";

const res = (stdout: string, code: number | null = 0, extra: Partial<VskillRunResult> = {}): VskillRunResult => ({
  code,
  stdout,
  stderr: "",
  timedOut: false,
  bundled: true,
  ...extra,
});

function writeLock(dir: string, skills: Record<string, Record<string, unknown>>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "vskill.lock"),
    JSON.stringify({ version: 1, agents: ["claude-code"], skills, createdAt: "", updatedAt: "" }),
  );
}
const entry = (version: string, extra: Record<string, unknown> = {}) => ({
  version,
  sha: "abc",
  tier: "VERIFIED",
  installedAt: "2026-10-01T00:00:00Z",
  source: "github:owner/repo",
  ...extra,
});

type Handler = (req: unknown, res: unknown, params: Record<string, string>) => Promise<void>;

function capture(root: string, deps: Parameters<typeof registerSkillPinRoutes>[2]) {
  const routes: Record<string, Handler> = {};
  const router = {
    get: (p: string, h: Handler) => { routes[`GET ${p}`] = h; },
    post: (p: string, h: Handler) => { routes[`POST ${p}`] = h; },
    delete: (p: string, h: Handler) => { routes[`DELETE ${p}`] = h; },
    put: () => {},
  };
  registerSkillPinRoutes(router as never, () => root, deps);
  return routes;
}

/** Minimal req/res pair that readBody and sendJson accept. */
function call(handler: Handler, params: Record<string, string>, body?: unknown) {
  const { Readable } = require("node:stream") as typeof import("node:stream");
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as Record<string, unknown>;
  req.headers = { host: "localhost", "content-type": "application/json" };
  req.method = "POST";
  req.url = "/";
  let status = 0;
  let payload = "";
  const resObj = {
    headersSent: false,
    setHeader: () => {},
    writeHead: (s: number) => { status = s; },
    end: (b?: string) => { payload = b ?? ""; },
    write: () => {},
  };
  return handler(req, resObj, params).then(() => ({ status, json: payload ? JSON.parse(payload) : null }));
}

const noFleet: FleetDeps = { findCli: () => null, run: async () => res("") };

let root: string;
beforeEach(() => {
  env.home = mkdtempSync(join(tmpdir(), "vskill-home-"));
  root = mkdtempSync(join(tmpdir(), "vskill-root-"));
});

describe("argv validation", () => {
  it("accepts owner/repo/skill and exact versions only", () => {
    expect(isFleetSkillName("anton-abyzov/vskill/html-report")).toBe(true);
    for (const bad of ["html-report", "a/b", "-x/repo/skill", "owner/../skill", "owner/repo/skill;rm", "github:o/r/s", "o/r/s/t"]) {
      expect(isFleetSkillName(bad)).toBe(false);
    }
    expect(isExactVersion("1.2.3")).toBe(true);
    expect(isExactVersion("1.2.3-beta.1")).toBe(true);
    for (const bad of ["^1.2.3", "latest", "1.2", "1.2.3 --force", "--version", "01.2.3"]) {
      expect(isExactVersion(bad)).toBe(false);
    }
  });

  it("builds fixed argv and throws on bad input", () => {
    expect(buildInstallVersionArgv("o/r/s", "1.0.0", false)).toEqual(["install", "o/r/s@1.0.0", "-y"]);
    expect(buildInstallVersionArgv("o/r/s", "1.0.0", true)).toEqual(["install", "o/r/s@1.0.0", "-y", "--global"]);
    expect(buildPrivateInstallArgv("acme", "tool", "2.0.0", false)).toEqual([
      "install", "--tenant", "acme", "tool", "--version", "2.0.0", "-y",
    ]);
    expect(buildFleetSkillsArgv("o/r/s", "1.0.0", true)).toEqual([
      "fleet", "skills", "--all", "--skill", "o/r/s", "--version", "1.0.0", "--json",
    ]);
    expect(buildFleetSkillsArgv("o/r/s", "1.0.0", false)).toContain("--no-pin");
    expect(() => buildFleetSkillsArgv("o/r/s", "1.0.0; rm -rf /", true)).toThrow(/Invalid version/);
    expect(() => buildInstallVersionArgv("--force", "1.0.0", false)).toThrow(/Invalid skill/);
    expect(() => buildPrivateInstallArgv("-x", "tool", "1.0.0", false)).toThrow(/Invalid tenant/);
  });
});

describe("lock lookup", () => {
  it("prefers the project lock, then ~/.agents, and accepts owner/repo/skill", () => {
    writeLock(join(env.home, ".agents"), { foo: entry("1.0.0") });
    const g = findSkillLockEntry(root, "owner/repo/foo");
    expect(g).toEqual(expect.objectContaining({ lockName: "foo", scope: "global", fullName: "owner/repo/foo" }));
    writeLock(root, { foo: entry("2.0.0") });
    expect(findSkillLockEntry(root, "foo")).toEqual(expect.objectContaining({ scope: "project" }));
    expect(findSkillLockEntry(root, "nope")).toBeNull();
  });
});

describe("pin routes", () => {
  it("GET reports lock state; POST pins the installed version; DELETE unpins", async () => {
    writeLock(join(env.home, ".agents"), { foo: entry("1.4.0") });
    const routes = capture(root, { runVskill: vi.fn(), fleet: noFleet });

    const state = await call(routes["GET /api/skills/:plugin/:skill/pin"], { plugin: "p", skill: "foo" });
    expect(state.json).toEqual(expect.objectContaining({
      found: true, pinned: false, installedVersion: "1.4.0", scope: "global", fullName: "owner/repo/foo", canInstallVersion: true,
    }));

    const pinned = await call(routes["POST /api/skills/:plugin/:skill/pin"], { plugin: "p", skill: "foo" }, {});
    expect(pinned.status).toBe(200);
    expect(pinned.json).toEqual(expect.objectContaining({ ok: true, pinned: true, pinnedVersion: "1.4.0" }));
    const onDisk = JSON.parse(readFileSync(join(env.home, ".agents", "vskill.lock"), "utf-8"));
    expect(onDisk.skills.foo.pinnedVersion).toBe("1.4.0");

    const unpinned = await call(routes["DELETE /api/skills/:plugin/:skill/pin"], { plugin: "p", skill: "foo" });
    expect(unpinned.json).toEqual(expect.objectContaining({ ok: true, pinned: false, pinnedVersion: null }));
    expect(JSON.parse(readFileSync(join(env.home, ".agents", "vskill.lock"), "utf-8")).skills.foo.pinnedVersion).toBeUndefined();
  });

  it("rejects bad versions and unknown skills", async () => {
    writeLock(root, { foo: entry("1.0.0") });
    const routes = capture(root, { runVskill: vi.fn(), fleet: noFleet });
    const bad = await call(routes["POST /api/skills/:plugin/:skill/pin"], { plugin: "p", skill: "foo" }, { version: "^1" });
    expect(bad.status).toBe(400);
    const missing = await call(routes["POST /api/skills/:plugin/:skill/pin"], { plugin: "p", skill: "nope" }, {});
    expect(missing.status).toBe(404);
  });
});

describe("install-version route", () => {
  it("runs install owner/repo/skill@X -y --global for a user-level skill, then unpins when pin=false", async () => {
    const lockDir = join(env.home, ".agents");
    writeLock(lockDir, { foo: entry("1.0.0") });
    const runVskill = vi.fn(async () => {
      // What the CLI does: install the version and pin it.
      writeLock(lockDir, { foo: entry("0.9.0", { pinnedVersion: "0.9.0" }) });
      return res("Installed foo 0.9.0");
    });
    const routes = capture(root, { runVskill, fleet: noFleet });
    const out = await call(routes["POST /api/skills/:plugin/:skill/install-version"], { plugin: "p", skill: "foo" }, {
      version: "0.9.0",
      pin: false,
    });
    expect(runVskill).toHaveBeenCalledWith(["install", "owner/repo/foo@0.9.0", "-y", "--global"], expect.objectContaining({ cwd: root }));
    expect(out.status).toBe(200);
    expect(out.json).toEqual(expect.objectContaining({ ok: true, installedVersion: "0.9.0", pinned: false }));
  });

  it("reports failure when the lock does not show the requested version", async () => {
    writeLock(root, { foo: entry("1.0.0") });
    const runVskill = vi.fn(async () => res("", 1, { stderr: "Version 9.9.9 not found for foo." }));
    const routes = capture(root, { runVskill, fleet: noFleet });
    const out = await call(routes["POST /api/skills/:plugin/:skill/install-version"], { plugin: "p", skill: "foo" }, {
      version: "9.9.9",
    });
    expect(runVskill).toHaveBeenCalledWith(["install", "owner/repo/foo@9.9.9", "-y"], expect.anything());
    expect(out.status).toBe(502);
    expect(out.json.error).toContain("Version 9.9.9 not found");
  });

  it("refuses an injected version before spawning", async () => {
    writeLock(root, { foo: entry("1.0.0") });
    const runVskill = vi.fn();
    const routes = capture(root, { runVskill, fleet: noFleet });
    const out = await call(routes["POST /api/skills/:plugin/:skill/install-version"], { plugin: "p", skill: "foo" }, {
      version: "1.0.0 --force",
    });
    expect(out.status).toBe(400);
    expect(runVskill).not.toHaveBeenCalled();
  });
});

describe("fleet push", () => {
  const helpWithSkills = "SUBCOMMANDS\n  invite    x\n  list      y\n  skills    Install a skill version\n";
  const helpWithout = "SUBCOMMANDS\n  invite    x\n  add       y\n  list      z\n  remove    w\n";

  it("status is unavailable when the CLI is absent", async () => {
    expect(await getFleetStatus(noFleet)).toEqual({ available: false, path: null, skillsSupported: false, machines: null });
  });

  it("status detects the skills subcommand and tolerates fleet list without --json", async () => {
    const run = vi.fn(async (_c: string, args: string[]) =>
      args[1] === "--help" ? res(helpWithout) : res("ERROR\n  Unrecognized flag: --json", 0),
    );
    const s = await getFleetStatus({ findCli: () => "/x/specweave-studio", run });
    expect(s).toEqual(expect.objectContaining({ available: true, skillsSupported: false, machines: null, message: FLEET_SKILLS_UNAVAILABLE }));
    expect(helpListsSkills(helpWithSkills)).toBe(true);
  });

  it("refuses with a clear not-available message when fleet --help lists no skills subcommand", async () => {
    const run = vi.fn(async () => res(helpWithout));
    const out = await pushSkillToFleet("o/r/s", "1.0.0", true, { findCli: () => "/x/specweave-studio", run });
    expect(out.status).toBe(501);
    expect(out.body).toEqual(expect.objectContaining({ notAvailable: true, error: FLEET_SKILLS_UNAVAILABLE }));
    expect(run.mock.calls.some((c) => (c[1] as string[])[1] === "skills")).toBe(false);
  });

  it("maps a bare version line (older CLI, global --version wins) to not-available", async () => {
    const run = vi.fn(async (_c: string, args: string[]) =>
      args[1] === "--help" ? res(helpWithSkills) : args[1] === "list" ? res("") : res("specweave-studio v1.0.109\n"),
    );
    const out = await pushSkillToFleet("o/r/s", "1.0.0", true, { findCli: () => "/x/specweave-studio", run });
    expect(out.status).toBe(501);
    expect(out.body).toEqual(expect.objectContaining({ notAvailable: true }));
    expect(run).toHaveBeenCalledWith("/x/specweave-studio", [
      "fleet", "skills", "--all", "--skill", "o/r/s", "--version", "1.0.0", "--json",
    ]);
  });

  it("parses per-machine JSON results (array, envelope or JSON lines)", async () => {
    expect(parseFleetSkillsOutput('[{"machine":"m1","phase":"installed","installedVersion":"1.0.0"},{"machine":"m3","reason":"vskill-missing"}]')).toEqual([
      { machine: "m1", ok: true, installedVersion: "1.0.0" },
      { machine: "m3", ok: false, reason: "vskill-missing" },
    ]);
    expect(parseFleetSkillsOutput('{"results":[{"name":"m4","ok":true,"version":"2.0.0"}]}')).toEqual([
      { machine: "m4", ok: true, installedVersion: "2.0.0" },
    ]);
    expect(parseFleetSkillsOutput('{"machine":"a","status":"installed","installedVersion":"1.0.0"}\n{"machine":"b","lastErrorReason":"unreachable","lastError":"timeout"}')).toEqual([
      { machine: "a", ok: true, installedVersion: "1.0.0" },
      { machine: "b", ok: false, reason: "unreachable", error: "timeout" },
    ]);
    expect(parseFleetSkillsOutput("not json")).toBeNull();
  });

  it("route pushes the lock's full name and validates the version", async () => {
    writeLock(root, { foo: entry("1.0.0") });
    const run = vi.fn(async (_c: string, args: string[]) =>
      args[1] === "--help"
        ? res(helpWithSkills)
        : args[1] === "list"
          ? res("")
          : res('[{"machine":"m1","phase":"installed","installedVersion":"1.0.0"}]'),
    );
    const routes = capture(root, { runVskill: vi.fn(), fleet: { findCli: () => "/x/specweave-studio", run } });
    const ok = await call(routes["POST /api/skills/:plugin/:skill/push-fleet"], { plugin: "p", skill: "foo" }, { version: "1.0.0", pin: false });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual(expect.objectContaining({ ok: true, skill: "owner/repo/foo", results: [{ machine: "m1", ok: true, installedVersion: "1.0.0" }] }));
    const pushCall = run.mock.calls.find((c) => (c[1] as string[])[1] === "skills")!;
    expect(pushCall[1]).toContain("--no-pin");

    const bad = await call(routes["POST /api/skills/:plugin/:skill/push-fleet"], { plugin: "p", skill: "foo" }, { version: "latest" });
    expect(bad.status).toBe(400);
    expect(run.mock.calls.filter((c) => (c[1] as string[])[1] === "skills")).toHaveLength(1);
  });

  it("status route hides the CLI's absolute path", async () => {
    const run = vi.fn(async (_c: string, args: string[]) => (args[1] === "--help" ? res(helpWithSkills) : res("[]")));
    const routes = capture(root, { runVskill: vi.fn(), fleet: { findCli: () => "/Users/x/.local/bin/specweave-studio", run } });
    const out = await call(routes["GET /api/fleet/status"], {});
    expect(out.json).toEqual({ available: true, path: "specweave-studio", skillsSupported: true, machines: [] });
  });
});
