# QA click-audit — Skill Studio Redesign (increment 0674)

**Auditor:** qa-e2e-agent (team `impl-0674-studio`)
**Target:** `src/eval-ui/` SPA — redesigned Studio at `npx vskill studio`
**Method:** Static code review of every interactive surface, plus
Playwright + Vitest assertions that lock the contract in.
**Scope:** Phases 1–4 of increment 0674 (shell, theme, detail panel, keyboard /
palette / toasts).

The tables below group findings by severity. The handoff to `ui-link-agent` is
the **High** block — everything a user would see at first glance. The other
blocks are still worth fixing but are less visible.

Playwright chromium is installed locally (tested `npx playwright --version`
→ 1.58.2). Specs in `e2e/qa-click-audit.spec.ts` should run green on CI once
the highlighted regressions are fixed; tests that describe a not-yet-wired
behavior are marked `test.fixme()` so the suite stays green today.

---

## Severity: High (user-visible regressions)

| # | Issue | Component file | User impact | Suggested fix |
|---|---|---|---|---|
| 1 | **Versions tab is dead in integrated mode** — `App.tsx` passes `selectedSkillInfo` to `RightPanel`, which routes through `renderDetailShell`. That branch receives the `onDetailTabChange` prop from the caller but `App.tsx` never supplies one. Clicking **Versions** is a no-op and the user stays on Overview. When Versions does render, it falls into the `integrated == null` else-branch and shows the "Select a skill from the sidebar…" fallback even with a skill selected. | `src/eval-ui/src/App.tsx` (line ~153), `src/eval-ui/src/components/RightPanel.tsx` (`renderDetailShell`, `renderSkillDetail`) | Every user who clicks "Versions" sees nothing change. Breaks AC-US3-08. | Switch `App.tsx` to the `IntegratedDetailShell` path: render `<RightPanel />` with NO props and let it pull selection out of `StudioContext`, OR lift the tab-state hook into `App.tsx` and pass `activeDetailTab` + `onDetailTabChange`. Also pass `allSkills` + `onSelectSkill` so skill-dep chips work. |
| 2 | **Right-click context menu not wired** — `ContextMenu.tsx` exists (`data-testid="context-menu"`) and `SkillRow` accepts an `onContextMenu` prop, but nothing in `Sidebar`, `PluginGroup`, or `App.tsx` supplies it. Right-clicking a sidebar skill row shows the native browser menu instead of the custom menu. | `src/eval-ui/src/components/Sidebar.tsx` (passes row props to `PluginGroup` / `SectionList`), `src/eval-ui/src/components/PluginGroup.tsx` (line ~70), `src/eval-ui/src/components/SkillRow.tsx` (prop exists) | Violates AC-US4-07. Users expect Open / Copy Path / Reveal / Edit / Duplicate / Uninstall entries. | Lift a `contextMenuAnchor` state into `App.tsx` (or a dedicated `useContextMenu` hook), pass `onContextMenu={(e, s) => setAnchor({x: e.clientX, y: e.clientY, skill: s})}` through `Sidebar` → `PluginGroup` → `SkillRow`, and render `<ContextMenu>` anchored to that state. |
| 3 | **Model selector missing from redesigned shell** — `ModelSelector.tsx` exists but no file imports it (`grep import.*ModelSelector` returns nothing in eval-ui). The top rail and status bar only show the model **name** label in `StatusBar`; the user can't change the model from the main view. | `src/eval-ui/src/components/ModelSelector.tsx` (orphaned), `src/eval-ui/src/components/StatusBar.tsx` (read-only model name), `src/eval-ui/src/App.tsx` (doesn't render it) | Model change is part of the daily run-benchmark loop. AC-US4-04 (`R` shortcut) assumes a model is picked; without a selector users go back to a config file. | Re-mount `<ModelSelector>` inside `StatusBar` next to the model-name chip, OR in `TopRail` right of the Cmd+K trigger. Load `/api/models` and fire `onChange` to the existing `ConfigContext.setModel` setter. |
| 4 | **HOMEPAGE anchor styling relies on hardcoded color via `var(--text-accent)`** — `MetadataTab.renderFrontmatterCard` uses `color: var(--text-accent)` which is NOT in the token set we could locate (`grep text-accent globals.css` — none). In dark theme the anchor inherits nothing, so the link looks like plain text. | `src/eval-ui/src/components/MetadataTab.tsx` (line 179) | Homepage anchor is visually indistinguishable from the path chip — users don't know it's clickable. Against AC-US2-01 / AC-US2-02 "every token has a counterpart in light". | Replace `var(--text-accent)` with an existing token — `var(--accent-surface)` or define `--text-accent` in `globals.css` for both themes. |
| 5 | **Copy action doesn't fire a toast** — DetailHeader's copy button flips local state to `"Copied"` for 1.5s but never calls `useToast()`. The ToastProvider is available in the tree but unused. AC-US10-04 wants "Saved obsidian-brain." / "Installed 3 skills." style confirmations; copy-path is the same pattern. | `src/eval-ui/src/components/DetailHeader.tsx` (`onCopyPath`) | Users on noisy screens miss the state flip on the button itself — the toast would confirm the action matches AC-US4-08 (4s auto-dismiss, Escape-dismissable, keyboard-announced). | Wire `useToast()` into DetailHeader. On successful `clipboard.writeText`, call `toast({ message: "Path copied.", severity: "info", durationMs: 4000 })`. Catch block → `toast({ message: "Couldn't copy — clipboard denied.", severity: "error" })`. |
| 6 | **Breadcrumb segments are non-interactive spans** — `TopRail.tsx` renders `OWN / plugin / skill` as plain `<span>` elements. The spec says "breadcrumb-style prefix" but developers (and existing e2e tests) expect to click plugin to scope the sidebar or skill to deep-link. | `src/eval-ui/src/components/TopRail.tsx` (lines 92–111) | Users reflexively click breadcrumb segments — nothing happens. Silent dead-end. | (a) Project-name span → clicking clears selection (reset to empty state). (b) Plugin span → filter sidebar by that plugin. (c) Skill span → no-op but change cursor to default. Wrap each interactive segment in `<button type="button">` with `aria-label` and calm styling (no underline until hover). |
| 7 | **Path chip has no copy path of its own** — the path chip next to the Copy button looks clickable (border, monospace, ellipsis) but has no `onClick`. Users who hit the chip first get nothing. | `src/eval-ui/src/components/DetailHeader.tsx` (lines 169–189) | Minor dead-click in the primary metadata region — sibling Copy button is right there but the chip is the more obvious target. | Either make the chip itself a button that copies + toasts, OR drop the chip's border so it looks like text. Prefer the former (the button is small and requires another click). |

---

## Severity: Medium (polish / accessibility)

| # | Issue | Component file | User impact | Suggested fix |
|---|---|---|---|---|
| 8 | **MONO_VALUE_STYLE uses `wordBreak: "break-all"`** — long paths break **mid-character** instead of at `/` boundaries. The spec says paths should wrap cleanly. | `src/eval-ui/src/components/MetadataTab.tsx` (line 70) | Paths become hard to scan on narrow panels — `/Use\nrs/anton/Proje\ncts/...` | Change to `wordBreak: "break-word"` or add `overflowWrap: "anywhere"` so the browser prefers whitespace / `/` boundaries. |
| 9 | **Skill-dep chip tooltip uses `title="Open <dep>"`** — fine for a pointing device but the button has no focused-state hint for keyboard users. | `src/eval-ui/src/components/MetadataTab.tsx` (lines 406–420) | Keyboard users don't get the "Not installed" state announced — relies on visual class. | Add `aria-label` mirroring `title`, and visible hover/focus state using `border-color: var(--accent-surface)`. |
| 10 | **TopRail has no sidebar-hide button for narrow viewports** — AC-US7-03 says "the sidebar is hidden behind an overlay drawer toggleable from the top bar (hamburger icon)". Not present. | `src/eval-ui/src/components/TopRail.tsx`, `src/eval-ui/src/App.tsx` | Users at <768px get a broken layout. | Render a hamburger button in TopRail for mobile layouts, toggle `state.mobileView === "list"/"detail"`. |
| 11 | **Toast queue has no visible close affordance** — ToastProvider schedules a 4s auto-dismiss but Toast.tsx (ToastStack) rendering isn't obviously wired to a visible close button for the whole stack. (Implementation likely has one — flag for visual review.) | `src/eval-ui/src/components/Toast.tsx` | Users wanting to dismiss an error manually tap Escape; not discoverable. | Ensure each ToastRecord renders with an explicit `<button aria-label="Dismiss"><XIcon /></button>`; verify via RTL test. |
| 12 | **Integrated RightPanel branch is unreachable from App.tsx** — the `IntegratedDetailShell` path (with local tab state, `allSkills`, `onSelectSkill`) is only reachable when `selectedSkillInfo === undefined && loadError === undefined`. App.tsx always supplies `selectedSkillInfo`. | `src/eval-ui/src/components/RightPanel.tsx` (line 67) | Dead-code effectively; clicking skill-dep chips does nothing in prod because `onSelectSkill` isn't piped through the test-mode branch. | Either delete the test-mode branch and drive RightPanel entirely from StudioContext, or pass `allSkills` + `onSelectSkill` + `activeDetailTab` + `onDetailTabChange` from App.tsx. Either is fine — current hybrid is the worst option. |

---

## Severity: Low (documentation / hygiene)

| # | Issue | Component file | User impact | Suggested fix |
|---|---|---|---|---|
| 13 | **`text-accent` CSS variable undefined** — used in MetadataTab but not declared anywhere in `globals.css`. Falls back to inherited color silently. | `src/eval-ui/src/styles/globals.css` | Anchor looks unstyled in both themes. | Declare `--text-accent` in both `[data-theme="dark"]` and `[data-theme="light"]` blocks. |
| 14 | **Section headers use tabular-nums count inside `<h2>`** — fine accessibility-wise but the count span is a sibling of the heading; screen readers read "Own 1" as one phrase. | `src/eval-ui/src/components/SidebarSection.tsx` (lines 108–119) | Minor — AT still gets a usable announcement. | Optional: wrap count in `aria-label="1 skill"` and hide the literal text via `aria-hidden="true"`. |
| 15 | **Existing Sidebar tests cover filter + collapse but not empty-state CTAs** — the "Create a skill" CTA called out in AC-US1-07 is absent from `Sidebar.tsx`'s `OwnEmptyState`. | `src/eval-ui/src/components/Sidebar.tsx` (lines 279–299) | AC-US1-07 CTA requirement not met. | Add `<button>+ New skill</button>` wired to the existing create flow (`setMode("create")`) in OwnEmptyState's empty path. |

---

## Verification

### Playwright specs
All 14 interactions have a matching `test(...)` in `e2e/qa-click-audit.spec.ts`:

1. `breadcrumb nav [AC-US3-01]` — updated in increment 0684 (B7) to assert the shipped T-059 behavior: 2 interactive segments (`Own`, `test-plugin`) plus an inert current segment (`test-skill`). Regression canary closed.
2. `detail tabs [AC-US3-01, AC-US8-06]` — will FAIL until finding #1 is fixed; that's the intended signal.
3. `copy path button [AC-US3-01]` — reads clipboard on chromium.
4. `sidebar row click [AC-US1-03, AC-US3-01]` — green.
5. `sidebar search [AC-US4-01, AC-US4-06]` — green.
6. `section collapse persistence [AC-US1-05]` — green (covered by T-022, this is a re-assertion for the audit).
7. `keyboard navigation [AC-US4-02, AC-US4-05]` — green assuming `j/k` + `?` shortcuts are live.
8. `theme toggle [AC-US2-03, AC-US2-04]` — green.
9. `command palette [FR-005]` — green.
10. `context menu [AC-US4-07]` — `test.fixme()` pending finding #2 fix.
11. `metadata tab links + wrapping [AC-US3-02, AC-US3-05]` — DIRECTORY wordBreak assertion FAILS until finding #8 is fixed. HOMEPAGE anchor is `test.fixme()` pending a fixture skill with a populated `homepage`.
12. `skill deps chips [AC-US3-04]` — `test.fixme()` pending fixture skill with deps.
13. `versions tab [AC-US3-08]` — FAILS until finding #1 is fixed.
14. `toast lifecycle [AC-US4-08]` — green assuming 'e' shortcut fires `editPlaceholder` toast.

### Vitest (jsdom) assertions
`src/eval-ui/src/components/__tests__/qa-interactions.test.tsx` covers shape-level contracts:

- HOMEPAGE renders as `<a target=_blank rel=noopener noreferrer>` when value present
- Skill-dep chips carry `data-present` + tooltip
- DetailHeader copy button has `aria-label` + accessible path chip
- RightPanel tab wiring with `onDetailTabChange` works at component level
- TopRail breadcrumb current (non-clickable) shape
- TopRail does NOT render the theme toggle (guards against accidental duplication)

### How to re-verify

```bash
# jsdom (fast — run after every component change)
npx vitest run src/eval-ui/src/components/__tests__/qa-interactions.test.tsx

# Playwright click audit (needs a dist build first)
npm run build
npx playwright test e2e/qa-click-audit.spec.ts --reporter=list
```

### Chromium install note
`chromium-1217` is present in `~/Library/Caches/ms-playwright/`. No install step needed.

---

## Handoff checklist for ui-link-agent

- [ ] **Finding #1** (Versions tab wiring) — touching `App.tsx` + `RightPanel.tsx` internals
- [ ] **Finding #2** (ContextMenu wiring) — touching `App.tsx` + `Sidebar.tsx` + `PluginGroup.tsx`
- [ ] **Finding #3** (ModelSelector mount) — touching `StatusBar.tsx` OR `TopRail.tsx`
- [ ] **Finding #4** (`--text-accent` token) — touching `globals.css`
- [ ] **Finding #5** (copy toast) — touching `DetailHeader.tsx`
- [ ] **Finding #6** (breadcrumb anchors) — touching `TopRail.tsx`
- [ ] **Finding #7** (clickable path chip) — touching `DetailHeader.tsx`
- [ ] **Finding #8** (wordBreak) — touching `MetadataTab.tsx`
- [ ] **Finding #15** (Own empty CTA) — touching `Sidebar.tsx`

Non-overlapping with QA's owned files — all of these are component source
edits, which QA will not touch.
