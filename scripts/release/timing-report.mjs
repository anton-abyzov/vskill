#!/usr/bin/env node
// timing-report.mjs — per-job and per-step durations of a workflow run,
// compared with the median of the last successful runs and with fixed budgets.
// Flags the regressions that went unnoticed for months: permanent Rust cache
// misses and the ~5 minute RPM bundle on the Linux leg.
//
// Warn-only by design: findings become `::warning::` annotations plus a
// markdown table in $GITHUB_STEP_SUMMARY (stdout when unset), and the exit
// code stays 0. In live mode any failure, a GitHub API error or a bug in this
// file, becomes a warning, so a reporting hiccup never turns a finished
// release red. Bad arguments exit 2; --self-test and --fixture fail loudly.
//
// Usage:
//   node scripts/release/timing-report.mjs --repo OWNER/NAME --run RUN_ID \
//        --workflow desktop-release.yml [--event push] [--baseline 5] [--no-logs]
//   node scripts/release/timing-report.mjs --fixture DIR [--workflow FILE]
//        DIR/current.json        jobs payload of the run being reported
//        DIR/baseline-*.json     jobs payloads of earlier successful runs
//        DIR/logs/<job id>.txt   job logs (optional)
//   node scripts/release/timing-report.mjs --self-test
//
// Zero dependencies; talks to GitHub through `gh api` (GH_TOKEN must be set
// in Actions, with actions: read).

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Ratio over the baseline median that counts as a regression, and the
// smallest absolute increase worth flagging (runner noise is ~10-20s).
export const RATIO = 1.3;
export const MIN_DELTA_SECONDS = 30;

// Budgets in seconds. `run` is the wall time of all jobs but this report.
export const BUDGETS = {
  "desktop-release.yml": {
    run: 600,
    steps: { "Build Tauri app + sign + (macOS) notarize": 420 },
    bundles: { rpm: 60 },
  },
  "notarize-dryrun.yml": {
    run: 900,
    steps: {},
    bundles: { rpm: 60 },
  },
  "npm-release.yml": {
    run: 180,
    steps: {},
    bundles: {},
  },
};

// Steps compared with the baseline even without a budget.
export const KEY_STEPS = [
  "Build Tauri app + sign + (macOS) notarize",
  "Build Tauri (smoke mode — notarize via build script)",
  "Build Tauri (release build, no updater signing)",
  "Notarize + staple the DMG (macOS)",
  "Install Linux build deps",
  "Install npm deps (no install scripts) + build studio bundle",
  "Publish to Cloudflare R2 + atomic latest.json",
  "Test the full package",
  "Full unit suite",
];

const SELF_JOB_NAMES = new Set(["Release timing report", "timing"]);

class ApiError extends Error {}

// ── pure helpers ─────────────────────────────────────────────────────────────

export function seconds(start, end) {
  if (!start || !end) return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  return Math.round((e - s) / 1000);
}

export function median(values) {
  const v = values.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

export function fmt(sec) {
  if (sec === null || sec === undefined) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

function finishedJobs(payload) {
  return (payload.jobs || []).filter(
    (j) => j.status === "completed" && j.conclusion !== "skipped" && !SELF_JOB_NAMES.has(j.name),
  );
}

// Wall time of a run from its jobs (excluding this report's own job).
export function runWall(payload) {
  const jobs = finishedJobs(payload);
  if (jobs.length === 0) return null;
  const starts = jobs.map((j) => Date.parse(j.started_at)).filter((x) => !Number.isNaN(x));
  const ends = jobs.map((j) => Date.parse(j.completed_at)).filter((x) => !Number.isNaN(x));
  if (!starts.length || !ends.length) return null;
  return Math.round((Math.max(...ends) - Math.min(...starts)) / 1000);
}

// { jobName: { duration, steps: { stepName: duration } } }
export function durations(payload) {
  const out = {};
  for (const j of finishedJobs(payload)) {
    const steps = {};
    for (const s of j.steps || []) {
      if (s.conclusion === "skipped") continue;
      const d = seconds(s.started_at, s.completed_at);
      if (d !== null) steps[s.name] = d;
    }
    out[j.name] = { id: j.id, duration: seconds(j.started_at, j.completed_at), steps };
  }
  return out;
}

const ANSI = /\u001b\[[0-9;]*m/g;
const TS = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\s?(.*)$/;

export function bundleKind(file) {
  if (/\.rpm$/i.test(file)) return "rpm";
  if (/\.deb$/i.test(file)) return "deb";
  if (/\.AppImage$/i.test(file)) return "appimage";
  if (/\.dmg$/i.test(file)) return "dmg";
  if (/\.app$/i.test(file)) return "app";
  if (/\.msi$/i.test(file)) return "msi";
  if (/-setup\.exe$/i.test(file)) return "nsis";
  return "other";
}

// Facts from one job log: cache misses, compile time, per-bundle durations.
export function parseLog(text) {
  const facts = { rustCacheMiss: false, npmCacheMiss: false, compileSeconds: null, bundles: [] };
  let open = null;
  const close = (ts) => {
    if (open) {
      facts.bundles.push({ kind: open.kind, file: open.file, seconds: seconds(open.ts, ts) });
      open = null;
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const m = TS.exec(raw);
    if (!m) continue;
    const ts = m[1];
    const line = m[2].replace(ANSI, "");
    if (/^No cache found\.\s*$/.test(line.trim())) facts.rustCacheMiss = true;
    if (/Cache not found for input keys|npm cache is not found/i.test(line)) facts.npmCacheMiss = true;
    const fin = /Finished\s+`release` profile .* in (?:(\d+)m )?([\d.]+)s/.exec(line);
    if (fin) facts.compileSeconds = Number(fin[1] || 0) * 60 + Math.round(Number(fin[2]));
    const b = /^\s*Bundling (.+?) \((.+)\)\s*$/.exec(line);
    if (b) {
      close(ts);
      open = { ts, file: b[1], kind: bundleKind(b[1]) };
      continue;
    }
    if (open && (/^\s*Finished \d+ bundles? at/.test(line) || /^##\[group\]Run /.test(line))) close(ts);
  }
  return facts;
}

// Decide what to flag for one measured value.
export function judge(value, baselineValues, budget) {
  const notes = [];
  const med = median(baselineValues || []);
  if (value === null || value === undefined) return { med, notes };
  if (typeof budget === "number" && value > budget) notes.push(`over the ${fmt(budget)} budget`);
  if (med !== null && value > med * RATIO && value - med >= MIN_DELTA_SECONDS) {
    notes.push(`${(value / med).toFixed(1)}x the median ${fmt(med)}`);
  }
  return { med, notes };
}

// Build table rows + warnings from the current run, baseline runs and logs.
export function analyse({ workflow, current, baselines, logs }) {
  const budget = BUDGETS[workflow] || { steps: {}, bundles: {} };
  const rows = [];
  const warnings = [];
  const n = baselines.length;
  // label: table row (indented for steps); where: the warning's subject.
  const add = (label, value, baseValues, budgetValue, where) => {
    const { med, notes } = judge(value, baseValues, budgetValue);
    rows.push({ label, value, med, budget: budgetValue, notes });
    for (const note of notes) warnings.push(`${where || label}: ${fmt(value)}, ${note}`);
  };

  add("Run wall time", runWall(current), baselines.map(runWall), budget.run);

  const cur = durations(current);
  const base = baselines.map(durations);
  for (const [job, info] of Object.entries(cur)) {
    add(job, info.duration, base.map((b) => (b[job] ? b[job].duration : null)));
    for (const [step, d] of Object.entries(info.steps)) {
      const stepBudget = budget.steps ? budget.steps[step] : undefined;
      if (!KEY_STEPS.includes(step) && stepBudget === undefined) continue;
      add(`  ${step}`, d, base.map((b) => (b[job] && b[job].steps[step] !== undefined ? b[job].steps[step] : null)), stepBudget, `${job} / ${step}`);
    }
    const log = logs[String(info.id)];
    if (!log) continue;
    const facts = parseLog(log);
    if (facts.compileSeconds !== null) {
      rows.push({ label: "  cargo release compile", value: facts.compileSeconds, med: null, notes: [] });
    }
    for (const b of facts.bundles) {
      const bb = budget.bundles ? budget.bundles[b.kind] : undefined;
      add(`  bundle ${b.kind}`, b.seconds, [], bb, `${job} / ${b.kind} bundle`);
    }
    if (facts.rustCacheMiss) {
      rows.push({ label: "  Rust cache", value: null, med: null, notes: ["miss (cold compile)"] });
      warnings.push(`${job}: Rust cache miss ('No cache found'), every dependency compiled cold`);
    }
    if (facts.npmCacheMiss) {
      rows.push({ label: "  npm cache", value: null, med: null, notes: ["miss"] });
      warnings.push(`${job}: npm cache miss`);
    }
  }
  return { rows, warnings, baselineCount: n };
}

export function markdown({ workflow, runLabel, rows, baselineCount }) {
  const out = [];
  out.push(`### Timing: ${workflow} ${runLabel}`);
  out.push("");
  out.push(`Compared with the median of the last ${baselineCount} successful run(s); flags above ${RATIO}x (and ${MIN_DELTA_SECONDS}s) or over budget. Warn-only.`);
  out.push("");
  out.push("| Job / step | Duration | Median | Budget | Flag |");
  out.push("|---|---:|---:|---:|---|");
  for (const r of rows) {
    const label = r.label.startsWith("  ") ? `&nbsp;&nbsp;${r.label.trim()}` : `**${r.label}**`;
    out.push(`| ${label} | ${fmt(r.value)} | ${fmt(r.med)} | ${fmt(r.budget)} | ${r.notes.join("; ")} |`);
  }
  out.push("");
  return out.join("\n");
}

// ── GitHub access ────────────────────────────────────────────────────────────

function gh(path) {
  try {
    return execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const detail = err.stderr ? String(err.stderr).trim().split("\n")[0] : err.message;
    throw new ApiError(`gh api ${path}: ${detail}`);
  }
}

function ghJson(path) {
  return JSON.parse(gh(path));
}

function loadLive({ repo, run, workflow, event, baseline, withLogs }) {
  const current = ghJson(`repos/${repo}/actions/runs/${run}/jobs?per_page=100`);
  const baselines = [];
  try {
    const q = `status=success&per_page=${baseline + 5}${event ? `&event=${encodeURIComponent(event)}` : ""}`;
    const runs = ghJson(`repos/${repo}/actions/workflows/${workflow}/runs?${q}`).workflow_runs || [];
    for (const r of runs.filter((x) => String(x.id) !== String(run)).slice(0, baseline)) {
      baselines.push(ghJson(`repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`));
    }
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    console.log(`::warning title=Release timing::baseline unavailable (${err.message}); budgets only`);
  }
  const logs = {};
  if (withLogs) {
    for (const j of finishedJobs(current)) {
      try {
        logs[String(j.id)] = gh(`repos/${repo}/actions/jobs/${j.id}/logs`);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        console.log(`::warning title=Release timing::no log for ${j.name} (${err.message})`);
      }
    }
  }
  return { current, baselines, logs };
}

function loadFixture(dir) {
  const current = JSON.parse(readFileSync(join(dir, "current.json"), "utf8"));
  const baselines = readdirSync(dir)
    .filter((f) => /^baseline-.*\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  const logs = {};
  const logDir = join(dir, "logs");
  if (existsSync(logDir)) {
    for (const f of readdirSync(logDir)) {
      const m = /^(\d+)\.txt$/.exec(f);
      if (m) logs[m[1]] = readFileSync(join(logDir, f), "utf8");
    }
  }
  return { current, baselines, logs };
}

// ── self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`self-test failed: ${msg}`);
  };
  assert(median([3, 1, 2]) === 2 && median([4, 1, 3, 2]) === 3 && median([]) === null, "median");
  assert(fmt(65) === "1m 05s" && fmt(9) === "9s", "fmt");
  assert(seconds("2026-10-16T14:49:29Z", "2026-10-16T15:04:01Z") === 872, "seconds");
  const log = [
    "2026-10-16T14:50:02.7839131Z ... Restoring cache ...",
    "2026-10-16T14:50:02.9939853Z No cache found.",
    "2026-10-16T14:56:21.3346303Z \u001b[1m\u001b[92m    Finished\u001b[0m `release` profile [optimized] target(s) in 4m 20s",
    "2026-10-16T14:56:21.4150920Z     Bundling Skill Studio_1.0.65_amd64.deb (/x/deb/Skill Studio_1.0.65_amd64.deb)",
    "2026-10-16T14:56:24.7520455Z     Bundling Skill Studio-1.0.65-1.x86_64.rpm (/x/rpm/Skill Studio-1.0.65-1.x86_64.rpm)",
    "2026-10-16T15:01:47.0740083Z     Bundling Skill Studio_1.0.65_amd64.AppImage (/x/appimage/Skill Studio_1.0.65_amd64.AppImage)",
    "2026-10-16T15:03:21.1801860Z     Finished 3 bundles at:",
  ].join("\n");
  const f = parseLog(log);
  assert(f.rustCacheMiss && !f.npmCacheMiss, "cache miss detection");
  assert(f.compileSeconds === 260, `compile seconds ${f.compileSeconds}`);
  assert(f.bundles.map((b) => `${b.kind}:${b.seconds}`).join(",") === "deb:3,rpm:322,appimage:94", `bundles ${JSON.stringify(f.bundles)}`);
  const job = (name, start, end, steps) => ({
    id: 1, name, status: "completed", conclusion: "success", started_at: start, completed_at: end,
    steps: steps.map(([n, s, e]) => ({ name: n, conclusion: "success", started_at: s, completed_at: e })),
  });
  const mk = (buildEnd) => ({
    jobs: [
      job("Build (linux)", "2026-01-01T00:00:00Z", buildEnd, [["Build Tauri app + sign + (macOS) notarize", "2026-01-01T00:01:00Z", buildEnd]]),
      { id: 9, name: "Release timing report", status: "in_progress", conclusion: null, started_at: buildEnd, completed_at: null, steps: [] },
    ],
  });
  const res = analyse({
    workflow: "desktop-release.yml",
    current: mk("2026-01-01T00:12:00Z"),
    baselines: [mk("2026-01-01T00:05:00Z"), mk("2026-01-01T00:06:00Z"), mk("2026-01-01T00:05:30Z")],
    logs: { 1: log },
  });
  const w = res.warnings.join("\n");
  assert(/Run wall time: 12m 00s, over the 10m 00s budget/.test(w), `run budget warning missing:\n${w}`);
  assert(/Build \(linux\): 12m 00s, 2\.2x the median 5m 30s/.test(w), `job regression warning missing:\n${w}`);
  assert(/Build \(linux\) \/ Build Tauri app \+ sign \+ \(macOS\) notarize: 11m 00s, over the 7m 00s budget/.test(w), "step budget warning missing");
  assert(/Build \(linux\) \/ rpm bundle: 5m 22s, over the 1m 00s budget/.test(w), "rpm budget warning missing");
  assert(/Rust cache miss/.test(w), "cache miss warning missing");
  assert(!/Release timing report/.test(w), "report job must not report itself");
  const quiet = analyse({ workflow: "desktop-release.yml", current: mk("2026-01-01T00:05:20Z"), baselines: [mk("2026-01-01T00:05:00Z")], logs: {} });
  assert(!quiet.warnings.some((x) => /median/.test(x)), "within noise must not flag a regression");
  console.log("timing-report self-test: ok");
}

// ── main ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { baseline: 5, withLogs: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) usage(`missing value for ${a}`);
      return v;
    };
    if (a === "--repo") opts.repo = val();
    else if (a === "--run") opts.run = val();
    else if (a === "--workflow") opts.workflow = val();
    else if (a === "--event") opts.event = val();
    else if (a === "--baseline") opts.baseline = Number(val());
    else if (a === "--fixture") opts.fixture = val();
    else if (a === "--no-logs") opts.withLogs = false;
    else if (a === "--self-test") opts.selfTest = true;
    else if (a === "-h" || a === "--help") usage(null);
    else usage(`unknown argument ${a}`);
  }
  if (!Number.isInteger(opts.baseline) || opts.baseline < 0) usage("--baseline must be a non-negative integer");
  return opts;
}

function usage(msg) {
  const text = "usage: timing-report.mjs --repo OWNER/NAME --run RUN_ID --workflow FILE [--event EVENT] [--baseline N] [--no-logs]\n" +
    "       timing-report.mjs --fixture DIR [--workflow FILE]\n       timing-report.mjs --self-test";
  if (msg) {
    console.error(`timing-report: ${msg}\n${text}`);
    process.exit(2);
  }
  console.log(text);
  process.exit(0);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selfTest) return selfTest();
  if (opts.fixture) {
    opts.workflow = opts.workflow || "desktop-release.yml";
    return report(opts, loadFixture(opts.fixture), `(fixture ${opts.fixture})`);
  }
  if (!opts.repo || !opts.run || !opts.workflow) usage("--repo, --run and --workflow are required");
  // Live mode runs as the last job of a release. The run's conclusion is what
  // release-desktop.sh watches, so no failure of this report may turn a
  // published release red: it becomes a warning. --self-test and --fixture
  // still fail loudly.
  try {
    report(opts, loadLive(opts), `run ${opts.run}`);
  } catch (err) {
    const what = err instanceof ApiError ? "report skipped" : "report failed";
    const detail = err instanceof ApiError || !err || !err.stack ? String(err && err.message ? err.message : err) : err.stack.split("\n").slice(0, 3).join(" | ");
    console.log(`::warning title=Release timing::${what}: ${detail}`);
  }
}

function report(opts, data, runLabel) {
  const res = analyse({ workflow: opts.workflow, ...data });
  const md = markdown({ workflow: opts.workflow, runLabel, rows: res.rows, baselineCount: res.baselineCount });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  else console.log(md);
  for (const w of res.warnings) console.log(`::warning title=Release timing::${w}`);
  console.log(`timing-report: ${res.warnings.length} warning(s)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
