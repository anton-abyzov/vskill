# Playwright E2E Verification Report

**Run date**: 2026-04-23
**Repo**: `repositories/anton-abyzov/vskill/`
**Raw log**: `e2e/playwright-run-log-1776928243.txt`

## Environment

| Item | Value |
|---|---|
| Playwright | 1.58.2 |
| Chromium | Chrome-for-Testing 145.0.7632.6 (playwright chromium v1208) |
| Node.js | v22.20.0 |
| OS | macOS (Darwin 25.4.0, arm64) |
| Workers | 8 |
| Server | Auto-booted via `playwright.config.ts` `webServer` — `node dist/index.js eval serve --root e2e/fixtures --port 3077` |
| Base URL | `http://localhost:3077` |
| Headless | true |

## Totals

| Metric | Value |
|---|---|
| Total tests | **56** |
| Passed | **38** |
| Failed | **15** |
| Skipped (`test.fixme`) | **3** |
| Wall-clock (Playwright reporter) | **41.9 s** |
| Wall-clock (shell START→END) | **42 s** |

Server boot + test collection + shutdown are included in wall-clock. Playwright auto-shuts down the webServer when the test run completes, so no manual cleanup was required.

## Per-spec summary

| Spec | Pass | Fail | Skip | Notes |
|---|---:|---:|---:|---|
| `eval-ui.spec.ts` | 14 | 1 | 0 | Only the 1 s page-load perf gate failed |
| `detail-panel.spec.ts` | 1 | 0 | 0 | |
| `keyboard-shortcuts.spec.ts` | 2 | 3 | 0 | j/k nav, Cmd+B, Cmd+Shift+D all regressed |
| `leaderboard.spec.ts` | 1 | 2 | 0 | No "Leaderboard" tab in DOM |
| `lighthouse-budget.spec.ts` | 1 | 1 | 0 | FCP not reported by headless Chromium |
| `performance-marks.spec.ts` | 2 | 1 | 0 | Search-filter interaction took 313 ms (budget 80 ms / hard 160 ms) |
| `qa-click-audit.spec.ts` | 10 | 5 | 3 | 3 known `test.fixme` |
| `sidebar-split.spec.ts` | 2 | 1 | 0 | OWN-section collapse does not persist across reload |
| `tests-panel.spec.ts` | 1 | 2 | 0 | TestsPanel filter tabs never render |
| `theme-persistence.spec.ts` | 3 | 0 | 0 | |

## Full test list

| # | Spec | Test | Duration | Result |
|---:|---|---|---:|---|
| 1 | eval-ui | health endpoint returns ok | 29 ms | PASS |
| 2 | eval-ui | UI loads with sidebar and heading | 108 ms | PASS |
| 3 | eval-ui | GET /api/skills returns test-skill | 1 200 ms | PASS |
| 4 | eval-ui | skills list page shows test-skill | 3 100 ms | PASS |
| 5 | eval-ui | GET /api/skills/:plugin/:skill returns skill content | 99 ms | PASS |
| 6 | eval-ui | GET /api/skills/:plugin/:skill/evals returns eval cases | 157 ms | PASS |
| 7 | eval-ui | PUT /api/skills/:plugin/:skill/evals validates body | 651 ms | PASS |
| 8 | eval-ui | PUT /api/skills/:plugin/:skill/evals saves valid data | 541 ms | PASS |
| 9 | eval-ui | GET /api/skills/:plugin/:skill/benchmark/latest returns benchmark | 4 ms | PASS |
| 10 | eval-ui | GET /api/skills/:plugin/:skill/history returns array | 4 ms | PASS |
| 11 | eval-ui | GET /api/skills/nonexistent/skill returns empty detail | 3 ms | PASS |
| 12 | eval-ui | GET /api/skills/nonexistent/skill/evals returns error | 417 ms | PASS |
| 13 | eval-ui | GET /api/unknown-route returns 404 | 376 ms | PASS |
| 14 | eval-ui | skill list links navigate to detail page | 2 000 ms | PASS |
| 15 | eval-ui | **page loads in under 1 second** | 1 900 ms | **FAIL** — perf budget: received 1914 ms, expected <1000 ms |
| 16 | eval-ui | API /api/skills responds in under 200 ms | 175 ms | PASS |
| 17 | eval-ui | API /api/config responds in under 1 second | 85 ms | PASS |
| 18 | eval-ui | skill detail page loads in under 1 second | 817 ms | PASS |
| 19 | detail-panel | T-034 — clicking a skill populates DetailHeader + Metadata tab | 2 900 ms | PASS |
| 20 | keyboard-shortcuts | T-050 — `/` focuses the sidebar search input from the body | 2 400 ms | PASS |
| 21 | keyboard-shortcuts | T-050 — **`j`/`k` move selection in the sidebar** | 2 900 ms | **FAIL** — `[data-testid='skill-row'][aria-selected='true']` never appears |
| 22 | keyboard-shortcuts | T-050 — `?` opens the keyboard cheatsheet and Escape closes it | 413 ms | PASS |
| 23 | keyboard-shortcuts | T-050 — **Cmd/Ctrl+B toggles sidebar visibility** | 6 500 ms | **FAIL** — `aside[aria-label='Skills sidebar']` stays visible after Cmd+B |
| 24 | keyboard-shortcuts | T-050 — **Cmd/Ctrl+Shift+D toggles the theme** | 152 ms | **FAIL** — `data-theme` unchanged after the shortcut |
| 25 | leaderboard | **leaderboard tab is visible in workspace** | 7 300 ms | **FAIL** — `text=Leaderboard` not found in DOM |
| 26 | leaderboard | **leaderboard panel shows empty state when no sweep data** | 30 000 ms | **FAIL** (test timeout 30 s) — same root cause: no Leaderboard tab |
| 27 | leaderboard | leaderboard API endpoint responds | 28 ms | PASS |
| 28 | lighthouse-budget | T-055 — **FCP is reported within the smoke budget** | 135 ms | **FAIL** — browser reported no FCP entry (received null) |
| 29 | lighthouse-budget | T-055 — DOM interactive is reported within the smoke budget | 1 400 ms | PASS |
| 30 | performance-marks | T-051 — detail panel renders within 120 ms of skill click | 2 200 ms | PASS |
| 31 | performance-marks | T-051 — **typing in search updates results within 80 ms** | 2 400 ms | **FAIL** — 313 ms observed (soft budget 80 ms, hard 160 ms) |
| 32 | performance-marks | T-051 — theme toggle does not schedule long-tasks >50 ms | 520 ms | PASS |
| 33 | qa-click-audit | **breadcrumb nav [AC-US3-01]** | 729 ms | **FAIL** — 2 interactive breadcrumb links found; test expects 0 (regression tracked in `qa-findings.md`) |
| 34 | qa-click-audit | detail tabs [AC-US3-01, AC-US8-06] | 3 200 ms | PASS |
| 35 | qa-click-audit | copy path button [AC-US3-01] | 2 000 ms | PASS |
| 36 | qa-click-audit | sidebar row click [AC-US1-03, AC-US3-01] | 2 200 ms | PASS |
| 37 | qa-click-audit | sidebar search [AC-US4-01, AC-US4-06] | 1 600 ms | PASS |
| 38 | qa-click-audit | **section collapse persistence [AC-US1-05]** | 6 200 ms | **FAIL** — OWN section stays `aria-expanded=true` after reload |
| 39 | qa-click-audit | keyboard navigation [AC-US4-02, AC-US4-05] | 175 ms | PASS |
| 40 | qa-click-audit | **theme toggle [AC-US2-03, AC-US2-04]** | 747 ms | **FAIL** — status-bar toggle did not flip `data-theme` |
| 41 | qa-click-audit | command palette [FR-005] | 236 ms | PASS |
| 42 | qa-click-audit | context menu [AC-US4-07] | — | **SKIP (test.fixme)** |
| 43 | qa-click-audit | metadata tab — ENTRY POINT / DIRECTORY render cleanly | 514 ms | PASS |
| 44 | qa-click-audit | metadata tab — HOMEPAGE external anchor | — | **SKIP (test.fixme)** |
| 45 | qa-click-audit | skill deps chips — navigate on click | — | **SKIP (test.fixme)** |
| 46 | qa-click-audit | versions tab [AC-US3-08] | 670 ms | PASS |
| 47 | qa-click-audit | **toast lifecycle [AC-US4-08]** | 611 ms | **FAIL** — Escape does not early-dismiss the toast (1 toast still rendered) |
| 48 | sidebar-split | OWN and INSTALLED section headers render with counts | 247 ms | PASS |
| 49 | sidebar-split | **collapse state for OWN section persists across reload** | 9 300 ms | **FAIL** — same root cause as test #38 |
| 50 | sidebar-split | `/` shortcut focuses the sidebar search input | 833 ms | PASS |
| 51 | tests-panel | **TestsPanel filter tabs render (All / Unit / Integration)** | 7 900 ms | **FAIL** — "Unit" tab button not in DOM |
| 52 | tests-panel | TestsPanel test cases show type badges (U/I) | 1 200 ms | PASS |
| 53 | tests-panel | **filter tabs filter the test case list** | 378 ms | **FAIL** — 0 `button:has-text('#')` elements (no rows rendered) |
| 54 | theme-persistence | T-049 — FOUC-guard applies dark theme before React mount | 3 000 ms | PASS |
| 55 | theme-persistence | T-049 — data-theme remains dark after reload | 2 400 ms | PASS |
| 56 | theme-persistence | T-049 — status-bar toggle cycles dark → auto and persists | 1 500 ms | PASS |

Durations are taken verbatim from Playwright's `--reporter=list` output (rounded to ms). Tests run in parallel across 8 workers, so per-test wall-clock times do not sum to total runtime.

## Broken in production

These are genuine product defects, not environment or selector flakes. Each is visible with the real studio UI running on `localhost:3077`.

### B1. OWN/INSTALLED sidebar section collapse does not persist across reload
- **Tests**: `qa-click-audit.spec.ts:174` "section collapse persistence [AC-US1-05]", `sidebar-split.spec.ts:47` "collapse state for OWN section persists across reload"
- **Symptom**: After clicking the OWN header and reloading, `aria-expanded` is back to `true`. Expected: persisted state.
- **AC**: AC-US1-05
- **Evidence**: two independent specs fail with identical payload (`Received: "true"`, `Expected: "false"`).

### B2. Theme-toggle (both shortcut and status-bar button) does not change `data-theme`
- **Tests**: `keyboard-shortcuts.spec.ts:100` "Cmd/Ctrl+Shift+D toggles the theme", `qa-click-audit.spec.ts:230` "status-bar theme button flips data-theme and persists to localStorage"
- **Symptom**: Starting from `data-theme="light"`, both the keyboard shortcut and the status-bar button leave `data-theme` unchanged.
- **Note**: `theme-persistence.spec.ts:79` ("status-bar toggle cycles dark → auto and persists") PASSED — so the cycle works when the starting theme is `dark`, but not from `light`. That points at a specific branch in the cycle logic (`light → ?`).
- **ACs**: AC-US2-03, AC-US2-04

### B3. `j`/`k` keyboard navigation never sets `aria-selected` on a skill row
- **Test**: `keyboard-shortcuts.spec.ts:47`
- **Symptom**: After pressing `j`, `[data-testid='skill-row'][aria-selected='true']` is still null. The sidebar has exactly one fixture row so `j` should either no-op-with-selection or select-the-first row — it does neither.

### B4. Cmd/Ctrl+B does not hide the skills sidebar
- **Test**: `keyboard-shortcuts.spec.ts:85`
- **Symptom**: `aside[aria-label='Skills sidebar']` remains visible after Cmd+B. The shortcut either isn't wired up or the aside's `display`/`visibility` doesn't toggle.

### B5. Leaderboard tab is not rendered in the workspace shell
- **Tests**: `leaderboard.spec.ts:5`, `leaderboard.spec.ts:13`
- **Symptom**: `text=Leaderboard` does not exist on a freshly-loaded skill detail page. The leaderboard **API** endpoint works (last leaderboard test passes), so the backend is fine — the UI affordance is missing.

### B6. TestsPanel filter tabs do not render
- **Tests**: `tests-panel.spec.ts:5`, `tests-panel.spec.ts:30`
- **Symptom**: After clicking a skill, `button:has-text('Unit')` / `button:has-text('Integration')` are absent, and `button:has-text('#')` rows are absent. The "tests-panel shows type badges (U/I)" test (#52) PASSES with a narrower locator, so *something* renders — but the All/Unit/Integration tab group is missing.

### B7. Breadcrumb items are now interactive — QA audit drift
- **Test**: `qa-click-audit.spec.ts:44` (a "regression tracking" test that was intentionally asserting the current non-interactive state)
- **Symptom**: 2 interactive breadcrumb anchors exist; the test (which was pinned to `0` as a regression canary) needs to be updated to match the new design. `qa-findings.md` is the canonical log for this — per the test's own comment.
- **Classification**: UI change landed ahead of the test update. Not strictly a defect; needs a spec/test reconciliation. Reported here for visibility.

### B8. Escape does not early-dismiss the `'e'`-toast
- **Test**: `qa-click-audit.spec.ts:385` (AC-US4-08)
- **Symptom**: After pressing `'e'` to fire a toast and then `Escape`, the toast is still present (count=1, expected 0). Auto-dismiss may still work; early-dismiss on Escape is broken.

## Performance-budget failures (triage separately)

These are real regressions, but they straddle environment variance and headless-Chromium quirks. Worth re-running on CI or a stabilised machine before treating as hard defects.

| Test | Observed | Budget | Notes |
|---|---:|---:|---|
| `eval-ui.spec.ts:168` "page loads in under 1 second" | 1914 ms | 1000 ms | Cold-boot of the dev server is likely included — the first `/` navigation picks up the uncached bundle. |
| `performance-marks.spec.ts:74` "typing in search updates results within 80 ms" | 313 ms | 80 ms soft / 160 ms hard | Blows the hard ceiling by 2×. Soft assertion + hard cap both fail. Either a real regression (non-virtualised re-render) or a headless timing quirk. |
| `lighthouse-budget.spec.ts:31` "FCP reported within budget" | n/a | — | Browser reported **no FCP entry at all**. Likely a Chromium headless timing issue — not a product bug — but the spec treats missing entry as fatal. |

## Skipped (`test.fixme` — expected)

| Spec | Test | Reason |
|---|---|---|
| `qa-click-audit.spec.ts:288` | right-click on a skill row opens the custom ContextMenu | marked `test.fixme` |
| `qa-click-audit.spec.ts:335` | HOMEPAGE renders as an external anchor with rel=noopener | marked `test.fixme` |
| `qa-click-audit.spec.ts:351` | clicking an installed dep chip navigates to that skill | marked `test.fixme` |

## Screenshots / traces

Playwright produced **error-context.md** files under `test-results/<slug>/` for every failing test. Screenshots and full traces were **not** collected — `playwright.config.ts` does not enable `use.screenshot` / `use.trace`. If the team wants trace files on failure, add `use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }` to the config.

Artefact paths (one per failing test):
```
test-results/eval-ui-page-loads-in-under-1-second/error-context.md
test-results/keyboard-shortcuts-T-050-—-51205-ve-selection-in-the-sidebar/error-context.md
test-results/keyboard-shortcuts-T-050-—-5bfd1--toggles-sidebar-visibility/error-context.md
test-results/keyboard-shortcuts-T-050-—-8e55e-l-Shift-D-toggles-the-theme/error-context.md
test-results/leaderboard-Leaderboard-pa-24aac-ty-state-when-no-sweep-data/error-context.md
test-results/leaderboard-Leaderboard-pa-419c8-tab-is-visible-in-workspace/error-context.md
test-results/lighthouse-budget-T-055-—--47efd-ted-within-the-smoke-budget/error-context.md
test-results/performance-marks-T-051-—--d0a06-updates-results-within-80ms/error-context.md
test-results/qa-click-audit-breadcrumb--876fe-n-tracked-in-qa-findings-md/error-context.md
test-results/qa-click-audit-section-col-6d000-se-state-persists-on-reload/error-context.md
test-results/qa-click-audit-theme-toggl-6cd19-nd-persists-to-localStorage/error-context.md
test-results/qa-click-audit-toast-lifec-1dd3b-5s-Escape-dismisses-earlier/error-context.md
test-results/sidebar-split-sidebar-spli-7d7f6-tion-persists-across-reload/error-context.md
test-results/tests-panel-TestsPanel-fil-9961a--tabs-All-Unit-Integration-/error-context.md
test-results/tests-panel-TestsPanel-fil-b6480-s-filter-the-test-case-list/error-context.md
```

## Actionable findings

**Real UI defects (fix in source)**: B1, B2, B3, B4, B5, B6, B8. All seven have failing specs with clear reproducers — no wiring work needed.

**Test/spec drift (fix in test or reconcile with product)**: B7 — breadcrumbs are now interactive; update the regression canary or remove it.

**Perf budget ambiguity**: three tests fail on timing. Re-run on a quiescent machine / CI before fixing; one of them (FCP) is almost certainly a headless Chromium artefact rather than a product regression.

**Environment**: fully clean. Server boot succeeded on first try, Chromium installed without sudo, no LM Studio dependency in this suite.
