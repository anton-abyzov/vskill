# Studio E2E suite

Playwright specs in this directory drive the vskill Skill Studio (eval-ui).
They launch chromium (headless) against an `eval serve` instance started by
`playwright.config.ts` on port `3077` and run against the fixture workspace
in `e2e/fixtures/`.

## Running

```bash
npm run build && npm run build:eval-ui   # prereq — eval serve serves dist/
npx playwright install chromium           # one-time per environment
npx playwright test                       # all specs
npx playwright test e2e/<spec>.spec.ts    # single spec
```

## Spec inventory (Phase 4 — 0674-vskill-studio-redesign)

| Spec | Task | Covers | Notes |
|---|---|---|---|
| `detail-panel.spec.ts` | T-034 | Skill selection → detail panel populates | Phase 3 — shipped. |
| `sidebar-split.spec.ts` | T-022 | Sidebar OWN/INSTALLED counts + collapse persistence + `/` | Phase 2 — shipped. |
| `theme-persistence.spec.ts` | T-049 | `vskill-theme=dark` in localStorage → `data-theme=dark` before React mount; persists across reload; toggle cycles dark→auto. | Ready. |
| `keyboard-shortcuts.spec.ts` | T-050 | `/`, `j`, `k`, `?`, `Cmd/Ctrl+B`, `Cmd/Ctrl+Shift+D`. `Cmd+B` and `Cmd+Shift+D` depend on the polish-interactions wave landing global keybindings in `App.tsx`. | Ready. |
| `performance-marks.spec.ts` | T-051 | Detail panel render ≤ 120 ms, search filter ≤ 80 ms, theme toggle `longtask` ≤ 50 ms. Uses CDP CPU throttling (chromium-only). Falls back to wall-clock timing when the app does not emit `performance.mark()` calls. | Ready. |
| `lighthouse-budget.spec.ts` | T-055 (smoke) | FCP + `domInteractive` via `performance.getEntriesByType` as a cheap smoke budget. The authoritative FCP/TTI run is **`npm run test:lhci`** → see `../lighthouse.config.js`. | Ready. |
| `eval-ui.spec.ts`, `tests-panel.spec.ts`, `leaderboard.spec.ts` | — | Pre-existing Phase-1/2/3 specs. | Shipped. |

## Environment notes

- **Playwright chromium browser** is NOT installed automatically — run
  `npx playwright install chromium` (downloads ~120 MB) before running the
  suite. CI environments that pin to `@playwright/test@^1.58` may also need
  `npx playwright install-deps` on Linux.
- **Eval-server build** — `playwright.config.ts` spawns
  `node dist/index.js eval serve --root e2e/fixtures --port 3077`, so
  `npm run build` must have produced `dist/index.js` first. The
  `prepublishOnly` hook runs both builds; locally run
  `npm run build && npm run build:eval-ui` once before `npx playwright test`.
- **Mobile / touch specs**: not yet included — all current specs run in
  desktop chromium.

## Lighthouse CI (T-055)

`test:lhci` invokes `@lhci/cli` with `../lighthouse.config.js`:

```bash
npm run build:eval-ui
npm run test:lhci
```

Assertions:

| Metric | Budget | Action on breach |
|---|---|---|
| `first-contentful-paint` | ≤ 800 ms (median of 3 runs) | **error** |
| `interactive` (TTI) | ≤ 1500 ms | **error** |
| `total-blocking-time` | ≤ 300 ms | warn |

Reports land in `scripts/.lhci/` (git-ignored).

## Bundle size (T-048)

`npm run test:bundle-size` — reads `dist/eval-ui/assets/` after a build and
enforces the ADR-0674-04 budget:

- initial JS chunk (`index-*.js`) ≤ 250 KB gzipped
- fonts chunk (`fonts-*.{js,css}`) ≤ 70 KB gzipped
- lazy JS chunks ≤ 150 KB gzipped each

The pure logic is also unit-tested via
`src/eval-ui/src/__tests__/bundle-size.test.ts`.
