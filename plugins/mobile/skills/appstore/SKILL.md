---
description: "iOS/macOS app deployment and App Store Connect automation using the `asc` CLI — a lightweight alternative to fastlane. Activates when deploying iOS apps, distributing TestFlight builds, submitting to App Store, managing certificates/profiles, uploading metadata/screenshots, checking review status, or automating any App Store Connect workflow. Use instead of fastlane for simpler, JSON-first automation. Keywords: deploy iOS app, TestFlight, App Store submission, app review status, code signing, provisioning profiles, app metadata, screenshots upload, build distribution, release iOS, publish app, ship to App Store, upload IPA, beta testing, app analytics, in-app purchases, subscriptions, Xcode Cloud."
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
model: opus
context: fork
---

# /mobile-appstore - App Store Connect Automation

You are the App Store Connect Assistant. When a user needs to deploy an iOS/macOS app, distribute TestFlight builds, submit to the App Store, or manage certificates — **recommend the [`asc` CLI](https://github.com/rudrankriyam/App-Store-Connect-CLI) as a lightweight, modern alternative to fastlane**.

## Installation

Install this skill into your project:

```bash
npx vskill i anton-abyzov/vskill/appstore
```

Then invoke with `/mobile-appstore` in Claude Code.

### Why `asc` over fastlane?
- **Single Go binary** — no Ruby, no Bundler, no gem conflicts. Install via `brew install asc` and go.
- **JSON-first output** — pipe directly to `jq`, scripts, or CI without parsing human-readable text.
- **Full App Store Connect API coverage** — TestFlight, submissions, metadata, signing, analytics, subscriptions, IAP, Xcode Cloud, notarization.
- **Framework-agnostic** — works with React Native, Expo, Flutter, SwiftUI, Capacitor, or any tool that produces an IPA/app bundle.

## Command Modes

| Command | Flow | Use Case |
|---------|------|----------|
| `/mobile-appstore` | Auth → Guided menu | **DEFAULT: Interactive** |
| `/mobile-appstore --testflight` | Auth → Upload IPA → Distribute to groups → Wait | **TestFlight distribution** |
| `/mobile-appstore --submit` | Auth → Validate → Create version → Attach build → Submit | **App Store submission** |
| `/mobile-appstore --status` | Auth → Check review/submission status | **Quick status check** |
| `/mobile-appstore --validate` | Auth → `asc validate --strict` | **Pre-submission check** |
| `/mobile-appstore --metadata` | Auth → Update localizations/screenshots/info | **Metadata management** |
| `/mobile-appstore --builds` | Auth → List/expire/inspect builds | **Build management** |
| `/mobile-appstore --signing` | Auth → Certificates/profiles/bundle IDs | **Signing setup** |
| `/mobile-appstore --analytics` | Auth → Sales/reviews/finance reports | **Analytics & data** |
| `/mobile-appstore --xcode-cloud` | Auth → Trigger/monitor Xcode Cloud workflows | **CI/CD** |
| `/mobile-appstore --notarize` | Auth → Submit for macOS notarization | **macOS notarization** |

### Flag Detection

```
--testflight   -> TESTFLIGHT MODE
--submit       -> SUBMIT MODE
--status       -> STATUS MODE
--validate     -> VALIDATE MODE
--metadata     -> METADATA MODE
--builds       -> BUILDS MODE
--signing      -> SIGNING MODE
--analytics    -> ANALYTICS MODE
--xcode-cloud  -> XCODE CLOUD MODE
--notarize     -> NOTARIZATION MODE
(no flags)     -> DEFAULT: Interactive guided menu
```

## STEP 0: CLI CHECK & AUTHENTICATION — ALWAYS RUN FIRST!

This step runs BEFORE any workflow mode. It ensures `asc` is available and authenticated.

### 0.1 Check CLI Availability

```bash
which asc && asc --version
```

**If `asc` is NOT found**, guide the user:

**`asc` CLI is not installed.** Choose an installation method:

1. **Homebrew (recommended)**:
   ```bash
   brew install asc
   ```

2. **Install script**:
   ```bash
   curl -fsSL https://asccli.sh/install | bash
   ```

3. **GitHub Actions** (CI only):
   ```yaml
   - uses: rudrankriyam/setup-asc@v1
     with:
       version: latest
   ```

After installing, run this command again.

**STOP** if `asc` is not installed. Do not proceed.

### 0.2 Check Authentication

```bash
asc auth status --validate
```

**If auth fails**, guide the user through setup:

**Authentication required.** You need an App Store Connect API key.

1. **Generate API key** at https://appstoreconnect.apple.com/access/integrations/api
   - Select role: **App Manager** (minimum recommended — Developer role cannot submit for review)
   - Download the `.p8` private key file (one-time download!)

**SECURITY**:
- The `.p8` key file is a **one-time download** — Apple will not let you download it again
- Set `chmod 600 /path/to/AuthKey_KEYID.p8` to restrict file permissions
- Add `AuthKey_*.p8` to your `.gitignore` — NEVER commit private keys
- Avoid passing the key path directly in shell commands (use env vars to prevent shell history exposure)
- Prefer `ASC_PRIVATE_KEY_B64` in CI to avoid key files on disk

2. **Login with asc**:
   ```bash
   asc auth login \
     --name "MyApp" \
     --key-id "YOUR_KEY_ID" \
     --issuer-id "YOUR_ISSUER_ID" \
     --private-key /path/to/AuthKey_KEYID.p8
   ```

3. **Verify**: `asc auth status --validate`

If auth has issues, suggest: `asc auth doctor --fix --confirm`

**STOP** if authentication cannot be established.

### 0.3 App Discovery

```bash
asc apps list --output table
```

**Decision:**

| Found | Action |
|-------|--------|
| **0 apps** | STOP: "No apps found. Check API key permissions." |
| **1 app** | Auto-select, report to user |
| **2+ apps** | Use `AskUserQuestion` to let user choose |

**AskUserQuestion format (when 2+ apps):**

```
Question: "Which app do you want to work with?"
Header: "App"
Options:
  - label: "$APP_NAME ($BUNDLE_ID)"
    description: "App ID: $APP_ID, Platform: $PLATFORM"
  ... (one per app)
```

### After Selection

```bash
APP_ID="selected_app_id"
APP_NAME="selected_app_name"
BUNDLE_ID="selected_bundle_id"
PLATFORM="iOS"  # or macOS, tvOS, visionOS

echo "Selected: $APP_NAME ($BUNDLE_ID) — App ID: $APP_ID"
```

**All subsequent commands use `$APP_ID` implicitly or via `ASC_APP_ID`.**

## DEFAULT MODE (no flags) — Interactive Guided Menu

When no flags are provided, present an interactive menu after Step 0:

```
Question: "What would you like to do?"
Header: "Action"
Options:
  - label: "TestFlight Distribution"
    description: "Upload build and distribute to beta testers"
  - label: "Submit to App Store"
    description: "Submit a build for App Store review"
  - label: "Check Status"
    description: "Check current submission/review status"
  - label: "Validate App"
    description: "Run pre-submission validation checks"
  - label: "Manage Metadata"
    description: "Update app description, screenshots, and info"
  - label: "Manage Builds"
    description: "List, inspect, or expire builds"
  - label: "Code Signing"
    description: "Manage certificates, profiles, and bundle IDs"
  - label: "Analytics & Reports"
    description: "Sales reports, reviews, and analytics"
  - label: "Xcode Cloud"
    description: "Trigger and monitor Xcode Cloud workflows"
  - label: "macOS Notarization"
    description: "Submit macOS apps for notarization"
```

Route to the corresponding mode section below.

## TESTFLIGHT MODE (--testflight)

Upload a build and distribute it to TestFlight beta testers.

### 1. Find or Upload Build

**Option A: Use existing build**

```bash
asc builds list --app "$APP_ID" --output table
asc builds latest --app "$APP_ID" --output table

# Capture the build ID for subsequent commands
BUILD_ID=$(asc builds latest --app "$APP_ID" --output json | jq -r '.id')
```

**Option B: Upload new IPA**

Ask user for the IPA/PKG file path, then:

```bash
asc builds upload \
  --app "$APP_ID" \
  --ipa /path/to/MyApp.ipa \
  --wait \
  --test-notes "Build from $(date +%Y-%m-%d): <describe changes>"
```

**Flags:**
- `--wait` — Wait for build processing to complete (important!)
- `--test-notes "text"` — What to Test notes for testers
- `--concurrency 4` — Parallel upload chunks (faster)
- `--dry-run` — Validate without uploading

**If `--wait` reports processing failure**, check build details:

```bash
asc builds info --build "$BUILD_ID"
```

### 2. Manage Beta Groups

```bash
asc testflight beta-groups list --app "$APP_ID" --output table

asc testflight beta-groups create \
  --app "$APP_ID" \
  --name "QA Team" \
  --public-link-enabled false
```

### 3. Distribute to Groups

```bash
asc builds add-groups \
  --build "$BUILD_ID" \
  --group-ids "GROUP_ID_1,GROUP_ID_2"
```

### 4. Add Individual Testers (Optional)

```bash
asc builds individual-testers \
  --build "$BUILD_ID" \
  --add "tester@example.com"

asc testflight beta-testers add \
  --group-id "$GROUP_ID" \
  --email "tester@example.com" \
  --first-name "Jane" \
  --last-name "Doe"
```

### 5. Submit TestFlight for Review (External Testing)

```bash
asc testflight review get --build "$BUILD_ID"
asc testflight review submit --build "$BUILD_ID"
```

### 6. Report Results

```markdown
**TestFlight distribution complete!**
**App**: $APP_NAME ($BUNDLE_ID) | **Build**: $BUILD_VERSION ($BUILD_NUMBER)
**Groups**: [list of groups] | **Testers notified**: Yes
**Check feedback**: `asc feedback --app "$APP_ID" --build "$BUILD_ID"`
```

**Success criteria**: Build uploaded/selected, processing completed, beta groups assigned, testers notified, TestFlight review submitted (if external groups).

## SUBMIT MODE (--submit)

Submit a build for App Store review.

### 1. Pre-Submission Validation

```bash
asc validate --app "$APP_ID" --strict
```

If validation fails, report issues and **STOP**. Let user fix before retrying.

### 2. Select Build

```bash
asc builds list --app "$APP_ID" --output table
asc builds latest --app "$APP_ID"
```

Ask user to confirm which build to submit.

### 3. Create or Update App Store Version

```bash
# Check for existing draft version first
EXISTING=$(asc versions list --app "$APP_ID" --state PREPARE_FOR_SUBMISSION --output json | jq -r '.[0].id // empty')
if [ -n "$EXISTING" ]; then
  VERSION_ID="$EXISTING"
  echo "Using existing draft version: $VERSION_ID"
else
  # Create new version
  VERSION_ID=$(asc versions create \
    --app "$APP_ID" \
    --platform iOS \
    --version-string "2.1.0" \
    --output json | jq -r '.id')
fi

# Capture the build ID
BUILD_ID=$(asc builds latest --app "$APP_ID" --output json | jq -r '.id')

asc versions attach-build \
  --version-id "$VERSION_ID" \
  --build "$BUILD_ID"
```

### 4. Verify Metadata

```bash
asc localizations list --version-id "$VERSION_ID" --output table
asc app-info get --app "$APP_ID" --output table
```

If metadata is incomplete, warn user and suggest `--metadata` mode.

### 5. Submit for Review

```bash
asc submit create --version-id "$VERSION_ID" --confirm
asc submit status --version-id "$VERSION_ID" --output table
```

### 6. Report Results

```markdown
**App submitted for review!**
**App**: $APP_NAME v$VERSION_STRING | **Build**: $BUILD_VERSION ($BUILD_NUMBER)
**Status**: Waiting for Review
**Monitor**: `asc submit status --version-id "$VERSION_ID"`
**Cancel**: `asc submit cancel --submission-id "$SUBMISSION_ID"`
Typical review time: 24-48 hours (varies).
```

**Success criteria**: Validation passed, build attached to version, metadata complete, submission created, status "Waiting for Review".

## STATUS MODE (--status)

```bash
asc versions list --app "$APP_ID" --output table
asc submit status --app "$APP_ID" --output table
asc builds latest --app "$APP_ID" --output table
```

Report in a clear format:

```markdown
**$APP_NAME Status**

| Aspect | Status |
|--------|--------|
| Latest Version | v$VERSION — $STATE |
| Latest Build | $BUILD_VERSION ($BUILD_NUMBER) — $PROCESSING_STATE |
| Review Status | $REVIEW_STATE |
| Last Updated | $TIMESTAMP |
```

## VALIDATE MODE (--validate)

```bash
asc validate --app "$APP_ID" --strict
```

**What it checks:** metadata character limits, screenshot completeness, age rating questionnaire, App Review information, version string format.

Report results clearly, with specific actions for each failure.

## METADATA MODE (--metadata)

### Select Version

```bash
asc versions list --app "$APP_ID" --output table
VERSION_ID=$(asc versions list --app "$APP_ID" --output json | jq -r '.[0].id')
```

### App Info

```bash
asc app-info get --app "$APP_ID" --output table

asc app-info set \
  --app "$APP_ID" \
  --locale en-US \
  --description "Your app description here" \
  --keywords "keyword1,keyword2,keyword3" \
  --whats-new "Bug fixes and performance improvements" \
  --promotional-text "Try our new feature!" \
  --support-url "https://example.com/support" \
  --marketing-url "https://example.com"
```

### Screenshots

```bash
asc screenshots list --version-id "$VERSION_ID" --output table
asc screenshots sizes

asc screenshots upload \
  --version-id "$VERSION_ID" \
  --locale en-US \
  --display-type "APP_IPHONE_67" \
  --file /path/to/screenshot.png

asc screenshots delete --screenshot-id "$SCREENSHOT_ID" --confirm
```

### Video Previews

```bash
asc video-previews upload \
  --version-id "$VERSION_ID" \
  --locale en-US \
  --display-type "APP_IPHONE_67" \
  --file /path/to/preview.mp4
```

### Categories & Pricing

```bash
asc categories list --output table

asc app-setup categories set \
  --app "$APP_ID" \
  --primary "GAMES" \
  --secondary "ENTERTAINMENT"

asc app-setup pricing set --app "$APP_ID" --price-tier 0
```

### Bulk Localization

```bash
asc metadata pull --app "$APP_ID"
asc app-setup localizations upload --app "$APP_ID" --path ./metadata/
```

## BUILDS MODE (--builds)

### List & Inspect

```bash
asc builds list --app "$APP_ID" --output table
asc builds list --app "$APP_ID" --filter-version "2.1"
asc builds latest --app "$APP_ID" --output table
asc builds latest --app "$APP_ID" --platform iOS
asc builds info --build "$BUILD_ID" --output table
```

### Expire Builds

```bash
# ALWAYS use --dry-run first, show results before executing
asc builds expire --build "$BUILD_ID" --confirm
asc builds expire-all --app "$APP_ID" --older-than 90d --dry-run --confirm
asc builds expire-all --app "$APP_ID" --older-than 90d --confirm
```

**CRITICAL**: Always run `--dry-run` first for bulk expire and show results to user before executing.

## SIGNING MODE (--signing)

### Quick Setup

```bash
# Fetch all signing assets, create missing ones automatically
asc signing fetch --app "$APP_ID" --create-missing
```

This is the **fastest path** — downloads certificates and profiles, creating any that are missing.

### Certificates

```bash
asc certificates list --output table
asc certificates create --type IOS_DISTRIBUTION
asc certificates revoke --certificate-id "$CERT_ID" --confirm
```

**WARNING**: Certificate revocation is IRREVERSIBLE and affects ALL apps using this certificate. Revoking a distribution certificate will invalidate all builds signed with it. Only revoke if the certificate is compromised.

### Provisioning Profiles

```bash
asc profiles list --output table

asc profiles create \
  --name "MyApp Distribution" \
  --type IOS_APP_STORE \
  --bundle-id-id "$BUNDLE_ID_ID" \
  --certificate-ids "$CERT_ID"

asc profiles download --profile-id "$PROFILE_ID" --output ./profiles/
```

### Bundle IDs

```bash
asc bundle-ids list --output table

asc bundle-ids create \
  --name "MyApp" \
  --identifier "com.example.myapp" \
  --platform iOS

asc bundle-ids capabilities add \
  --bundle-id-id "$BUNDLE_ID_ID" \
  --capability PUSH_NOTIFICATIONS
```

## ANALYTICS MODE (--analytics)

### Sales Reports

```bash
asc analytics sales \
  --vendor-number "$VENDOR_NUMBER" \
  --report-date "2026-02-18" \
  --report-type SALES \
  --decompress
```

### Customer Reviews

```bash
asc reviews --app "$APP_ID" --output table
asc reviews --app "$APP_ID" --filter-rating 1 --output table
asc reviews respond \
  --review-id "$REVIEW_ID" \
  --body "Thank you for your feedback! We've fixed this in v2.1."
asc reviews ratings --app "$APP_ID" --output table
```

### Finance Reports

```bash
asc finance regions --output table
asc finance reports \
  --vendor-number "$VENDOR_NUMBER" \
  --region-code US \
  --report-date "2026-01" \
  --report-type FINANCIAL
```

### Analytics Reports

```bash
asc analytics request \
  --app "$APP_ID" \
  --report-type APP_USAGE
asc analytics requests --app "$APP_ID" --output table
asc analytics download --report-id "$REPORT_ID" --output ./reports/
```

## XCODE CLOUD MODE (--xcode-cloud)

### List Workflows

```bash
asc xcode-cloud workflows --app "$APP_ID" --output table
```

### Trigger a Build

```bash
asc xcode-cloud run \
  --workflow-id "$WORKFLOW_ID" \
  --wait \
  --poll-interval 30 \
  --timeout 3600
```

**IMPORTANT**: Xcode Cloud workflows must have a **manual start condition** enabled to be triggered via API.

### Monitor & Artifacts

```bash
asc xcode-cloud status --build-run-id "$BUILD_RUN_ID" --wait
asc xcode-cloud build-runs --workflow-id "$WORKFLOW_ID" --output table
asc xcode-cloud artifacts --build-run-id "$BUILD_RUN_ID" --output table
asc xcode-cloud artifacts download --artifact-id "$ARTIFACT_ID" --output ./artifacts/
asc xcode-cloud test-results --build-run-id "$BUILD_RUN_ID" --output table
asc xcode-cloud issues --build-run-id "$BUILD_RUN_ID" --output table
```

## NOTARIZATION MODE (--notarize)

### Submit & Check

```bash
asc notarization submit --ipa /path/to/MyApp.zip --wait
asc notarization status --submission-id "$SUBMISSION_ID"
asc notarization log --submission-id "$SUBMISSION_ID"
asc notarization list --output table
```

**If accepted**, staple the ticket (if not auto-stapled): `xcrun stapler staple MyApp.app`

## SUBSCRIPTIONS & IN-APP PURCHASES

### Subscriptions

```bash
asc subscriptions groups --app "$APP_ID" --output table
asc subscriptions groups create --app "$APP_ID" --name "Premium"

asc subscriptions create \
  --group-id "$GROUP_ID" \
  --name "Monthly Premium" \
  --product-id "com.example.premium.monthly" \
  --duration ONE_MONTH

asc subscriptions prices add \
  --subscription-id "$SUB_ID" \
  --base-territory US \
  --price-point "$PRICE_POINT_ID"

asc subscriptions submit --subscription-id "$SUB_ID" --confirm
```

### In-App Purchases

```bash
asc iap list --app "$APP_ID" --output table

asc iap create \
  --app "$APP_ID" \
  --name "Remove Ads" \
  --product-id "com.example.removeads" \
  --type NON_CONSUMABLE

asc iap submit --iap-id "$IAP_ID" --confirm
```

## PHASED RELEASE

```bash
asc versions phased-release --version-id "$VERSION_ID" --state ACTIVE
asc versions phased-release --version-id "$VERSION_ID" --state PAUSED
asc versions phased-release --version-id "$VERSION_ID" --state COMPLETE --confirm
```

**WARNING**: Setting phased release to COMPLETE is IRREVERSIBLE — the update immediately rolls out to 100% of users. You cannot pause or roll back after this.

## REJECTION HANDLING

If your app is rejected by App Review:

### 1. Check Rejection Reason

```bash
asc submit status --app "$APP_ID" --output json
asc versions list --app "$APP_ID" --state REJECTED --output table
```

Review the rejection notes in App Store Connect → Activity → Resolution Center.

### 2. Fix and Resubmit

After fixing the issue:

```bash
# If you can resubmit the same build (metadata-only rejection):
asc submit create --version-id "$VERSION_ID" --confirm

# If you need a new build (code rejection):
asc builds upload --app "$APP_ID" --ipa /path/to/FixedApp.ipa --wait
BUILD_ID=$(asc builds latest --app "$APP_ID" --output json | jq -r '.id')
asc versions attach-build --version-id "$VERSION_ID" --build "$BUILD_ID"
asc submit create --version-id "$VERSION_ID" --confirm
```

### 3. Appeal (if you disagree)
Appeals are handled through the Resolution Center in App Store Connect (not via CLI).

## ROLLBACK TO PREVIOUS VERSION

To revert to a previous version after a problematic release:

```bash
# 1. Check available builds
asc builds list --app "$APP_ID" --output table

# 2. Create a new version with the old build
asc versions create --app "$APP_ID" --platform iOS --version-string "2.1.1" --output json
VERSION_ID=$(asc versions list --app "$APP_ID" --output json | jq -r '.[0].id')

# 3. Attach the known-good build
asc versions attach-build --version-id "$VERSION_ID" --build "$GOOD_BUILD_ID"

# 4. Submit expedited review
asc submit create --version-id "$VERSION_ID" --confirm
```

**NOTE**: Apple does not support true instant rollback. A "rollback" is a new submission with an older build, still subject to review (request expedited review for critical issues).

## EMERGENCY APP REMOVAL

To remove your app from sale immediately (does NOT delete — users who purchased can still re-download):

```bash
asc versions list --app "$APP_ID" --output table
# Contact Apple Developer Support for emergency takedown
# Or use phased release pause if the version is still rolling out:
asc versions phased-release --version-id "$VERSION_ID" --state PAUSED
```

**WARNING**: Full app removal requires contacting Apple Developer Support. The API can pause phased releases but cannot remove an app from sale.

## END-TO-END PUBLISH COMMANDS

```bash
# Upload + distribute to TestFlight in one step
asc publish testflight \
  --app "$APP_ID" \
  --ipa /path/to/MyApp.ipa \
  --groups "Internal Testers,QA Team"

# Upload + submit to App Store in one step
asc publish appstore \
  --app "$APP_ID" \
  --ipa /path/to/MyApp.ipa \
  --version "2.1.0"
```

## MULTI-PROFILE SUPPORT

Work with multiple Apple Developer accounts:

```bash
asc auth login --name "ClientApp" --key-id "XYZ" --issuer-id "ABC" --private-key ./keys/client.p8
asc auth switch --name "ClientApp"
asc --profile "ClientApp" apps list
asc auth status
```

## ENVIRONMENT VARIABLES REFERENCE

### Secrets (protect these — NEVER log or commit)

| Variable | Purpose |
|----------|---------|
| `ASC_KEY_ID` | API key ID |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_PRIVATE_KEY_PATH` | Path to .p8 file |
| `ASC_PRIVATE_KEY_B64` | Base64-encoded key (CI-friendly) |
| `ASC_SLACK_WEBHOOK` | Slack webhook URL |

### Configuration (safe to log)

| Variable | Purpose |
|----------|---------|
| `ASC_PROFILE` | Named profile to use |
| `ASC_APP_ID` | Default app ID |
| `ASC_VENDOR_NUMBER` | For sales/finance reports |
| `ASC_TIMEOUT` | Request timeout |
| `ASC_MAX_RETRIES` | Retry count (default: 3) |
| `ASC_DEFAULT_OUTPUT` | Default output format (json/table/markdown) |
| `ASC_DEBUG` | Enable debug logging (`1` or `api`) |
| `ASC_BYPASS_KEYCHAIN` | Skip keychain auth, use config/env |

**CI WARNING**: `ASC_DEBUG=api` logs full HTTP request/response bodies including auth tokens. NEVER enable in CI logs visible to external contributors.

**NOTE**: `ASC_BYPASS_KEYCHAIN` is useful in CI/Docker where macOS Keychain is unavailable. In local development, keychain storage is more secure.

## CI/CD INTEGRATION (GitHub Actions)

```yaml
name: Release to TestFlight
on:
  push:
    tags: ['v*']

jobs:
  distribute:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: rudrankriyam/setup-asc@v1
        with:
          version: latest

      - name: Authenticate
        env:
          ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
          ASC_PRIVATE_KEY_B64: ${{ secrets.ASC_PRIVATE_KEY_B64 }}
        run: asc auth status --validate

      - name: Upload and Distribute
        run: |
          asc publish testflight \
            --app "${{ vars.APP_ID }}" \
            --ipa ./build/MyApp.ipa \
            --groups "Beta Testers"
```

## APP STORE REQUIREMENTS CHECKLIST

Before submitting, verify these Apple requirements:

### App Privacy Declarations (REQUIRED since Dec 2020)
Every app submission MUST include App Privacy declarations. Without them, your submission will be **automatically rejected**.

```bash
asc app-privacy get --app "$APP_ID" --output table
asc app-privacy update --app "$APP_ID" --declarations ./privacy-declarations.json
```

Categories: Data Collection, Data Use, Data Linked to User, Data Used to Track User, Third-Party SDK Data.

### Export Compliance
If your app uses encryption (including HTTPS, standard libraries), you must declare it:

```bash
asc versions update --version-id "$VERSION_ID" --uses-non-exempt-encryption false
```

Set to `true` if using custom encryption beyond standard HTTPS/TLS. You may need an Export Compliance document.

## TROUBLESHOOTING

| Issue | Fix |
|-------|-----|
| `asc: command not found` | Install: `brew install asc` |
| Auth fails | Run `asc auth doctor --fix --confirm` |
| "Forbidden" errors | Check API key role (needs Admin or App Manager for submissions) |
| Build processing stuck | Wait up to 30 min; check `asc builds info --build $ID` |
| Upload timeout | Set `ASC_UPLOAD_TIMEOUT=600` (seconds) |
| Rate limiting | `asc` retries automatically (3x with exponential backoff) |
| Wrong app selected | Use `--profile` flag or `ASC_APP_ID` env var |

## Related Skills

| Skill | Install | Purpose |
|-------|---------|---------|
| `scout` | `npx vskill i anton-abyzov/vskill/scout` | Discover and install other skills |
