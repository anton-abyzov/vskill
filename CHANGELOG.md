# Changelog

## [Unreleased]

## [1.2.10] - 2026-10-19

### Fixed

- `vskill install --tenant <t> <skill> --version 1.0.0` reaches the install command instead of printing the CLI version.
- `vskill install owner/repo/skill@1.0.0` (or `--version 1.0.0`) installs the commit the registry scanned for that version and pins it. An unknown version exits 1 and lists the published ones. `vskill pin` prints an install command that works.
- The lock `tier` comes from the registry: `VERIFIED` only when the installed SKILL.md matches a published version, otherwise `UNSCANNED`, with the registry's latest version named.
- The verified-skill.com security check looks skills up by `owner/repo/skill`, so a CRITICAL finding now blocks the install.
- `vskill install <name> -y` installs only an exact skill-name match and otherwise lists the candidates and exits 1. A marketplace plugin whose `source` points at another repo is skipped instead of crashing.
- One `owner/repo/skill` install makes at most 5 GitHub REST calls. When the API is rate-limited, files are read from the repo's default branch (`HEAD`, not `main`) and messages name the rate limit instead of suggesting the repo is private.
- `vskill update` records the commit it read in `sourceCommitSha`. `vskill outdated` reports a GitHub-sourced skill whose SKILL.md changed upstream, as `update` does.
- `vskill doctor` accepts `<namespace>/<name>` frontmatter names written by plugin installs and compares only the skill part with the folder.
- `vskill submit` prints the full name for `vskill info`, reports a rejected submission as rejected (exit 1) instead of a duplicate, says a 404 repo was not found instead of private, and announces a changed skill as a resubmission. The install summary says "copied" when folders were copied.

## [1.2.9] - 2026-10-17

### Added

- Hosted private publishing. Skill Studio offers Private publishing with an authenticated publishing-account selector; accounts without the GitHub App get a Connect GitHub App action and submission stays disabled. Private status stays inside Studio.
- The CLI submits with explicit private intent and installs or updates frozen private versions scoped to the signed-in tenant. Downloads are checked for paths, hashes and file modes before anything is written.
- Direct private GitHub installation keeps working without a hosted plan.

### Fixed

- Codex, Claude Code and Cursor folder installs keep per-agent managed inventories across staggered updates and remove only obsolete managed files.
- Installs, updates and cleanup refuse to write or delete through symlinks or hardlinks that point outside the install directory.

## [1.2.8] - 2026-10-16

### Added

- `vskill update`, `vskill outdated` and `vskill list` take `--global` to work on user-level installs recorded in `~/.agents/vskill.lock`. Outside a project they use that lockfile by default and say so, so `vskill update` run from your home folder now updates skills installed with `--global`. Entries that only the older `~/vskill.lock` records are included too. User-level plugin entries (marketplace, `--plugin` and `--plugin-dir` installs) are skipped with the `vskill install ... --global` command that refreshes them. User-level entries with no files on disk (skills removed by hand, leftovers in `~/vskill.lock`) are skipped and named, never installed again.
- `vskill doctor` reports lockfile entries with nothing on disk (no skill folder and no plugin cache), for `~/.agents/vskill.lock`, the older `~/vskill.lock` and the project lockfile. It only reports them; `--fix` never edits a lockfile.
- A test fails the build when a SKILL.md under `skills/` or `plugins/` has a description over 1,024 characters, a missing or invalid `name`, or a `name` that differs from its folder.

### Changed

- `vskill doctor --fix` moves broken links into `_archive/<date>/` inside the same skills folder instead of deleting them.
- Shorter descriptions, under the 1,024-character limit, for `html-report` (1.1.3), `motion-graphics-promo` (1.1.1) and `social-media-posting` (1.0.4). Their triggers are unchanged: `html-report` still runs only when a result needs a report or the user asks for one.
- `greet-elena` and `appstore` declare their `name` in frontmatter.

### Fixed

- `vskill init` and source updates pick the newest SpecWeave plugin cache by semver and read the version from `plugin.json`, so 3.0.14 wins over 3.0.6 and a folder named `2.1.0` that holds 3.0.12 counts as 3.0.12.
- `vskill update` keeps a skill's old lockfile entry when writing the new files fails, instead of recording an update that never reached disk. In a project, files are written next to the lockfile that lists them.
- `vskill update` re-reads the lockfile before writing it back and replaces only the entries it updated, so skills another process installed or removed during the run are not undone.

## [1.2.7] - 2026-10-11

### Changed

- The security scanner finds hidden instructions: invisible Unicode tag characters, zero-width and variation-selector text, bidi overrides and base64-encoded payloads. Decoded payloads are rescanned at full severity, and text inside HTML comments is scanned instead of skipped. Unicode tag smuggling fails Tier 1, so `vskill add` and `vskill update` refuse it.
- Five new rules: Python shell execution, PowerShell, pickle or decoded `exec`, fake prerequisite downloads and password-protected archives. The scanner now has 57 rules, matching verified-skill.com.
- The Tier 2 judge reads skill text inside a per-scan fence and applies score caps the skill text cannot override.

### Fixed

- Two command-injection rules no longer slow down sharply on very long lines.

## [1.2.6] - 2026-10-11

1.2.5 was tagged but never reached npm (its README agent badge was stale), so 1.2.6 is the first published release with everything listed under 1.2.5.

### Added

- `vskill audit-webmcp <urls...>` audits the WebMCP tools a website registers, in headless Chromium, without running any tool: write actions missing `consequentialHint`, read-only claims on write tools, tool-poisoning text, third-party registrations and more, as a terminal table, JSON or JSONL for batches. Playwright stays optional.

### Changed

- Installing one skill from a GitHub repo (`vskill install <owner/repo> --skill <name>`) now copies the whole skill folder byte for byte: nested folders, binaries such as fonts and audio, and executable bits. Before, only SKILL.md and the top level of five folders arrived, so a skill could install with 2 of its 28 files. The lockfile lists every installed file, and a reinstall removes files the new version dropped.
- Every file in a skill bundle now goes through the same security scan as SKILL.md; a critical finding blocks the install unless you pass `--force`, and native executables are never installed without it.
- SKILL.md and the rest of the bundle always come from the same commit, which the lockfile records.
- Git LFS files install as the real file, checked against the LFS pointer's size and hash.
- When GitHub's API is rate limited or a skill is too large, vskill falls back to SKILL.md plus the standard folders and says why.

### Fixed

- Skill Studio: removing a skill from one agent keeps the shared copy other agents still read, and a new "Remove from all agents" action removes it everywhere.
- Skill Studio reinstalls keep scripts executable and binaries intact.
- `--dry-run` is honored on every install path, and the shared `.agents/skills` folder is used on every path.
- Antigravity installs in the legacy `.agent/skills` folder are found again; GitHub Copilot is no longer detected when only the VS Code extension folder exists.
- `vskill doctor --fix` is safe with chained links, links across global and project scope, and locked skills.
- A bundled `skill.md` or files whose names differ only in case can no longer overwrite the checked SKILL.md.
- Skill Studio's Overview publish row passes the right skill identity.

## [1.2.5] - 2026-10-11

### Added

- `vskill doctor [--global|--project] [--json] [--fix]` checks your skill folders: same-name copies that have diverged, broken or redundant links, leftovers from `migrate-to-codex`, skills whose name does not match their folder, descriptions that are too long, and two folders claiming the same skill name. `--fix` removes broken and redundant links and turns identical copies into links; it never touches copies whose content differs.
- Grok is a supported agent.

### Changed

- Agent skill folders follow each agent's current docs: Codex and Antigravity use the shared `.agents/skills` (Antigravity no longer uses the old `.agent/skills`), and GitHub Copilot and Copilot CLI use `.github/skills` for project skills.
- `vskill install` no longer adds a separate link for agents that already read the shared `.agents/skills` folder (OpenCode, Cursor, Copilot, Gemini, Grok and others), so a skill shows up once instead of two or three times. Claude Code links to the shared copy when nothing Claude-specific differs.

### Fixed

- `vskill install` keeps going when one agent's config file cannot be updated: the other agents still get the skill and the skipped one is named. It fails only when no agent could be installed.
- `vskill install --dry-run` lists what it would install and writes nothing.
- CI: the Lighthouse check audits the live verified-skill.com pages again (it had failed with INVALID_URL).

## [1.2.4] - 2026-10-11

### Changed

- Dependencies: `@anthropic-ai/sdk` 0.131 and `simple-git` 3.36; dev toolchain on esbuild 0.28.2, Tailwind 4.3 and Playwright 1.63.
- Skill Studio desktop: Tauri crates now match the `@tauri-apps/*` packages (tauri 2.12, updater 2.13, dialog 2.8, notification 2.5, shell 2.4, autostart 2.7).
- CI: the nightly macOS notarize dry-run builds, notarizes and staples like the real release, with the Rust targets it needs installed and tauri-action pinned to its major version.
- Docs: Capgo is listed alongside Appflow for Capacitor over-the-air updates.

## [1.2.3] - 2026-10-10

### Fixed

- Skill Studio publish keeps skills from private or unconfirmed repos local: it refuses to submit them to verified-skill.com and never prefills an unconfirmed repo URL.
- The Studio privacy chooser and paywall follow the private-skills launch gate (waitlist) instead of promising a Pro upgrade.
- The Studio repo widget shows a "Private" badge on private repos for every plan, with no "Pro" chip: connecting a private repo is free.

## [1.2.1] - 2026-10-03

### Security

- Nothing about a skill from a private GitHub repo reaches verified-skill.com, from any command or from Skill Studio: no name, repo, path, version or hash. Only the anonymous blocklist download remains.
- No GitHub token is sent to verified-skill.com. The CLI and Skill Studio send only the verified-skill `vsk_*` token; the Studio sign-in now mints one, so sign in again in Studio if account pages show you as signed out.
- `vskill auth login` no longer exchanges a token that GitHub granted the `repo` scope (GitHub keeps scopes from an earlier `--repos` login).
- Skills inside private plugins (lockfile entries keyed by the plugin name) are treated as private everywhere, including `info`, `versions`, `diff` and Studio.
- A repo whose visibility GitHub cannot confirm is treated as private, as is a `--plugin-dir` that is not its own checkout of a public GitHub repo, a lockfile source vskill cannot parse, and a Studio skill installed without a lockfile entry.
- `vskill submit` refuses private repos, and Skill Studio no longer looks up private identifiers, authored skills in private checkouts or private plugin skills on verified-skill.com.

### Fixed

- Public skills keep getting update checks when your GitHub token is expired or revoked: GitHub requests retry without the token, with a one-time warning to run `vskill auth login`.
- When GitHub rate-limits or is unreachable, a repo confirmed public in the last 30 days still counts as public (remembered in `~/.vskill/repo-visibility.json`, public repos only). Otherwise `outdated` and `update` name the skipped repos and how to fix it instead of skipping them silently.

## [1.2.0] - 2026-10-03

### Added

- Private GitHub skills repos: `install`, `update` and plugin discovery read private repos through the GitHub Contents API with your token, including a skill's `references/`, `scripts/` and other bundled folders. Walkthrough in `docs/private-skills-repo.md`.
- `vskill auth login --repos` requests the `repo` scope; the default `read:user` token cannot read private repos.
- Token sources, in order: `VSKILL_GITHUB_TOKEN`, the `vskill auth login` keychain token, `GITHUB_TOKEN` / `GH_TOKEN`, then `gh auth token`. Set `VSKILL_NO_GH_CLI=1` to skip `gh`.

### Changed

- Skills installed from a private repo are marked `sourcePrivate` in `vskill.lock`. vskill sends nothing about them to verified-skill.com (no install telemetry, registry lookups, name-based security checks or auto-submission), and `update` never replaces them with a same-named registry skill.
- "Not found" errors explain when a private repo is the likely cause.
- A stale token no longer breaks public installs: raw reads retry anonymously after a 401.

### Fixed

- `vskill update` found no skills for a marketplace plugin whose `source` is `./`.
- `vskill auth status --json` and other `auth` flags were rejected as extra arguments.
- A repo without a `plugins/` folder no longer prints "Plugin list may be incomplete".

## [1.1.1] - 2026-09-14

### Fixed

- Keep project and global plugin ownership separate during cleanup. Preserve unrelated globally installed plugins and externally managed caches.
- Honor `remove --local` and `remove --global`, including nested project directories, mixed plugin/skill names, and legacy global lockfiles.

### Release

- Add a tag-driven npm release job that checks the full test suite, builds both CLI and Studio assets, and validates the publish tarball.

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
