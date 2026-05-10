# Changelog

## [1.0.18] - 2026-05-10

### Security (0836 — Skill Studio Hardening Pass, 6 P0 findings)

- **P0-1 (US-001) — eval-server bind hardened to loopback**: `src/eval-server/eval-server.ts` now passes `'127.0.0.1'` explicitly to `server.listen(...)`. Previously the dual-stack default exposed the GitHub-token-injecting proxy to the LAN; anyone on the same Wi-Fi could reach it. Verified by a connect test against a non-loopback host IP that now returns ECONNREFUSED.
- **P0-2 (US-002) — `X-Studio-Token` gate replaces permissive localhost CORS**: every `/api/*` request now requires a per-launch 256-bit `crypto.randomBytes` token compared with `crypto.timingSafeEqual`. The legacy `LOCALHOST_ORIGIN_RE` allowlist (DNS-rebinding-friendly) is removed. The Tauri WebView reads the token via the new `get_studio_token` IPC; the desktop bundle patches `globalThis.fetch` to inject the header on `/api/*`. CLI users see the token printed once on startup so `curl` workflows still work.
- **P0-3 (US-003) — `account_get_token` IPC removed**: the deleted IPC used to ship the raw `gho_*` token to the WebView. A WebView XSS or compromised npm dep is no longer one IPC call away from full GitHub grant compromise. The replacement `account_get_user_summary` returns only display fields (`signedIn`/`login`/`avatarUrl`/`tier`). All authenticated `/api/v1/account/*` calls now flow through the eval-server's platform-proxy, which injects `Authorization: Bearer <gho_*>` Rust-side from the keychain.
- **P0-4 (US-004) — release build refuses placeholder OAuth `client_id`**: `src-tauri/build.rs` now `panic!`s in the release profile when `GITHUB_OAUTH_CLIENT_ID` is unset OR equals the placeholder `Iv1.placeholder-replace-before-ship`. The CI workflow also runs `strings | grep` against the signed binary as defense-in-depth. v1.0.17 shipped with the placeholder; this gate ensures it never recurs.
- **P0-5 (US-005) — sign-out revokes the GitHub OAuth grant**: `commands::sign_out` is now `async` and calls the platform proxy's `DELETE /api/v1/auth/github/grant` (which forwards to GitHub's `DELETE /applications/{client_id}/grant` with the `client_secret` held server-side per ADR-0831-02). 5s tokio timeout, best-effort: the keychain is ALWAYS cleared even on revocation failure. Token never appears in any log line — only the endpoint, status, and elapsed time.
- **P0-6 (US-006) — keychain service consolidated**: Node CLI now reads/writes the canonical `com.verifiedskill.desktop::github-oauth-token` slot (matching the Rust desktop). A one-time, idempotent, file-mutex-guarded migration moves any token from the legacy `vskill-github::github_token` slot. Sign-in via the desktop is now visible to `vskill auth status` (and vice versa) on the next invocation.

### Non-functional contract preserved

- ZERO changes to `src-tauri/Entitlements.plist` (Apple notarization unchanged).
- ZERO new Tauri capabilities or plugin allowlist additions.
- ZERO new npm or Cargo runtime dependencies (mockito dev-dep already present).

### Documentation

- New `src-tauri/README.md` section documenting the `GITHUB_OAUTH_CLIENT_ID` build-arg requirement.
- New runbook at `.specweave/docs/internal/specs/oauth-client-id-rotation.md` for rotating the OAuth App.

## [1.0.0] - 2026-04-27

### Fixed
- **Studio update notifications — multi-update visibility**: `useSkillUpdates.buildMap` and the `reconcileCheckUpdates` setUpdates callback both keyed by leaf-name only (`u.name.split("/").pop()`). When two skills shared a leaf name across plugins (e.g. `acme/x/foo` + `bob/y/foo`), the second silently overwrote the first in `updatesMap` and downstream lookups, hiding one of the available updates from the panel. Now keys by canonical full name (`<owner>/<repo>/<skill>` or `<plugin>/<skill>`) with a leaf alias added only when unambiguous; ambiguous leaves drop the alias deterministically rather than overwrite.

### Added
- Unit-test coverage for two distinct updates and same-leaf collision scenarios (`useSkillUpdates.test.ts`)
- E2E coverage asserting the dropdown lists every entry when the polling endpoint returns multiple updates, including the same-leaf-cross-plugin case (`e2e/update-notifications.spec.ts`)

### Note on source-origin skills
Skills authored locally (no lockfile entry) are not tracked by `/api/skills/updates` — the polling endpoint enumerates lockfile entries via `getOutdatedJson()`. Self-publishing notifications for source-origin skills you author are tracked as a separate follow-up.

### Major version
This release transitions vskill to 1.0 to mark the public API as stable for the Studio update-notification contract and the `vskill skill` CLI surface introduced over the 0.5.x series.

## [0.5.116] - 2026-04-25

### Fixed
- **0736 (US-001)**: Studio update click now sends clean POST `/api/skills/:plugin/:skill/update` — eliminated the double-fire from old `onAction("update")` dispatch. UpdateAction.tsx shows inline progress + structured error UX; no more "Stream error" toast on update click.
- **0736 (US-002)**: `usePluginsPolling()` hook with AbortController + `visibilityState` pause + exponential backoff replaces the runaway `setInterval` that fired 7,500+ requests per session. Polls pause when tab is hidden and back off on errors (2s → 4s → 8s … 60s cap).
- **0736 (US-003)**: `resolveSubscriptionIds()` + StudioContext wire-up ensures SSE subscriptions use UUID/`sk_published_*` slug (from the platform's check-updates response) rather than raw `.claude/<skill>` paths. Platform's check-updates response now includes `id` + `slug` fields. UpdatesPanel re-renders correctly when subscription IDs are resolved.
- Code-review hardening: request-abortion on cleanup (F-001), removed stale TODO comments (F-005), pure component memoization (F-006), polling state reset on unmount (F-007), consistent error message propagation (F-010).

## [0.5.112] - 2026-04-25

### Fixed
- **fix(api)**: `/api/skills/updates` now handles exit-code-1 from `vskill outdated` correctly — when updates exist the CLI exits 1 but stdout still carries valid JSON; the catch block now reads `e.stdout` instead of swallowing the data. Also propagates `PATH` to `execSync` so the `vskill` binary is found in restricted shell environments (discovered during 0732 E2E).

## [0.5.111] - 2026-04-25

### Fixed
- **0732**: ID-format dual-accept for SSE skill-update notifications — the platform now augments every `skill.updated` event with both UUID (`skillId`) and public slug (`skillSlug`). Studio clients subscribed via slug-ID (the format returned by the discovery API) now receive update notifications correctly without UUID knowledge. The `greet-anton` skill (`anton-abyzov/vskill/greet-anton`) is verified against production SSE.

## [Unreleased]

### Fixed
- **0733**: Studio skill list now filters by the picker-selected agent on first load. Previously, a fresh session with empty localStorage rendered 108 skills (including buckets for `.aider/`, `.cursor/`, `.gemini/`, `.kiro/`, `.openclaw/`, `.pi/`, `.windsurf/`, etc.) even when the picker showed Claude Code, because (a) `App.tsx` hydrated the suggested-agent fallback into React state only — never persisting it or dispatching `studio:agent-changed`; (b) `StudioContext` had no fallback path of its own, so its first `/api/skills` request omitted `?agent=`; (c) the server filter at `api-routes.ts:1700` used the raw query param, so it no-op'd when `?agent=` was absent. Fix applies in all three places: server now passes the resolved active agent into the filter, App.tsx routes the suggested-fallback through `handleActiveAgentChange`, and StudioContext bootstraps from `/api/agents` when localStorage is empty before issuing its first skill fetch.

### Added
- `vskill skill` CLI subcommand family (new | import | list | info | publish) for creating and managing universal cross-tool skills
- Bundled `skill-builder` meta-skill with path A/B/C fallback chain (CLI → browser Studio → Anthropic skill-creator)
- `x-sw-schema-version: 1` on every emitted skill's frontmatter for future compatibility
- Per-skill `<name>-divergence.md` report listing frontmatter fields dropped or translated per target
