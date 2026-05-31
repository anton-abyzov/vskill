// Build-gate test — Anthropic phase-3-verify rule:
//   "every VerifiableUnit MUST have at least one probe fixture; otherwise the
//    suite is only a happy-path replay and the framework can't catch lies."
// We also enforce ≥1 declared invariant per unit (warn → soft pass for MVP).

import { test } from "node:test";
import assert from "node:assert/strict";

import { listUnits } from "./registry.mjs";
import { runUnit } from "./runner.mjs";
import { isCiMode, isCiSafe } from "./ci-mode.mjs";
// Imports register the units.
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
// 0857: the model-run regression-guarantee unit.
import "./units/golden-path.verify.mjs";

const CI = isCiMode();

// 0858: structural assertions are hermetic (they only read declarations, never
// execute a unit), so they hold on a bare runner. But to honor the CI contract —
// "if it iterates all units, skip ciSafe:false ones under CI with a warning,
// mirroring run-verify" — we filter the iteration under CI and warn loudly.
function unitsForIteration() {
  if (!CI) return listUnits();
  return listUnits().filter((u) => {
    if (isCiSafe(u)) return true;
    console.warn(`::warning:: verify CI-SKIP (matrix) ${u.id} — ${u.ciSkipReason || "ciSafe:false"}`);
    return false;
  });
}

test("AC-US2-01: every unit has at least one probe fixture", () => {
  for (const u of unitsForIteration()) {
    const probes = u.fixtures.filter((f) => f.probe === true);
    assert.ok(
      probes.length >= 1,
      `Unit "${u.id}" has no probe fixtures — only the happy path is covered. Add at least one fixture with probe: true.`,
    );
  }
});

test("AC-US2-02: every unit declares at least one invariant", () => {
  for (const u of unitsForIteration()) {
    assert.ok(
      u.invariants.length >= 1,
      `Unit "${u.id}" declares zero invariants — surface would be unverified beyond schema.`,
    );
  }
});

test("manifest is non-empty (sanity)", () => {
  const units = listUnits();
  assert.ok(units.length >= 10, `expected ≥10 registered units after expansion, got ${units.length}`);
});

// ---------------------------------------------------------------------------
// 0857 AC-US2-01 / AC-US2-02 — LOUD-SKIP GATE (kills the silent-green trap).
//
// A run where EVERY model-run lane SKIPs (no `claude` binary, no API key) must
// NOT look green. We enforce two things on the actual U-GOLDEN run:
//   1. at least one model-run fixture reports PASS (not SKIP/BLOCKED), and
//   2. every BLOCKED (our SKIP-equivalent) fixture emits a `::warning::` line
//      carrying provider + reason, so CI surfaces it loudly.
//
// The stub lane is the guaranteed PASS — it needs no binary/key, so this gate
// holds even on a machine with no `claude` installed. If the deterministic stub
// itself ever SKIPs/BLOCKs, this test FAILs rather than passing silently.
// ---------------------------------------------------------------------------
test("AC-US2-01/02: loud-skip gate — ≥1 model-run PASS, every SKIP warns", async () => {
  const golden = listUnits().find((u) => u.id === "U-GOLDEN");
  assert.ok(golden, "U-GOLDEN unit must be registered for the loud-skip gate");

  // 0858: the core invariant — U-GOLDEN MUST be ciSafe so it still EXECUTES (and
  // must PASS) under CI. If it were ever marked ciSafe:false, CI mode would mask
  // a real golden-path regression. Guard against that here.
  assert.ok(
    isCiSafe(golden),
    "U-GOLDEN must be ciSafe (it must run + PASS in CI to guard the golden path)",
  );

  const result = await runUnit(golden);

  // The probe fixtures encode lie-detectors (expected BLOCKED / FAIL), so the
  // "is this run green?" question is about the NON-probe (happy) model-run
  // lanes only.
  const happy = result.fixtures.filter((f) => !f.probe);

  // Emit ::warning:: for every genuine SKIP-equivalent (BLOCKED) lane. A probe
  // whose BLOCKED is EXPECTED (a lie-detector firing as designed) is not a skip
  // — only an unexpected BLOCKED means the lane could not run (no binary/key).
  let skipCount = 0;
  for (const f of result.fixtures) {
    if (f.verdict === "BLOCKED" && f.expectedMet !== true) {
      skipCount++;
      const reason = (f.blockedReason || "no reason given").split("\n")[0];
      // GitHub Actions surfaces `::warning::`-prefixed lines in the run summary.
      console.warn(`::warning:: verify SKIP (BLOCKED) ${result.unitId}/${f.fixtureId} — provider=stub reason=${reason}`);
    }
  }

  const passingHappy = happy.filter((f) => f.verdict === "PASS");
  assert.ok(
    passingHappy.length >= 1,
    `LOUD-SKIP GATE: zero model-run lanes PASSed (${happy.length} happy fixtures, ${skipCount} BLOCKED). ` +
      `An all-SKIP run must NOT be green — the deterministic stub lane is expected to PASS without any binary/key.`,
  );
});

// ---------------------------------------------------------------------------
// 0858 AC-US1-01/02 — CI-SKIP CLASSIFICATION GUARD.
//
// Pin the exact set of env-dependent (ciSafe:false) units so a future edit can't
// silently flip the core regression-guarantee unit (U-GOLDEN) — or any hermetic
// unit — into the skipped bucket and mask a real failure on the CI lane.
// ---------------------------------------------------------------------------
test("AC-US1-01/02: CI-skip classification is exactly the env-dependent units", () => {
  const EXPECTED_CI_SKIPPED = [
    "U-INSTALL",
    "U-LIST",
    "U-PIN",
    "U-LOCKFILE-CYCLE",
    "U-STUDIO-API-INSTALL-STATE",
  ].sort();
  const HERMETIC = ["U-GOLDEN", "U-SKILL-NEW", "U-REMOVE", "U-INFO", "U-OUTDATED", "U-AUDIT", "U-INIT"];

  const actualSkipped = listUnits()
    .filter((u) => !isCiSafe(u))
    .map((u) => u.id)
    .sort();
  assert.deepEqual(
    actualSkipped,
    EXPECTED_CI_SKIPPED,
    "ciSafe:false set drifted — env-dependent classification must stay pinned",
  );

  // Every ciSafe:false unit must carry a human reason for the ::warning::.
  for (const u of listUnits().filter((x) => !isCiSafe(x))) {
    assert.ok(
      typeof u.ciSkipReason === "string" && u.ciSkipReason.length > 0,
      `Unit "${u.id}" is ciSafe:false but has no ciSkipReason — CI annotation would be empty.`,
    );
  }

  // The hermetic core (incl. U-GOLDEN) must NEVER be CI-skipped.
  for (const id of HERMETIC) {
    const u = listUnits().find((x) => x.id === id);
    assert.ok(u, `expected hermetic unit ${id} to be registered`);
    assert.ok(isCiSafe(u), `${id} must stay ciSafe (hermetic, must run in CI)`);
  }
});
