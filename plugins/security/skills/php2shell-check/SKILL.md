---
name: php2shell-check
description: "Read-only exposure check and fix plan for php2shell, the October 2026 PHP emergency patch (CVE-2026-109618, CVE-2026-109619, unauthenticated RCE in every web SAPI). Runs a portable POSIX script that finds installed PHP binaries and versions, judges each against the fixed releases (8.2.35, 8.3.36, 8.4.27, 8.5.12, 8.6.0RC4), detects distro packages that may carry backports, scans the project (Dockerfile/compose php images, .php-version, .tool-versions, composer.json, setup-php) and checks the ini stopgaps. Activate when the user mentions 'php2shell', 'CVE-2026-109618', 'CVE-2026-109619', 'GHSA-w8hw-w9fx-j79w', 'GHSA-6wmf-4rv5-p3rp', 'is my PHP vulnerable', 'PHP emergency patch', 'PHP RCE October 2026', or asks whether a PHP server, container or project needs patching. Do NOT use it to test sites the user does not own."
version: 0.1.0
allowed-tools:
  - Bash
  - Read
metadata:
  version: 0.1.0
  category: security
  tags: security, php, php2shell, cve, php-fpm, mod_php, frankenphp, docker, patching, incident-response
---

# php2shell-check

php2shell is two critical bugs in PHP's request handling, disclosed and fixed on 2026-10-21 (CVSS v4.0 9.2 each):

- **CVE-2026-109618** ([GHSA-w8hw-w9fx-j79w](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w)): memory corruption when PHP runs out of memory while setting up request data; multipart parsing can trigger it. Unauthenticated RCE, shown on mod_php with the default config; FPM, FrankenPHP and LSAPI are likely exposed.
- **CVE-2026-109619** ([GHSA-6wmf-4rv5-p3rp](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp)): use-after-free of request state across requests on the same worker. Unauthenticated RCE or memory disclosure; shown on mod_php (8.5 `fatal_error_backtraces`) and PHP-FPM via session upload progress, which is on by default. No app code needed.

Every web SAPI is affected (FPM, mod_php, php-cgi, FrankenPHP, LiteSpeed). CLI-only use is not the attack surface. Exploit attempts were seen on 2026-10-21 (Cloudflare, watchTowr). Not in CISA KEV as of 2026-10-21.

Sources: [php.net](https://www.php.net/), the two GitHub advisories above, [NCSC](https://www.ncsc.gov.uk/news/critical-security-issue-affecting-php), [CERT-EU 2026-018](https://cert.europa.eu/publications/security-advisories/2026-018/).

## Run it

Run on the machine (or inside the container) that serves PHP, from the project root. `SKILL_DIR` is the folder holding this SKILL.md; use the script's full path so `--repo` defaults to the project, not the skill folder:

```bash
sh "$SKILL_DIR/scripts/check.sh"                 # binaries + repo in cwd + ini stopgaps
sh "$SKILL_DIR/scripts/check.sh" --repo ./app    # scan another project dir
sh "$SKILL_DIR/scripts/check.sh" --php /usr/sbin/php-fpm8.2   # one binary only
sh "$SKILL_DIR/scripts/check.sh" --version 8.4.26             # judge a version string
sh "$SKILL_DIR/scripts/check.sh" --url https://your-own-site.example   # X-Powered-By only
sh "$SKILL_DIR/scripts/check.sh" --json          # machine-readable
docker run --rm your-image php -v   # containers: check the image, not the host
```

Without `--repo`, a run from `$HOME` or `/` skips the project scan instead of walking the whole folder.

Exit codes: `0` all patched, `1` any vulnerable, `2` unknown or nothing found, `3` backport possible only.

The script is read-only and works offline: `php -v` (`frankenphp version`), `php -r ini_get(...)`, `dpkg -S`/`rpm -qf`/`apk` ownership queries, installed package changelogs, and with `--url` one HEAD request. It sends no exploit payloads. When a Debian/Ubuntu image has no changelog under `/usr/share/doc`, the verdict stays `BACKPORT-POSSIBLE`; check the vendor advisory.

## Read the verdicts

| Verdict | Meaning | Do |
|---|---|---|
| `PATCHED` | At or above the fix for its branch (8.2.35, 8.3.36, 8.4.27, 8.5.12, 8.6.0RC4, 8.6+). RC and `-dev` builds of a fix release (`8.4.27RC1`) are not | Confirm workers were restarted after the upgrade |
| `PATCHED-BACKPORT` | Distro package below the upstream number whose changelog lists CVE-2026-109618 | Restart workers; done |
| `BACKPORT-POSSIBLE` | Debian/Ubuntu/RHEL-family package on 7.4-8.5 below the fix, no CVE in its changelog yet (Alpine and 5.x-7.3 packages stay `VULNERABLE`) | Update the package, check the vendor advisory, rerun |
| `VULNERABLE` | Below the fix with no package evidence, any 7.4/8.0/8.1 build without a vendor backport, or 5.x-7.3 (EOL, no fix exists) | Follow the fix plan now |
| `FLOATING` | Docker tag or `.php-version` without a patch level (`php:8.4-fpm`, `php:8.6-rc-fpm`) | Rebuild with `--pull --no-cache`, pin an exact fixed tag |
| `UNKNOWN` | No version found, or a branch-only string | Run where PHP actually serves, or pass `--php` / `--version` |
| `INFO` | composer.json and CI `setup-php` hints | composer.lock and `require.php` never reveal the runtime; this is a runtime bug, not a package |

Distro and LTS packages keep the OLD upstream version string after a backport (for example `8.2.7-1~deb12u2`), so a low number from `dpkg`/`rpm` is not proof of exposure; the changelog check settles it. A hidden `X-Powered-By` header is not proof of safety.

## Fix plan

Upgrade, then restart every PHP worker (FPM pools, Apache with mod_php, FrankenPHP, LiteSpeed). A reload that keeps old workers alive is not enough.

| Branch | Target |
|---|---|
| 8.5 | 8.5.12 |
| 8.4 | 8.4.27 |
| 8.3 | 8.3.36 |
| 8.2 | 8.2.35 |
| 8.6 pre-release | 8.6.0RC4 or later |
| 7.4, 8.0, 8.1 | No official release. Use your distro/LTS vendor's patched package or the PHP security team's source backports; plan a move to 8.2.35+ |
| 5.x-7.3 | EOL, no fix. Upgrade to a supported branch or isolate the host |

Check your distro's security tracker for CVE-2026-109618 and CVE-2026-109619 before trusting a package.

- **Debian**: `apt update && apt install --only-upgrade 'php*'`. Sury repo users: update from packages.sury.org.
- **Ubuntu**: `apt update && apt upgrade`.
- **RHEL / Alma / Rocky**: `dnf upgrade 'php*'`. Remi users: update the `php*` SCL or module stream.
- **Alpine**: `apk upgrade`.
- **macOS Homebrew**: `brew update && brew upgrade php` (or `php@8.x`), then `brew services restart php`.
- **Docker official images**: pin `php:8.5.12-*`, `php:8.4.27-*`, `php:8.3.36-*`, `php:8.2.35-*` (fpm, apache, cli, alpine variants), rebuild with `docker build --pull --no-cache`, redeploy. Pin by digest too if you like; the script still reads the tag in `php:8.4.27-fpm@sha256:...`.
- **Laravel Forge, Plesk, cPanel (EA-PHP), CloudLinux, managed hosts**: patched builds arrive through the panel's PHP packages; apply the panel update, confirm the per-site PHP version, restart PHP-FPM. On shared hosting, ask the host for their advisory.

## Stopgaps (partial; only until you can upgrade; restart workers after)

CVE-2026-109618:
- `memory_limit = -1` via `php_admin_value` in the FPM pool or Apache vhost.
- `post_max_size = 8M` if the app takes no uploads, `32M` if it does; `upload_max_filesize` below `post_max_size`.
- Do NOT use `RLIMIT_AS` / `RLIMIT_DATA` limits.

CVE-2026-109619:
- `session.upload_progress.enabled = 0` in php.ini or FPM pool `php_admin_value` (not `ini_set` or `.user.ini`).
- On 8.5: `fatal_error_backtraces = 0`.
- `pm.max_requests = 1` where performance allows.

The script reads these through the CLI binary and labels them `cli ini only`; FPM and Apache can load a different ini (Debian's CLI php.ini ships `memory_limit = -1`), so check the pool config and vhost too.

## Warnings

- Do not download or run circulating "PoCs": several are malware.
- Check only systems you own or are authorized to assess. `--url` sends one HEAD request; never point it at someone else's site.
- composer.lock, `composer audit` and dependency scanners will not flag this. Check the runtime.
