# macOS Release Pipeline — vSkill Desktop

This README documents the macOS portion of vSkill Desktop's release pipeline:
config, signing, notarization, Homebrew Cask, and the troubleshooting paths
for the issues most likely to bite a release.

> Source plan: `.specweave/increments/0829-vskill-distribution-and-marketing/plan.md` §4.
> Owner sub-agent: `desktop-release-mac-agent` (this directory).

---

## Pre-Phase-1 status (snapshot)

| Item | Status | Notes |
|---|---|---|
| ASC profile `vskill` (keychain) | OK | Issuer `a9be87c1-47d8-40f2-897d-75df80a540fb`, key `JZ2ML9M66A`, default. |
| Bundle ID `com.verifiedskill.desktop` | **NOT YET CREATED** | `asc bundle-ids create` was attempted but blocked at the harness layer (high-severity org-account side effect; needs direct Anton approval). |
| Developer ID Application certificate | **NOT YET CREATED** | Keychain currently holds only `Apple Development: Anton Abyzov (W39WQZNW64)`. The ASC API key may also need Admin role on the EasyChamp team to create the cert non-interactively. |
| Tauri updater minisign keypair (`tauri signer generate`) | Not done by this agent (owner: `ci-pipeline-agent`) | `tauri.conf.json.plugins.updater.pubkey` is set to a placeholder. |
| Cloudflare R2 bucket `vskill-desktop` | Not done by this agent (owner: `ci-pipeline-agent`) | Required before the release workflow can publish manifests. |

When the cert + bundle ID exist, update:

1. `tauri.conf.json` → `bundle.macOS.signingIdentity` if the team-id portion of the identity differs. The current value `Developer ID Application: EasyChamp, Inc. (NMCB2JZ7QG)` uses the EasyChamp team's ASC seedId; if the cert is issued under a different team, update accordingly.
2. `tauri.conf.json` → `plugins.updater.pubkey` (replace `<MINISIGN_PUBKEY_PLACEHOLDER>`). `ci-pipeline-agent` owns minisign keypair generation via `scripts/release/generate-minisign-key.sh`.

---

## Manual fallback — Pre-Phase-1 cert + bundle ID

If `asc certificates create --type DEVELOPER_ID_APPLICATION` doesn't go through automatically (Admin-role required, or interactive CSR prompt), Anton can do this manually:

### A. Create the bundle ID manually

```bash
# After review/approval of the side effect:
asc bundle-ids create \
  --identifier com.verifiedskill.desktop \
  --name "vSkill Desktop" \
  --platform MAC_OS \
  --output json --pretty
```

Or via developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → `+` → App IDs → App → Continue. Bundle ID: `com.verifiedskill.desktop`. Description: "vSkill Desktop". App services: none (Developer ID distribution does not require any).

### B. Create the Developer ID Application cert manually

ASC's API allows creating a cert via `asc certificates create --type DEVELOPER_ID_APPLICATION`. If that flow rejects with permission errors, use the GUI path:

1. **Generate a CSR (Certificate Signing Request)**:
   - **Keychain Access** → menu **Certificate Assistant** → **Request a Certificate from a Certificate Authority…**
   - User Email: `anton.abyzov@gmail.com`
   - Common Name: `Anton Abyzov` (or `EasyChamp, Inc.`)
   - Request is: **Saved to disk** → save as `~/.certs/vskill-developer-id.csr`.
2. **Submit CSR to Apple**:
   - developer.apple.com → Certificates, Identifiers & Profiles → Certificates → `+`
   - Select **Developer ID Application** → Continue.
   - Upload the `.csr` from step 1 → Continue → Download the `.cer`.
3. **Install the cert**:
   - Double-click the downloaded `.cer` → Keychain Access opens → confirm install in `login` keychain.
   - Verify with: `security find-identity -v -p codesigning | grep "Developer ID Application"`.
   - The expected identity name is something like `Developer ID Application: EasyChamp, Inc. (TEAMID)`.
4. **Export to .p12 for CI**:
   - In Keychain Access, right-click the new identity → **Export…** → format `.p12` → set a password.
   - `base64 -i ~/.certs/vskill-developer-id.p12 | pbcopy` → paste into GH Actions secret `APPLE_CERTIFICATE`.
   - Set `APPLE_CERTIFICATE_PASSWORD` to the password chosen above.

After install, also update `tauri.conf.json.bundle.macOS.signingIdentity` to the exact string returned by `security find-identity -v -p codesigning` (look for the line starting with the SHA1 hash and quoted identity name).

---

## Build commands

### Local universal2 build (no notarize)

```bash
scripts/release/macos-build.sh
```

What it does:
1. Adds `aarch64-apple-darwin` and `x86_64-apple-darwin` rust targets if missing.
2. Runs `cargo tauri build --target universal-apple-darwin`.
3. Reports the produced `.app` and `.dmg` paths.
4. Runs `lipo -info` against the binary inside the `.app` (sanity-check that both archs are present).

### Local smoke (build + dry-run notarize)

```bash
scripts/release/macos-build.sh --smoke
```

Runs the build, then invokes `notarize-macos.sh --dry-run` against the produced `.dmg`. The dry-run prints the exact `notarytool` command without sending anything to Apple. Used to exercise script wiring without consuming Apple's notary quota.

### Release build (build + REAL notarize + staple)

```bash
scripts/release/macos-build.sh --notarize
```

Real notary submission. Takes 5–30 min depending on Apple's queue. Writes to `~/.cache/asc-notary/<timestamp>.log`. On success, the `.dmg` is stapled and `spctl -a -vv` accepts it. **Reserve for tagged release builds**; per-PR or per-commit notary calls hit the per-team quota fast.

### Notarize an already-built .dmg

```bash
scripts/release/notarize-macos.sh path/to/vSkill_X.Y.Z_universal.dmg
```

Or with `--dry-run` to print the commands without submitting.

### Update the Homebrew Cask file

```bash
scripts/release/update-brew-cask.sh \
  --version 1.0.16 \
  --url https://verified-skill.com/desktop/v1.0.16/vSkill_1.0.16_universal.dmg \
  --sha256 $(shasum -a 256 vSkill_1.0.16_universal.dmg | awk '{print $1}') \
  --tap-dir ~/repos/homebrew-tap-staging \
  --target staging
```

For mainline Homebrew submission (post-promotion criteria — see plan §4.6):

```bash
brew bump-cask-pr --version 1.0.16 vskill
```

---

## Entitlement rationale

`src-tauri/Entitlements.plist` enables four `cs.*` exceptions plus two scoped permissions. Architect-approved set per ADR 0828-01 + plan §4.2. Each entitlement and the rationale for not enabling app-sandbox is inlined as XML comments inside the plist.

Key justification for `disable-library-validation`: the Node sidecar (`@napi-rs/keyring`, `sharp`, plus Node's own internal dlopens) loads `.dylib`s signed by the Node project, not by EasyChamp. Without this entitlement the Node binary refuses to start. This is the same posture every Tauri Node-sidecar app uses; documented in [Tauri's Node sidecar guide](https://v2.tauri.app/learn/sidecar-nodejs/).

---

## Verification gates (run on every release)

```bash
# 1. Code-signing valid + signed by our identity
codesign --verify --deep --strict --verbose=4 \
  src-tauri/target/universal-apple-darwin/release/bundle/macos/vSkill.app

# 2. Hardened runtime + entitlements present
codesign -d --entitlements :- \
  src-tauri/target/universal-apple-darwin/release/bundle/macos/vSkill.app
codesign -d -v --verbose=4 \
  src-tauri/target/universal-apple-darwin/release/bundle/macos/vSkill.app | grep "flags=0x10000(runtime)"

# 3. Both archs in the binary
lipo -info src-tauri/target/universal-apple-darwin/release/bundle/macos/vSkill.app/Contents/MacOS/vSkill

# 4. Notarized + stapled — Gatekeeper accepts
spctl -a -t exec -vv \
  src-tauri/target/universal-apple-darwin/release/bundle/macos/vSkill.app
# expect: "accepted, source=Notarized Developer ID"
```

Any of these failing → release blocked.

---

## Troubleshooting

### Notarization stalled (>30 min, no response)

Apple's notary service has periodic queue stalls (Feb 2026 was one). The `desktop-release-mac` GH Actions job has a 3-attempt × 10-min-backoff retry per plan §4.3; if all three fail, it stops and pages.

Manual recovery from a developer machine:

```bash
# Find the latest submission for the keychain profile
xcrun notarytool history --keychain-profile vskill --output-format json | head -40

# Inspect a specific submission's log
xcrun notarytool log <submission-uuid> --keychain-profile vskill
```

If Apple's status page (https://developer.apple.com/system-status/) confirms a notary outage, hold the release. Re-run the workflow after the outage clears.

### Hardened-runtime crash on first launch

Symptom: app dock-bounces and dies immediately. `Console.app` shows a code-signing error like `EXC_BAD_ACCESS (SIGKILL)` with `subsystem com.apple.codesigning`.

Diagnosis order:
1. `codesign -d --entitlements :- vSkill.app` — confirm all four `cs.*` entitlements are present and `true`.
2. Try removing `disable-library-validation` from `Entitlements.plist`, rebuild, observe — if it still crashes, the issue is unrelated to library validation.
3. Use `Console.app` → search for `vSkill` and `vskill-server` to find the dlopen that failed — the failing module name is the next thing to add to either `disable-library-validation` (correct) or the bundle's signed-modules list.
4. Run inside Instruments' "Code Signing" template to capture which path is blocked.

Last-resort fallback: temporarily set `bundle.macOS.hardenedRuntime: false` in `tauri.conf.json` to confirm the runtime is the cause, then revert and fix entitlements properly. NEVER ship with hardenedRuntime off — Apple notarization rejects it.

### Smoke build fails: "no identity found"

Expected before Pre-Phase-1 cert is created. Workarounds for local dev:
- Set `bundle.macOS.signingIdentity: null` and `bundle.macOS.hardenedRuntime: false` in `tauri.conf.json` for an unsigned build (won't pass Gatekeeper but exercises the bundle path).
- Or prepend `CARGO_BUILD_FLAGS="--target universal-apple-darwin --bundles app"` to skip dmg + signing entirely.

DO NOT commit a `signingIdentity: null` config. Always restore the real identity before pushing.

### Cert rotation runbook

Developer ID Application certs expire after 5 years. To rotate:

1. ~30 days before expiry, create a new cert via the manual flow above.
2. **Both old and new certs remain valid** simultaneously — Apple does not revoke the old one when you create a new one. Existing notarized binaries continue to pass Gatekeeper.
3. Update `bundle.macOS.signingIdentity` to the new identity name. Bump base64 secret `APPLE_CERTIFICATE` in GH Actions.
4. Cut a new release (any version). The old cert is now retired for new builds; old shipped binaries unaffected.
5. After 30 days of new-cert builds in the wild, revoke the old cert via developer.apple.com → Certificates → old cert → Revoke. (Revocation does NOT invalidate already-notarized binaries — Apple's notary ticket is independent of cert revocation status.)

---

## File ownership (this agent)

Files I write/own (other agents must not modify):
- `src-tauri/Entitlements.plist`
- `scripts/release/notarize-macos.sh`
- `scripts/release/macos-build.sh`
- `scripts/release/update-brew-cask.sh`
- `scripts/release/macos-README.md` (this file)

Files I share-write (coordinate via SendMessage before changing):
- `src-tauri/tauri.conf.json` — I own `bundle.macOS` and `plugins.updater`. Windows agent owns `bundle.windows`. Linux agent owns `bundle.linux`. CI agent owns `plugins.updater.pubkey` (final value).
