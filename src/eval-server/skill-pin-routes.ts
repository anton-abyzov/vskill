// ---------------------------------------------------------------------------
// skill-pin-routes.ts -- pin / unpin, install an exact version, and push a
// version to every fleet machine (1126 P1-3, P2-8, AC-03).
//
//   GET    /api/skills/:plugin/:skill/pin             lock state for the skill
//   POST   /api/skills/:plugin/:skill/pin {version?}  pin (default: installed)
//   DELETE /api/skills/:plugin/:skill/pin             unpin
//   POST   /api/skills/:plugin/:skill/install-version {version, pin?}
//   GET    /api/fleet/status                          is `specweave-studio` here?
//   POST   /api/skills/:plugin/:skill/push-fleet {version, pin?}
//
// Pin and unpin edit the lock in-process, exactly as `vskill pin` / `unpin`
// do (src/commands/pin.ts), but against the lock the Studio root resolves to
// (project, then ~/.agents, then legacy ~/vskill.lock): the CLI commands read
// only the cwd's project lock.
//
// install-version runs the bundled CLI with a fixed argv:
//   vskill install owner/repo/skill@X -y [--global]
// which installs and pins (0932). `pin: false` clears the pin afterwards.
//
// push-fleet runs the SpecWithCode CLI with a fixed argv:
//   specweave-studio fleet skills --all --skill owner/repo/skill --version X [--no-pin] --json
// The skill name and version are pattern-checked before any spawn.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { whichSync } from "./utils/which.js";
import { runVskill, runCommand, lastLine, stripAnsi, type VskillRunResult } from "./vskill-cli-runner.js";
import { findSkillLockEntry, writePin, type SkillLockMatch } from "./skill-lock-lookup.js";
import { isSafeSkillName } from "./skill-update-routes.js";

/** Same shape SpecWithCode's fleet contract accepts (StudioFleetSkillName). */
export const FLEET_SKILL_NAME_RE =
  /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Exact semver: 1.2.3, 1.2.3-beta.1, 1.2.3+build. No ranges, no tags. */
export const EXACT_VERSION_RE =
  /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,63})?(?:\+[0-9A-Za-z][0-9A-Za-z.-]{0,63})?$/;

export function isFleetSkillName(s: unknown): s is string {
  return typeof s === "string" && s.length <= 200 && FLEET_SKILL_NAME_RE.test(s) && !s.includes("..");
}

export function isExactVersion(s: unknown): s is string {
  return typeof s === "string" && s.length <= 64 && EXACT_VERSION_RE.test(s);
}

export class ArgvValidationError extends Error {}

/** argv for `vskill install owner/repo/skill@X -y [--global]`. Throws on bad input. */
export function buildInstallVersionArgv(fullName: string, version: string, global: boolean): string[] {
  if (!isFleetSkillName(fullName)) throw new ArgvValidationError(`Invalid skill name: ${fullName}`);
  if (!isExactVersion(version)) throw new ArgvValidationError(`Invalid version: ${version}`);
  const argv = ["install", `${fullName}@${version}`, "-y"];
  if (global) argv.push("--global");
  return argv;
}

/** argv for hosted private skills: `vskill install --tenant t slug --version X -y`. */
export function buildPrivateInstallArgv(
  tenantSlug: string,
  skillSlug: string,
  version: string,
  global: boolean,
): string[] {
  const slug = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  if (!slug.test(tenantSlug)) throw new ArgvValidationError(`Invalid tenant: ${tenantSlug}`);
  if (!slug.test(skillSlug)) throw new ArgvValidationError(`Invalid skill: ${skillSlug}`);
  if (!isExactVersion(version)) throw new ArgvValidationError(`Invalid version: ${version}`);
  const argv = ["install", "--tenant", tenantSlug, skillSlug, "--version", version, "-y"];
  if (global) argv.push("--global");
  return argv;
}

/** argv for `specweave-studio fleet skills --all ...`. Throws on bad input. */
export function buildFleetSkillsArgv(fullName: string, version: string, pin: boolean): string[] {
  if (!isFleetSkillName(fullName)) throw new ArgvValidationError(`Invalid skill name: ${fullName}`);
  if (!isExactVersion(version)) throw new ArgvValidationError(`Invalid version: ${version}`);
  const argv = ["fleet", "skills", "--all", "--skill", fullName, "--version", version];
  if (!pin) argv.push("--no-pin");
  argv.push("--json");
  return argv;
}

// ---------------------------------------------------------------------------
// Fleet CLI discovery
// ---------------------------------------------------------------------------

export interface FleetStatus {
  available: boolean;
  /** Absolute path of the specweave-studio CLI, when found. */
  path: string | null;
  /** True when `specweave-studio fleet --help` lists a `skills` subcommand. */
  skillsSupported: boolean;
  /** Machine names from `fleet list --json`, or null when that is unsupported. */
  machines: string[] | null;
  message?: string;
}

export const FLEET_SKILLS_UNAVAILABLE =
  "fleet skills is not available on this SpecWithCode yet. Update SpecWithCode, then try again.";

export interface FleetDeps {
  /** Finds the CLI; default checks PATH, then ~/.local/bin. */
  findCli: () => string | null;
  run: (command: string, args: string[]) => Promise<VskillRunResult>;
}

function defaultFindCli(): string | null {
  const local = join(homedir(), ".local", "bin", "specweave-studio");
  if (whichSync("specweave-studio")) {
    // Prefer a real path so spawn does not depend on the GUI PATH.
    return existsSync(local) ? local : "specweave-studio";
  }
  return existsSync(local) ? local : null;
}

const defaultFleetDeps: FleetDeps = {
  findCli: defaultFindCli,
  run: (command, args) => runCommand(command, args, { cwd: homedir(), timeoutMs: 15_000 }),
};

/** True when help text lists `skills` under SUBCOMMANDS. */
export function helpListsSkills(help: string): boolean {
  const text = stripAnsi(help);
  const idx = text.indexOf("SUBCOMMANDS");
  const section = idx >= 0 ? text.slice(idx) : text;
  return /^\s+skills\s/m.test(section);
}

/** Pull machine names out of `fleet list --json`, tolerating several shapes. */
export function parseFleetMachines(stdout: string): string[] | null {
  let data: unknown;
  try {
    data = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? ((data as { machines?: unknown; environments?: unknown }).machines ??
        (data as { environments?: unknown }).environments)
      : null;
  if (!Array.isArray(rows)) return null;
  return rows
    .map((r) => (typeof r === "string" ? r : machineLabel(r as Record<string, unknown>)))
    .filter((s): s is string => typeof s === "string" && s.length > 0);
}

function machineLabel(r: Record<string, unknown>): string | undefined {
  for (const k of ["machine", "name", "label", "hostname", "host", "environmentId", "id"]) {
    const v = r[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

let statusCache: { at: number; value: FleetStatus } | null = null;

export function resetFleetStatusCacheForTests(): void {
  statusCache = null;
}

export async function getFleetStatus(deps: FleetDeps = defaultFleetDeps, maxAgeMs = 60_000): Promise<FleetStatus> {
  if (statusCache && Date.now() - statusCache.at < maxAgeMs && deps === defaultFleetDeps) {
    return statusCache.value;
  }
  const path = deps.findCli();
  let value: FleetStatus;
  if (!path) {
    value = { available: false, path: null, skillsSupported: false, machines: null };
  } else {
    const help = await deps.run(path, ["fleet", "--help"]);
    const skillsSupported = helpListsSkills(`${help.stdout}\n${help.stderr}`);
    let machines: string[] | null = null;
    const list = await deps.run(path, ["fleet", "list", "--json"]);
    if (!list.spawnError && list.code === 0) machines = parseFleetMachines(list.stdout);
    value = {
      available: true,
      path,
      skillsSupported,
      machines,
      ...(skillsSupported ? {} : { message: FLEET_SKILLS_UNAVAILABLE }),
    };
  }
  if (deps === defaultFleetDeps) statusCache = { at: Date.now(), value };
  return value;
}

export interface FleetMachineResult {
  machine: string;
  ok: boolean;
  installedVersion?: string;
  pinnedVersion?: string | null;
  reason?: string;
  error?: string;
}

function toMachineResult(r: Record<string, unknown>, fallbackName: string): FleetMachineResult {
  const phase = typeof r.phase === "string" ? r.phase : undefined;
  const status = typeof r.status === "string" ? r.status : undefined;
  const reason =
    (typeof r.reason === "string" && r.reason) ||
    (typeof r.lastErrorReason === "string" && r.lastErrorReason) ||
    (typeof r.refusal === "string" && r.refusal) ||
    undefined;
  const error =
    (typeof r.error === "string" && r.error) ||
    (typeof r.lastError === "string" && r.lastError) ||
    (typeof r.message === "string" && !r.ok && r.message) ||
    undefined;
  const okFlag =
    typeof r.ok === "boolean"
      ? r.ok
      : phase === "installed" || status === "installed" || status === "ok" || status === "done";
  const installedVersion =
    (typeof r.installedVersion === "string" && r.installedVersion) ||
    (okFlag && typeof r.version === "string" ? r.version : undefined) ||
    undefined;
  return {
    machine: machineLabel(r) ?? fallbackName,
    ok: okFlag && !reason,
    ...(installedVersion ? { installedVersion } : {}),
    ...("pinnedVersion" in r ? { pinnedVersion: (r.pinnedVersion as string | null) ?? null } : {}),
    ...(reason ? { reason } : {}),
    ...(error ? { error } : {}),
  };
}

/**
 * Parse `fleet skills --json`: one JSON array, an object with `results` /
 * `machines`, or one JSON object per line.
 */
export function parseFleetSkillsOutput(stdout: string): FleetMachineResult[] | null {
  const text = stripAnsi(stdout).trim();
  if (!text) return null;
  const collect = (rows: unknown[]): FleetMachineResult[] =>
    rows
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r, i) => toMachineResult(r, `machine ${i + 1}`));
  try {
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data)) return collect(data);
    if (data && typeof data === "object") {
      const o = data as { results?: unknown; machines?: unknown };
      if (Array.isArray(o.results)) return collect(o.results);
      if (Array.isArray(o.machines)) return collect(o.machines);
      return collect([data]);
    }
  } catch {
    /* fall through to JSON lines */
  }
  const rows: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      rows.push(JSON.parse(t));
    } catch {
      /* skip */
    }
  }
  return rows.length > 0 ? collect(rows) : null;
}

/**
 * True when the CLI answered with help, an "unknown command" error, or only
 * its version line: on a SpecWithCode without `fleet skills`, the global
 * `--version` flag wins and it prints `specweave-studio vX.Y.Z`, exit 0.
 */
export function looksLikeUnknownCommand(run: VskillRunResult): boolean {
  const text = stripAnsi(`${run.stdout}\n${run.stderr}`);
  return (
    /^\s*specweave-studio v?\d+\.\d+\.\d+\S*\s*$/.test(text) ||
    /Unrecognized (?:flag|command|subcommand)/i.test(text) ||
    /Unknown (?:command|subcommand)/i.test(text) ||
    (/SUBCOMMANDS/.test(text) && !helpListsSkills(text))
  );
}

export async function pushSkillToFleet(
  fullName: string,
  version: string,
  pin: boolean,
  deps: FleetDeps = defaultFleetDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let argv: string[];
  try {
    argv = buildFleetSkillsArgv(fullName, version, pin);
  } catch (err) {
    return { status: 400, body: { ok: false, error: (err as Error).message } };
  }
  const cli = deps.findCli();
  if (!cli) {
    return { status: 404, body: { ok: false, error: "specweave-studio is not installed on this machine." } };
  }
  // Ask the help first: an older CLI ignores the unknown subcommand.
  const status = await getFleetStatus(deps);
  if (status.available && !status.skillsSupported) {
    return { status: 501, body: { ok: false, notAvailable: true, error: FLEET_SKILLS_UNAVAILABLE } };
  }
  const run = await deps.run(cli, argv);
  if (run.spawnError) {
    return { status: 502, body: { ok: false, error: `Could not start specweave-studio: ${run.spawnError}` } };
  }
  if (run.timedOut) {
    return { status: 504, body: { ok: false, error: "specweave-studio fleet skills timed out." } };
  }
  const results = parseFleetSkillsOutput(run.stdout);
  if (!results) {
    if (looksLikeUnknownCommand(run)) {
      return { status: 501, body: { ok: false, notAvailable: true, error: FLEET_SKILLS_UNAVAILABLE } };
    }
    const detail = lastLine(run.stderr) || lastLine(run.stdout) || `exit code ${run.code}`;
    return { status: 502, body: { ok: false, error: `fleet skills failed: ${detail}` } };
  }
  return {
    status: 200,
    body: { ok: results.length > 0 && results.every((r) => r.ok), skill: fullName, version, pin, results },
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function pinState(match: SkillLockMatch | null) {
  if (!match) return { found: false };
  const hp = match.entry.hostedPrivate;
  return {
    found: true,
    lockName: match.lockName,
    fullName: match.fullName,
    scope: match.scope,
    installedVersion: match.entry.version,
    pinned: Boolean(match.entry.pinnedVersion),
    pinnedVersion: match.entry.pinnedVersion ?? null,
    canInstallVersion: Boolean(hp || match.fullName),
  };
}

export interface PinRouteDeps {
  runVskill: typeof runVskill;
  fleet: FleetDeps;
}

export function registerSkillPinRoutes(
  router: Router,
  getRoot: () => string,
  deps: PinRouteDeps = { runVskill, fleet: defaultFleetDeps },
): void {
  const lookup = (skill: string) => (isSafeSkillName(skill) ? findSkillLockEntry(getRoot(), skill) : null);

  router.get("/api/skills/:plugin/:skill/pin", async (req, res, params) => {
    if (!isSafeSkillName(params.skill)) {
      sendJson(res, { error: `Invalid skill name: ${params.skill}` }, 400, req);
      return;
    }
    sendJson(res, pinState(lookup(params.skill)), 200, req);
  });

  router.post("/api/skills/:plugin/:skill/pin", async (req, res, params) => {
    const match = lookup(params.skill);
    if (!match) {
      sendJson(res, { error: `${params.skill} is not in any vskill.lock Studio can see.` }, 404, req);
      return;
    }
    const body = ((await readBody(req).catch(() => ({}))) ?? {}) as { version?: unknown };
    const version = body.version === undefined || body.version === null ? match.entry.version : body.version;
    if (!isExactVersion(version)) {
      sendJson(res, { error: `Invalid version: ${String(version)}` }, 400, req);
      return;
    }
    writePin(match, version);
    sendJson(res, { ok: true, ...pinState(findSkillLockEntry(getRoot(), params.skill)) }, 200, req);
  });

  router.delete("/api/skills/:plugin/:skill/pin", async (req, res, params) => {
    const match = lookup(params.skill);
    if (!match) {
      sendJson(res, { error: `${params.skill} is not in any vskill.lock Studio can see.` }, 404, req);
      return;
    }
    writePin(match, null);
    sendJson(res, { ok: true, ...pinState(findSkillLockEntry(getRoot(), params.skill)) }, 200, req);
  });

  router.post("/api/skills/:plugin/:skill/install-version", async (req, res, params) => {
    const root = getRoot();
    const match = lookup(params.skill);
    if (!match) {
      sendJson(res, { error: `${params.skill} is not in any vskill.lock Studio can see.` }, 404, req);
      return;
    }
    const body = ((await readBody(req).catch(() => ({}))) ?? {}) as { version?: unknown; pin?: unknown };
    if (!isExactVersion(body.version)) {
      sendJson(res, { error: `Invalid version: ${String(body.version)}` }, 400, req);
      return;
    }
    const version = body.version;
    const keepPin = body.pin !== false;
    const global = match.scope === "global";
    let argv: string[];
    try {
      const hp = match.entry.hostedPrivate;
      if (hp) argv = buildPrivateInstallArgv(hp.tenantSlug, hp.skillSlug, version, global);
      else if (match.fullName) argv = buildInstallVersionArgv(match.fullName, version, global);
      else {
        sendJson(res, { error: `${params.skill} has no published versions to install (source: ${match.entry.source}).` }, 400, req);
        return;
      }
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 400, req);
      return;
    }
    const run = await deps.runVskill(argv, { cwd: root, timeoutMs: 180_000 });
    const after = findSkillLockEntry(root, params.skill);
    const failed = run.spawnError || run.timedOut || run.code !== 0 || after?.entry.version !== version;
    if (failed) {
      const detail = run.spawnError
        ? `Could not start vskill: ${run.spawnError}`
        : run.timedOut
          ? "vskill install timed out."
          : lastLine(run.stderr) || lastLine(run.stdout) || `exit code ${run.code}`;
      sendJson(
        res,
        {
          ok: false,
          error: `Couldn't install ${version}: ${detail}`,
          ...pinState(after),
        },
        502,
        req,
      );
      return;
    }
    if (!keepPin && after) writePin(after, null);
    sendJson(res, { ok: true, version, ...pinState(findSkillLockEntry(root, params.skill)) }, 200, req);
  });

  router.get("/api/fleet/status", async (req, res) => {
    const status = await getFleetStatus(deps.fleet);
    // Never send the CLI's absolute path to the page; presence is enough.
    sendJson(res, { ...status, path: status.path ? "specweave-studio" : null }, 200, req);
  });

  router.post("/api/skills/:plugin/:skill/push-fleet", async (req, res, params) => {
    const body = ((await readBody(req).catch(() => ({}))) ?? {}) as { version?: unknown; pin?: unknown; skill?: unknown };
    const match = lookup(params.skill);
    // The page may name the full skill when the lock does not record one.
    const fullName = match?.fullName ?? (isFleetSkillName(body.skill) ? body.skill : null);
    if (!fullName) {
      sendJson(res, { ok: false, error: `${params.skill} has no owner/repo/skill name to push.` }, 400, req);
      return;
    }
    if (!isExactVersion(body.version)) {
      sendJson(res, { ok: false, error: `Invalid version: ${String(body.version)}` }, 400, req);
      return;
    }
    const out = await pushSkillToFleet(fullName, body.version, body.pin !== false, deps.fleet);
    sendJson(res, out.body, out.status, req);
  });
}
