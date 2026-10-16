#!/usr/bin/env bash
# release-npm.sh — tag origin/main and follow the npm release to the registry
#
# Usage: bash scripts/release/release-npm.sh [<version>] [--dry-run]
#   <version>   X.Y.Z; defaults to the version in this checkout's package.json
#   --dry-run   run every check, print what would be tagged, tag and push nothing
#
# The version bump is a normal PR. Once it is merged, this script:
#   1. Preflight (no side effects): gh is signed in with push access, v<version>
#      is not yet a tag (locally or on GitHub), vskill@<version> is not on npm,
#      origin/main's package.json is at <version>, a dry-run push of the tag
#      authenticates, and CI on that commit has not failed.
#   2. Tags the fetched origin/main commit v<version> and pushes the tag over
#      HTTPS. npm-release.yml fires on the tag, waits for ci.yml on that commit
#      and publishes.
#   3. Finds the npm Release run (retrying while GitHub creates it) and follows
#      it with `gh run watch --exit-status`.
#   4. Polls https://registry.npmjs.org/vskill/<version> until it answers 200.
#   5. Runs `npx -y --prefer-online vskill@<version> --version` from an empty
#      directory and requires it to print <version>.
#
# Bash 3.2 compatible (stock macOS /bin/bash).

set -euo pipefail

REPO="anton-abyzov/vskill"
PACKAGE="vskill"
# Override only to rehearse against a scratch clone; the run lookup and
# registry checks still use $REPO and the public registry.
REMOTE_URL="${VSKILL_RELEASE_REMOTE:-https://github.com/${REPO}.git}"
REGISTRY="https://registry.npmjs.org"
RUN_LOOKUP_SECONDS="${RUN_LOOKUP_SECONDS:-120}"
REGISTRY_TIMEOUT_SECONDS="${REGISTRY_TIMEOUT_SECONDS:-300}"

usage() {
  sed -n '3,6p' "$0" | sed 's/^# \{0,1\}//'
}

step() { printf '\n==> %s\n' "$*"; }
ok() { printf '    ok: %s\n' "$*"; }
die() { printf 'release-npm: %s\n' "$*" >&2; exit 1; }

VERSION=""
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) printf 'release-npm: unknown option %s\n' "$1" >&2; usage >&2; exit 2 ;;
    *)
      [ -z "$VERSION" ] || { printf 'release-npm: more than one version given\n' >&2; exit 2; }
      VERSION="$1"
      ;;
  esac
  shift
done

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
cd "$ROOT"

for tool in git gh node curl npx; do
  command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
done

if [ -z "$VERSION" ]; then
  VERSION=$(node -p 'require("./package.json").version')
fi
VERSION="${VERSION#v}"
printf '%s\n' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || die "version '$VERSION' is not X.Y.Z (npm-release.yml only fires on vX.Y.Z tags)"
TAG="v${VERSION}"

# ─── 1. Preflight ─────────────────────────────────────────────────────────
step "Preflight for ${PACKAGE}@${VERSION} (${TAG})"

gh auth status >/dev/null 2>&1 || die "gh is not signed in (gh auth login)"
can_push=$(gh api "repos/${REPO}" -q '.permissions.push') || die "cannot read repos/${REPO} with the current gh account"
[ "$can_push" = "true" ] || die "the current gh account has no push access to ${REPO}"
ok "gh signed in with push access to ${REPO}"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  die "tag ${TAG} already exists in this checkout"
fi
remote_tag=$(git ls-remote --tags "$REMOTE_URL" "refs/tags/${TAG}") || die "git ls-remote ${REMOTE_URL} failed"
[ -z "$remote_tag" ] || die "tag ${TAG} already exists on ${REMOTE_URL}"
ok "${TAG} is not a tag yet"

npm_code=$(curl -s -o /dev/null -w '%{http_code}' "${REGISTRY}/${PACKAGE}/${VERSION}") || npm_code="000"
case "$npm_code" in
  404) ok "${PACKAGE}@${VERSION} is not on npm yet" ;;
  200) die "${PACKAGE}@${VERSION} is already published on npm" ;;
  *) die "could not query ${REGISTRY}/${PACKAGE}/${VERSION} (HTTP ${npm_code})" ;;
esac

git fetch -q "$REMOTE_URL" main || die "git fetch ${REMOTE_URL} main failed"
SHA=$(git rev-parse FETCH_HEAD)
main_version=$(git show "${SHA}:package.json" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).version));
')
[ "$main_version" = "$VERSION" ] \
  || die "origin/main (${SHA}) package.json is ${main_version}, not ${VERSION}; merge the version bump first"
ok "origin/main ${SHA} package.json is ${VERSION}"

# A dry-run push authenticates against the remote and compares refs but sends
# no objects and no ref update, so it proves the HTTPS credentials work before
# anything is tagged.
git push --dry-run -q "$REMOTE_URL" "${SHA}:refs/tags/${TAG}" \
  || die "git push --dry-run to ${REMOTE_URL} failed; check HTTPS git credentials (gh auth setup-git)"
ok "git can push ${TAG} to ${REMOTE_URL}"

# npm-release.yml waits for this run anyway; refusing here avoids pushing a
# tag whose release is already known to fail.
if ci_state=$(gh run list -R "$REPO" --workflow ci.yml --commit "$SHA" --event push \
    --json status,conclusion -q '.[0] | select(. != null) | "\(.status) \(.conclusion)"'); then
  case "$ci_state" in
    "") ok "no CI run on ${SHA} yet (npm-release.yml will wait for it)" ;;
    "completed success") ok "CI passed on ${SHA}" ;;
    completed*) die "CI on ${SHA} finished '${ci_state#completed }'; fix main before releasing" ;;
    *) ok "CI on ${SHA} is ${ci_state% *} (npm-release.yml will wait for it)" ;;
  esac
else
  die "could not read CI runs for ${SHA}"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  step "Dry run: nothing tagged or pushed"
  printf '    would run: git tag %s %s\n' "$TAG" "$SHA"
  printf '    would run: git push %s refs/tags/%s\n' "$REMOTE_URL" "$TAG"
  printf '    then watch npm-release.yml, poll %s/%s/%s and run npx %s@%s --version\n' \
    "$REGISTRY" "$PACKAGE" "$VERSION" "$PACKAGE" "$VERSION"
  exit 0
fi

# ─── 2. Tag origin/main and push the tag ──────────────────────────────────
step "Tagging ${SHA} as ${TAG}"
git tag "$TAG" "$SHA"
if ! git push -q "$REMOTE_URL" "refs/tags/${TAG}"; then
  git tag -d "$TAG" >/dev/null
  die "pushing ${TAG} to ${REMOTE_URL} failed; local tag removed"
fi
ok "pushed ${TAG}"

# ─── 3. Follow the npm Release run ────────────────────────────────────────
step "Waiting for the npm Release run"
RUN_ID=""
deadline=$(( $(date +%s) + RUN_LOOKUP_SECONDS ))
while :; do
  if RUN_ID=$(gh run list -R "$REPO" --workflow npm-release.yml --branch "$TAG" --event push \
      --json databaseId,headSha -q "[.[] | select(.headSha == \"${SHA}\")][0].databaseId // empty" 2>/dev/null); then
    [ -n "$RUN_ID" ] && break
  else
    RUN_ID=""
  fi
  [ "$(date +%s)" -lt "$deadline" ] || die "no npm-release.yml run for ${TAG} after ${RUN_LOOKUP_SECONDS}s"
  sleep 5
done
ok "run ${RUN_ID}: https://github.com/${REPO}/actions/runs/${RUN_ID}"
gh run watch "$RUN_ID" -R "$REPO" --exit-status --interval 15 \
  || die "npm Release run ${RUN_ID} failed; see: gh run view ${RUN_ID} -R ${REPO} --log-failed"

# ─── 4. Registry ──────────────────────────────────────────────────────────
# The per-version document updates before the full packument does.
step "Waiting for ${REGISTRY}/${PACKAGE}/${VERSION}"
deadline=$(( $(date +%s) + REGISTRY_TIMEOUT_SECONDS ))
until curl -fsS -o /dev/null "${REGISTRY}/${PACKAGE}/${VERSION}" 2>/dev/null; do
  [ "$(date +%s)" -lt "$deadline" ] || die "${PACKAGE}@${VERSION} not on the registry after ${REGISTRY_TIMEOUT_SECONDS}s"
  sleep 10
done
ok "${PACKAGE}@${VERSION} is on the registry"

# ─── 5. Fresh install runs ────────────────────────────────────────────────
# From an empty directory, so npx cannot resolve this checkout's own package.
step "npx -y --prefer-online ${PACKAGE}@${VERSION} --version"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/release-npm.XXXXXX")
if ! printed=$(cd "$scratch" && npx -y --prefer-online "${PACKAGE}@${VERSION}" --version); then
  rm -rf "$scratch"
  die "npx ${PACKAGE}@${VERSION} --version failed"
fi
rm -rf "$scratch"
printf '%s\n' "$printed" | grep -qF "$VERSION" \
  || die "npx ${PACKAGE}@${VERSION} --version printed '${printed}', expected ${VERSION}"
ok "npx ${PACKAGE}@${VERSION} --version -> ${VERSION}"

step "Released ${PACKAGE}@${VERSION}"
