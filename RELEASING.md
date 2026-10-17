# Releasing vskill

This repo ships two products from `main`, each from its own tag:

| | npm CLI `vskill` | Skill Studio desktop app |
|---|---|---|
| Command | `bash scripts/release/release-npm.sh [<version>] [--dry-run]` | `bash scripts/release/release-desktop.sh [<version>] [--dry-run] [--rotate-secrets] [--force]` |
| Tag | `v<X.Y.Z>` | `desktop-v<X.Y.Z>` |
| Workflow | `npm-release.yml` | `desktop-release.yml` |
| Version comes from | `package.json` on main (merge a bump PR first) | the tag; CI stamps `Cargo.toml`, `tauri.conf.json` and `Cargo.lock`, so there is no bump PR |
| Live result | `https://registry.npmjs.org/vskill/<X.Y.Z>` | `https://verified-skill.com/desktop/latest.json` |

Both scripts tag the commit at the head of `main` on GitHub, never your local
checkout, and push the tag over HTTPS. Both run on macOS `/bin/bash` 3.2.

## npm: `release-npm.sh`

1. Merge the PR that bumps `package.json` (and `package-lock.json`) to the new version.
2. Run `bash scripts/release/release-npm.sh` (the version defaults to this
   checkout's `package.json`).

It checks, before tagging:
- `gh` is signed in and has push access.
- `v<version>` is not a tag, locally or on GitHub.
- `vskill@<version>` is not on npm.
- `package.json` on `origin/main` is at `<version>`.
- A `git push --dry-run` of the tag authenticates.
- CI on that commit has not failed.

It then tags `origin/main` and pushes the tag. Next it follows the `npm Release`
run with `gh run watch --exit-status`. It polls
`https://registry.npmjs.org/vskill/<version>` until that returns 200. Finally,
from an empty directory, it requires `npx -y --prefer-online vskill@<version>
--version` to print the version.

## Desktop: `release-desktop.sh`

Run `bash scripts/release/release-desktop.sh`. The version defaults to the
patch after the newest `desktop-v*` tag on GitHub. A version that already
exists, or is not newer, is refused; rollbacks go through Desktop Rollback
(below).

Preflight. These checks have no side effects:
- `git`, `gh`, `curl`, `python3` and `rsign` are present, and `gh` is signed in.
- The key files exist.
- The tag does not exist yet.
- A `git push --dry-run` of the tag authenticates.
- `minisign.key` signs a test file through a pty with `minisign.passphrase`, and `minisign.pub` verifies the result.
- `plugins.updater.pubkey` in `tauri.conf.json`, at the commit being tagged, equals `base64(minisign.pub)`.
- Every secret the workflow reads exists. Only names are checked.
- The newest completed main runs of `notarize-dryrun.yml` (Desktop Build (nightly)) and `sidecar-smoke.yml` succeeded. Push runs of the nightly skip macOS, so its newest scheduled or manual run must also be green. If one is red, the script refuses unless you pass `--force`.

The release steps that follow:
1. It runs `gh secret set` for the updater key and passphrase only with `--rotate-secrets`.
2. It tags main's head as `desktop-v<version>` and pushes the tag.
3. It finds the Desktop Release run for the tag and watches it with `--exit-status`.
4. It requires the GitHub release to carry:
   - `.dmg`, `.app.tar.gz` and `.app.tar.gz.sig`
   - `.msi` and `x64-setup.exe.sig`
   - `.deb` and `.rpm`
   - `.AppImage` and `.AppImage.sig`
5. It requires `latest.json` to serve the new version from R2 (`x-manifest-source: r2`) with all three platforms.
6. It downloads the `darwin-aarch64` bundle that `latest.json` points at and verifies the manifest's signature with `rsign verify` against `minisign.pub`.
7. It promotes the release if it is still a draft, and deletes stale `desktop-v*` draft releases. Their git tags are kept.

Key material on the release Mac (never committed):

```
~/.config/skill-studio-release/minisign.key         # rsign key, encrypted, mode 0600
~/.config/skill-studio-release/minisign.passphrase  # mode 0600
~/.config/skill-studio-release/minisign.pub
~/.cargo/bin/rsign                                  # cargo install rsign2
```

The GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` hold base64 of `minisign.key` and the
passphrase. `tauri.conf.json` holds base64 of the whole `minisign.pub` file,
not the raw key line.

## Both at once

The desktop build does not consume the npm package. It builds its sidecar from
the same commit's source. So the two tags can go out together on the same
`main` commit. The simplest way is to run both scripts at the same time in two
terminals; each one verifies its own release. By hand:

```bash
V=1.2.9; D=1.0.66
git fetch https://github.com/anton-abyzov/vskill.git main
git tag "v$V" FETCH_HEAD && git tag "desktop-v$D" FETCH_HEAD
git push https://github.com/anton-abyzov/vskill.git "v$V" "desktop-v$D"
```

A hand-pushed tag skips the scripts' checks, so run both `--dry-run`s first.

## Dry runs

- `release-desktop.sh --dry-run` runs the whole preflight and prints the plan.
  It also reads the live `latest.json` and verifies the live macOS bundle's
  signature. Nothing is tagged, pushed or changed.
- `release-npm.sh --dry-run` runs every check and prints the tag it would push.
- Dispatching `desktop-release.yml` with `dry_run` (the default), for example
  `gh workflow run desktop-release.yml --ref <branch>`, builds all four legs
  for real. The legs are macOS, Windows, Linux deb/AppImage and Linux rpm, and
  the build includes updater signing and the notarized DMG. It never publishes.
  `dry_run=false` is accepted only on a `desktop-v*` tag ref.
- A same-repo pull request that touches `desktop-release.yml` or
  `scripts/release/**` runs the same build-only path. Pull requests from forks
  and from Dependabot are skipped, because they get no secrets.

## Guards in desktop-release.yml

- **The tag must be on main.** The build job fails when the tagged commit is
  not an ancestor of `origin/main`. Main's `Cargo.toml` and `tauri.conf.json`
  keep the previous version until a normal PR bumps them; only dev builds
  show that number.
- **Notarization.** tauri-action signs and notarizes the `.app`. The DMG is
  then submitted, stapled and verified by `scripts/release/notarize-macos.sh`
  with the same Apple ID credential. The gating step requires all of these on
  both the `.app` and the `.dmg`:
  - `codesign --verify --strict`
  - `stapler validate`
  - `spctl` reporting `source=Notarized Developer ID`
- **Updater key probe.** Each leg signs a test file with the updater key
  before the long build, so a bad key or passphrase fails within minutes.
- **No downgrades.** `publish-manifest.sh` refuses to replace a live
  `latest.json` that serves a newer version. For a local run, `FORCE_ROLLBACK=1`
  overrides it. Intentional rollbacks:
  `gh workflow run desktop-rollback.yml -f target_version=1.0.64 -f reason="..."`.
- **One publisher at a time.** The publish job has its own concurrency group,
  so two tag runs never write R2 or `latest.json` at once.
- **Atomic publish.** Binaries upload first, in parallel. `latest.json` is
  copied last. A failed upload leaves the live manifest on the previous version.

## When a release fails

- **The build failed before publish.** Nothing is live. A flaky failure:
  `gh run rerun <run-id> --failed`. A real bug: fix it on main and release the
  next patch version; tags are never reused.
- **Publish failed.** If `publish-manifest.sh` failed, `latest.json` was not
  touched. If the GitHub release step failed after it, the update is already
  live and only the mirror is missing. Either way, re-run the failed jobs:
  uploads are keyed per version, so a re-run overwrites them, and the
  downgrade guard allows re-publishing the same version.
- The GitHub release mirrors the macOS updater bundle as
  `Skill.Studio.app.tar.gz` (GitHub turns spaces into dots). The updater
  itself downloads from the R2 URL in `latest.json`.

## Caches, timing and health

- **Rust caches.** `notarize-dryrun.yml` (Desktop Build (nightly)) builds all
  three platforms from main every night, and on pushes to main that touch
  `src-tauri/**`. It is the only writer of the Rust caches that tag builds
  read (`shared-key: desktop-<target>`). Keep the toolchain pin (1.99.1) and
  the action SHAs identical in both workflows, or the cache keys stop matching.
- **Timing report.** The Release timing report job compares job and step
  durations against the last five successful runs and fixed budgets. It also
  flags cache misses. It only warns, and even a failure of the report itself
  is a warning, so it never turns a published release red. To run it locally:
  `node scripts/release/timing-report.mjs --repo anton-abyzov/vskill --run <run-id> --workflow desktop-release.yml`.
- **Nightly health.** `nightly-health.yml` keeps one open issue,
  `<workflow> red on main` (label `nightly-red`), per failing nightly, and
  closes it when the workflow passes again. A passing run that skipped jobs
  (a push run of the desktop nightly skips macOS) does not close it.
