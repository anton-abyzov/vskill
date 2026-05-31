#!/usr/bin/env node
// CLI entry — the human surface. AC-US1-01, AC-US1-02, AC-US3-01, AC-US3-02.
//
// Single execution path: import units (which self-register) → runAll() → emit JSON to
// two places (per-run report + agent handle) → print a tight grid to stdout.

import { runAll, writeJsonAtomic, buildManifest } from "./runner.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// IMPORTANT: import units AFTER runner so the registry is the same instance.
import "./units/install.verify.mjs";
import "./units/skill-new.verify.mjs";
import "./units/remove.verify.mjs";
import "./units/list.verify.mjs";
import "./units/info.verify.mjs";
import "./units/outdated.verify.mjs";
import "./units/audit.verify.mjs";
import "./units/pin.verify.mjs";
import "./units/init.verify.mjs";
import "./units/lockfile-cycle.verify.mjs";
import "./units/studio-api.verify.mjs";
// 0857: the regression-guarantee unit (create -> install -> run-with-model).
import "./units/golden-path.verify.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 0857: harness now lives at <vskill>/test/verify. The repo root is 2 levels up.
// Reports stay beside the harness; the agent handle stays under the repo's
// .specweave/state so agents read a stable, repo-local location.
const VERIFY_DIR = resolve(__dirname, ".");
const REPO_ROOT = resolve(__dirname, "../..");

const REPORT_PATH = join(VERIFY_DIR, "reports", "verify-result.json");
const AGENT_HANDLE_PATH = join(REPO_ROOT, ".specweave", "state", "verify-current.json");

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (color, s) => (useColor ? COLORS[color] + s + COLORS.reset : s);

function verdictBadge(v) {
  if (v === "PASS") return c("green", "PASS");
  if (v === "FAIL") return c("red", "FAIL");
  if (v === "BLOCKED") return c("yellow", "BLOCKED");
  return c("dim", v);
}

(async () => {
  const result = await runAll();

  // Persist BOTH outputs — same JSON, two consumers.
  writeJsonAtomic(REPORT_PATH, result);
  writeJsonAtomic(AGENT_HANDLE_PATH, {
    version: "1.0",
    manifest: buildManifest(),
    current: result,
  });

  // Print the grid.
  console.log("");
  console.log(c("bold", "Verify runtime — phase-3-verify port (0853)"));
  console.log(c("dim", "─".repeat(64)));
  for (const u of result.units) {
    console.log(`${verdictBadge(u.verdict)}  ${c("bold", u.unitId)}  ${c("dim", u.command)}`);
    for (const f of u.fixtures) {
      const tag = f.probe ? c("cyan", "🔍 probe") : "✅ happy";
      const ms = `${f.durationMs}ms`;
      console.log(`   ${verdictBadge(f.verdict)} ${tag.padEnd(10)} ${f.fixtureId.padEnd(36)} ${c("dim", ms)}`);
      for (const ck of f.checks) {
        if (ck.status === "fail") {
          console.log(`      ${c("red", "✗")} ${ck.id} — ${ck.message ?? ""}`);
          if (ck.actual !== undefined) console.log(c("dim", `        actual: ${JSON.stringify(ck.actual)}`));
        } else if (ck.status === "warn") {
          console.log(`      ${c("yellow", "⚠")} ${ck.id} — ${ck.message ?? ""}`);
        }
      }
      if (f.blockedReason) {
        console.log(c("yellow", `      ⊘ ${f.blockedReason.split("\n")[0]}`));
      }
    }
  }
  console.log(c("dim", "─".repeat(64)));
  console.log(`Overall: ${verdictBadge(result.verdict)}    Report: ${c("dim", REPORT_PATH)}`);
  console.log(`Agent handle: ${c("dim", AGENT_HANDLE_PATH)}`);

  process.exit(result.verdict === "PASS" ? 0 : 1);
})().catch((err) => {
  console.error(c("red", "verify run crashed:"), err);
  process.exit(2);
});
