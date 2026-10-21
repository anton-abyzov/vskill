#!/bin/sh
# Test harness for scripts/check.sh. POSIX sh, no dependencies.
# Uses fake php / rpm / curl binaries on PATH and fixture repos in a temp dir.
# Usage: sh tests/run.sh   (exit non-zero if any case fails)

HERE=$(cd "$(dirname "$0")" && pwd -P)
CHECK="$HERE/../scripts/check.sh"
SHELL_BIN=${TEST_SHELL:-sh}
T=$(mktemp -d 2>/dev/null || mktemp -d -t php2shell-test)
trap 'rm -rf "$T"' EXIT INT TERM
PASS=0; FAIL=0
EMPTY="$T/empty"; mkdir -p "$EMPTY"

# fake_php <dir> <version-line> [ini-lines]
fake_php() {
  mkdir -p "$1"
  cat > "$1/php" <<EOF
#!/bin/sh
case "\$1" in
  -v) echo "$2"; echo "Copyright (c) The PHP Group" ;;
  -r) printf '%s\n' "${3:-memory_limit=128M}" ;;
esac
EOF
  chmod +x "$1/php"
}

# run_check <bindir> <args...>: sets OUT and RC
run_check() {
  rc_bin=$1; shift
  OUT=$(PHP2SHELL_PATH="$rc_bin" PHP2SHELL_NO_SYSTEM_SCAN=1 PATH="$rc_bin:/usr/bin:/bin" \
        "$SHELL_BIN" "$CHECK" "$@" 2>&1)
  RC=$?
}

ok()   { PASS=$((PASS + 1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "FAIL  $1"; echo "$OUT" | sed 's/^/      | /' | head -n 25; }

# expect <name> <exit> <grep-pattern...>
expect() {
  ex_name=$1; ex_rc=$2; shift 2
  if [ "$RC" != "$ex_rc" ]; then bad "$ex_name (exit $RC, want $ex_rc)"; return; fi
  for ex_p in "$@"; do
    if ! printf '%s\n' "$OUT" | grep -qE -- "$ex_p"; then bad "$ex_name (missing: $ex_p)"; return; fi
  done
  ok "$ex_name"
}

# binary version cases: version -> verdict, exit
case_bin() {
  cb_v=$1; cb_verdict=$2; cb_rc=$3
  cb_dir="$T/bin-$cb_v"
  fake_php "$cb_dir" "PHP $cb_v (cli) (built: Oct 21 2026 14:00:00) (NTS)"
  run_check "$cb_dir" --no-repo
  expect "php $cb_v -> $cb_verdict" "$cb_rc" "\\[$cb_verdict\\] .*PHP $cb_v"
}

case_bin 8.4.26 VULNERABLE 1
case_bin 8.4.27 PATCHED 0
case_bin 8.5.12 PATCHED 0
case_bin 8.2.34 VULNERABLE 1
case_bin 8.2.35 PATCHED 0
case_bin 8.3.36 PATCHED 0
case_bin 8.3.35 VULNERABLE 1
case_bin 8.1.31 VULNERABLE 1
case_bin 7.4.33 VULNERABLE 1
case_bin 5.6.40 VULNERABLE 1
case_bin 8.6.0RC4 PATCHED 0
case_bin 8.6.0RC3 VULNERABLE 1

run_check "$T/bin-5.6.40" --no-repo
expect "5.6.40 carries EOL note" 1 "EOL branch 5.6"
run_check "$T/bin-7.4.33" --no-repo
expect "7.4.33 notes vendor backports" 1 "no official upstream release for 7.4"

# no php anywhere
run_check "$EMPTY" --no-repo
expect "no php -> UNKNOWN exit 2" 2 "no PHP binary found" "Overall: UNKNOWN"

# --version override without a binary
run_check "$EMPTY" --no-repo --version 8.5.11
expect "--version 8.5.11 -> VULNERABLE" 1 "\\[VULNERABLE\\] --version  PHP 8.5.11" "fix: 8.5.12"

# --php explicit path
run_check "$EMPTY" --no-repo --php "$T/bin-8.4.27/php"
expect "--php explicit path" 0 "\\[PATCHED\\] .*bin-8.4.27/php"

# distro package, changelog lists the CVE -> PATCHED-BACKPORT (fake rpm)
pk="$T/bin-pkg-yes"; fake_php "$pk" "PHP 8.2.34 (cli)"
cat > "$pk/rpm" <<'EOF'
#!/bin/sh
case "$1" in
  -qf) echo "php-cli-8.2.34-1.el9_6.x86_64" ;;
  -q) echo "* Tue Oct 21 2026 Packager - 8.2.34-1.1"; echo "- fix CVE-2026-109618 and CVE-2026-109619" ;;
esac
EOF
chmod +x "$pk/rpm"
run_check "$pk" --no-repo
expect "rpm changelog with CVE -> PATCHED-BACKPORT exit 0" 0 "\\[PATCHED-BACKPORT\\]" "pkg: rpm:php-cli"

pk2="$T/bin-pkg-no"; fake_php "$pk2" "PHP 8.2.34 (cli)"
cat > "$pk2/rpm" <<'EOF'
#!/bin/sh
case "$1" in
  -qf) echo "php-cli-8.2.34-1.el9_6.x86_64" ;;
  -q) echo "* Mon Sep 01 2026 Packager - 8.2.34-1"; echo "- rebase" ;;
esac
EOF
chmod +x "$pk2/rpm"
run_check "$pk2" --no-repo
expect "rpm changelog without CVE -> BACKPORT-POSSIBLE exit 3" 3 "\\[BACKPORT-POSSIBLE\\]" "Overall: BACKPORT-POSSIBLE"

# ini stopgap check
ini="$T/bin-ini"
fake_php "$ini" "PHP 8.5.11 (cli)" "memory_limit=128M
post_max_size=64M
upload_max_filesize=64M
session.upload_progress.enabled=1
fatal_error_backtraces=1
file_uploads=1"
run_check "$ini" --no-repo
expect "ini stopgaps flagged" 1 "\\[stopgap\\] memory_limit = 128M" "\\[stopgap\\] post_max_size = 64M" \
  "\\[stopgap\\] upload_max_filesize = 64M" "\\[stopgap\\] session.upload_progress.enabled = 1" \
  "\\[stopgap\\] fatal_error_backtraces = 1"

ini2="$T/bin-ini2"
fake_php "$ini2" "PHP 8.5.12 (cli)" "memory_limit=-1
post_max_size=8M
upload_max_filesize=2M
session.upload_progress.enabled=0
fatal_error_backtraces=0
file_uploads=0"
run_check "$ini2" --no-repo
expect "ini stopgaps applied" 0 "\\[ok\\] memory_limit = -1" "\\[ok\\] session.upload_progress.enabled = 0"

# repo fixture: Dockerfile + composer.json (no php binary)
R="$T/repo"; mkdir -p "$R/.github/workflows" "$R/node_modules/x"
printf 'FROM php:8.3.10-fpm AS base\nRUN echo hi\n' > "$R/Dockerfile"
cat > "$R/composer.json" <<'EOF'
{
  "name": "acme/app",
  "require": { "php": "^8.1", "laravel/framework": "^11.0" },
  "config": { "platform": { "php": "8.1.0" } }
}
EOF
printf 'FROM php:5.6\n' > "$R/node_modules/x/Dockerfile"
printf 'jobs:\n  t:\n    steps:\n      - uses: shivammathur/setup-php@v2\n        with:\n          php-version: "8.3"\n' > "$R/.github/workflows/ci.yml"
run_check "$EMPTY" --repo "$R"
expect "repo: Dockerfile php:8.3.10-fpm + composer ^8.1" 1 \
  "\\[VULNERABLE\\] Dockerfile: docker-image php:8.3.10-fpm" "fix: 8.3.36" \
  "\\[INFO\\] composer.json: composer-require-php \\^8.1" "allows 8.1" \
  "composer-platform-php 8.1.0" "\\[INFO\\] .github/workflows/ci.yml: ci-setup-php 8.3"
if printf '%s\n' "$OUT" | grep -q node_modules; then bad "repo: node_modules pruned"; else ok "repo: node_modules pruned"; fi

R2="$T/repo2"; mkdir -p "$R2"
printf 'services:\n  app:\n    image: php:8.4-apache\n  db:\n    image: postgres:17\n' > "$R2/compose.yaml"
printf '8.4.27\n' > "$R2/.php-version"
printf 'nodejs 22.1.0\nphp 8.4.27\n' > "$R2/.tool-versions"
run_check "$EMPTY" --repo "$R2"
expect "repo: floating compose tag + pinned .php-version" 0 "\\[FLOATING\\] compose.yaml: docker-image php:8.4-apache" \
  "\\[PATCHED\\] .php-version" "\\[PATCHED\\] .tool-versions: tool-versions php 8.4.27"

# --json output
run_check "$EMPTY" --repo "$R" --json --version 8.4.26
expect "--json is machine readable" 1 '^\{"tool":"php2shell-check"' '"verdict":"VULNERABLE","exit_code":1' \
  '"kind":"docker-image","value":"php:8.3.10-fpm","verdict":"VULNERABLE","counts_toward_verdict":true'
if command -v python3 >/dev/null 2>&1; then
  if printf '%s' "$OUT" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then ok "--json parses as JSON"
  else bad "--json parses as JSON"; fi
fi

# --url with a fake curl
cu="$T/bin-curl"; mkdir -p "$cu"
cat > "$cu/curl" <<'EOF'
#!/bin/sh
printf 'HTTP/2 200\r\nserver: nginx\r\nx-powered-by: PHP/8.3.12\r\n\r\n'
EOF
chmod +x "$cu/curl"
run_check "$cu" --no-repo --url https://example.test
expect "--url reads X-Powered-By" 1 "\\[VULNERABLE\\] https://example.test  PHP 8.3.12"

# pre-release / branch-only strings never count as PATCHED below the fix
for pv in 8.4.27-dev 8.4.27RC1 8.5.12RC1 8.2.35-dev 8.6.0-RC3; do
  run_check "$EMPTY" --no-repo --version "$pv"
  expect "--version $pv -> VULNERABLE" 1 "\\[VULNERABLE\\] --version  PHP $pv"
done
run_check "$EMPTY" --no-repo --version 8.6
expect "--version 8.6 (no patch level) -> UNKNOWN" 2 "\\[UNKNOWN\\] --version  PHP 8.6"
R3="$T/repo3"; mkdir -p "$R3"
printf 'FROM php:8.6-rc-fpm\n' > "$R3/Dockerfile"
printf '8.6\n' > "$R3/.php-version"
run_check "$EMPTY" --repo "$R3"
expect "php:8.6-rc-fpm and .php-version 8.6 -> FLOATING" 2 "\\[FLOATING\\] Dockerfile: docker-image php:8.6-rc-fpm" "\\[FLOATING\\] .php-version"

# image pinned by digest keeps its tag
R4="$T/repo4"; mkdir -p "$R4"
printf 'FROM php:8.3.10-fpm@sha256:0123456789abcdef\n' > "$R4/Dockerfile"
run_check "$EMPTY" --repo "$R4"
expect "digest-pinned php:8.3.10-fpm -> VULNERABLE" 1 "\\[VULNERABLE\\] Dockerfile: docker-image php:8.3.10-fpm@sha256"

# EOL distro package stays VULNERABLE (fake rpm)
pk3="$T/bin-pkg-eol"; fake_php "$pk3" "PHP 5.4.16 (cli)"
cat > "$pk3/rpm" <<'EOF'
#!/bin/sh
case "$1" in
  -qf) echo "php-cli-5.4.16-48.el7.x86_64" ;;
  -q) echo "* Mon Sep 01 2020 Packager - 5.4.16-48"; echo "- rebuild" ;;
esac
EOF
chmod +x "$pk3/rpm"
run_check "$pk3" --no-repo
expect "EOL rpm 5.4.16 -> VULNERABLE exit 1" 1 "\\[VULNERABLE\\] .*PHP 5.4.16" "pkg: rpm:php-cli-5.4.16"

# warning line before the version line
wp="$T/bin-warn"; mkdir -p "$wp"
cat > "$wp/php" <<'EOF'
#!/bin/sh
case "$1" in
  -v) echo "PHP Warning:  PHP Startup: Unable to load dynamic library 'x.so'"; echo "PHP 8.4.26 (cli) (built: Oct 1 2026)" ;;
  -r) echo "memory_limit=-1" ;;
esac
EOF
chmod +x "$wp/php"
run_check "$wp" --no-repo
expect "startup warning before version line" 1 "\\[VULNERABLE\\] .*PHP 8.4.26 \\(cli\\)" "cli ini only"

# FrankenPHP reads its embedded PHP version
fp="$T/bin-franken"; mkdir -p "$fp"
cat > "$fp/frankenphp" <<'EOF'
#!/bin/sh
[ "$1" = version ] && echo "FrankenPHP v1.9.0 PHP 8.4.26 Caddy v2.10.0 h1:abc"
EOF
chmod +x "$fp/frankenphp"
run_check "$fp" --no-repo
expect "frankenphp version is judged" 1 "\\[VULNERABLE\\] .*frankenphp  PHP 8.4.26 \\(frankenphp\\)"

# EOL X-Powered-By with a distro suffix stays VULNERABLE
cu2="$T/bin-curl2"; mkdir -p "$cu2"
cat > "$cu2/curl" <<'EOF'
#!/bin/sh
printf 'HTTP/1.1 200 OK\r\nX-Powered-By: PHP/7.0.33-0ubuntu0.16.04.16\r\n\r\n'
EOF
chmod +x "$cu2/curl"
run_check "$cu2" --no-repo --url https://example.test
expect "--url EOL distro string -> VULNERABLE" 1 "\\[VULNERABLE\\] https://example.test  PHP 7.0.33"

# default repo scan refuses $HOME
OUT=$(cd "$T" && HOME="$T" PHP2SHELL_PATH="$EMPTY" PHP2SHELL_NO_SYSTEM_SCAN=1 PATH="/usr/bin:/bin" "$SHELL_BIN" "$CHECK" 2>&1); RC=$?
expect "cwd = HOME is not scanned by default" 2 "skipped: current dir"

echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
