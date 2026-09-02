# Security Policy

## Reporting a Vulnerability

Do not open public GitHub issues for security problems. Email
anton.abyzov@gmail.com; you will get a response within 48 hours.

## Supply-Chain Guard (since 2026-09)

In July 2026 a dependency-install-script payload reached the sibling
`specweave` repository through a CI agent that ran `npm ci` with scripts
enabled and then `git add -A && git push`. This repository enforces the same
guard as its siblings:

- **No install scripts.** The committed `.npmrc` sets `ignore-scripts=true`
  for every install inside this repo, and CI always runs `npm ci --ignore-scripts`.
  Packages that need a build step are rebuilt explicitly with `npm run setup`
  (`npm rebuild --ignore-scripts=false esbuild`), and setup then *verifies* the
  rebuild actually took (`scripts/desktop/verify-esbuild.mjs` runs the native
  binary) — `npm rebuild` exits 0 when it matches nothing. Every rebuild target
  is a declared, exactly-pinned dependency in `package.json`; relying on a
  hoisted transitive copy would make the rebuild a silent no-op. The published
  npm package does not carry `.npmrc`, so end-user installs are unaffected.
- **Publishing forces the package's own hooks back on.** `ignore-scripts` is not
  scoped to dependencies: it also suppresses *this* package's lifecycle hooks, so
  a bare `npm publish` skips `prepublishOnly` — no build, no eval-ui bundle, no
  badge sync. `dist/` is gitignored, so on a clean checkout that ships a tarball
  with **zero** `dist/` entries while `bin.vskill` points at `./dist/bin.js`; npm
  uploads it with exit 0 and no warning. **Release with `npm run release`**
  (`npm publish --ignore-scripts=false`), never bare `npm publish`.
  `prepublishOnly` ends in `scripts/release/preflight-publish.mjs`, which
  inspects the tarball npm would actually upload — not the working tree — and
  refuses if an entrypoint or `dist/eval-ui/**` is missing or if `dist/` is older
  than `src/`. The `publish-guard` job in `ci.yml` proves both directions on
  every PR (the preflight must *fail* on an unbuilt tree and *pass* after the
  build), and `scripts/__tests__/publish-path-guard.test.ts` fails if the wiring
  is ever unpicked.
- **Payload scan on every PR and push.** `.github/workflows/supply-chain-scan.yml`
  runs `scripts/security/scan-payload.mjs` (zero dependencies) and fails on:
  whitespace-padded payload lines (`^[\s});]{0,6}\s{800,}\S` — the July-2026
  signature, never allowlistable), lines over 5000 chars, base64 blobs over
  2000 chars, `eval` / `Function` wrapped around an `atob` or `Buffer.from`
  decode, and `createRequire(import.meta.url)` shims inserted into `*.test.*`
  files. Legitimate exceptions live in `scripts/security/scan-allowlist.txt`.
  It also runs `npm audit signatures` (registry signatures + provenance attestations).
- **Run it locally:** `npm run security:scan` (self-test + full tree scan).
- **Policy:** CI agents never run install scripts and never `git add -A`.
  No auto-fix agents and no auto-merge for bot PRs; a person merges after the
  supply-chain scan passes. Dependabot uses a 7-day cooldown.

## Skill Studio and private repositories

Threat model, verification checklist, SOC 2 evidence map and rotation runbooks
for private-repo support (increment 0826) live in the umbrella repo under
`.specweave/docs/` (see README, "Security & Compliance").
