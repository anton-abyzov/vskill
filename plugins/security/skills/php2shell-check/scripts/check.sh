#!/bin/sh
# php2shell-check: is this machine / repo exposed to php2shell
# (CVE-2026-109618, CVE-2026-109619, disclosed 2026-10-21)?
#
# POSIX sh, macOS + Linux, no dependencies. Read-only and offline: it runs
# `php -v` (`frankenphp version`), `php -r` (ini_get only), local
# package-manager queries and installed changelogs, and optionally one
# `curl -sI` against a URL you pass. It never sends exploit payloads.
#
# Exit codes: 0 all patched, 1 any vulnerable, 2 unknown / nothing found,
#             3 backport possible only (distro package below upstream fix).
#
# Test hooks (env): PHP2SHELL_PATH replaces $PATH for binary discovery;
# PHP2SHELL_NO_SYSTEM_SCAN=1 skips well-known install dirs and FPM pools.

TOOL_VERSION="0.1.0"
CVE_A="CVE-2026-109618"
CVE_B="CVE-2026-109619"

usage() {
  cat <<'EOF'
Usage: check.sh [options]
  --php <path>       check this PHP binary (repeatable); skips auto-discovery
  --version <x.y.z>  judge a version string without a binary (repeatable)
  --repo <dir>       scan this project dir (default: current dir)
  --no-repo          skip the project scan
  --no-ini           skip the ini stopgap check
  --url <url>        read X-Powered-By from YOUR OWN site (one HEAD request)
  --json             machine-readable output
  -h, --help         this help
Exit: 0 patched, 1 vulnerable, 2 unknown/nothing found, 3 backport possible.
EOF
}

JSON=0; REPO="."; REPO_SET=0; DO_REPO=1; DO_INI=1; URL=""; EXPLICIT_PHP=""; EXPLICIT_VER=""
NL='
'
while [ $# -gt 0 ]; do
  case "$1" in
    --php) [ $# -ge 2 ] || { echo "--php needs a path" >&2; exit 2; }
           EXPLICIT_PHP="${EXPLICIT_PHP}$2${NL}"; shift 2 ;;
    --php=*) EXPLICIT_PHP="${EXPLICIT_PHP}${1#--php=}${NL}"; shift ;;
    --version) [ $# -ge 2 ] || { echo "--version needs x.y.z" >&2; exit 2; }
           EXPLICIT_VER="${EXPLICIT_VER}$2${NL}"; shift 2 ;;
    --version=*) EXPLICIT_VER="${EXPLICIT_VER}${1#--version=}${NL}"; shift ;;
    --repo) [ $# -ge 2 ] || { echo "--repo needs a dir" >&2; exit 2; }
            REPO="$2"; REPO_SET=1; shift 2 ;;
    --repo=*) REPO="${1#--repo=}"; REPO_SET=1; shift ;;
    --no-repo) DO_REPO=0; shift ;;
    --no-ini) DO_INI=0; shift ;;
    --url) [ $# -ge 2 ] || { echo "--url needs a URL" >&2; exit 2; }
           URL="$2"; shift 2 ;;
    --url=*) URL="${1#--url=}"; shift ;;
    --json) JSON=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t php2shell)
trap 'rm -rf "$TMP"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
RUNTIMES="$TMP/runtimes"; FINDINGS="$TMP/findings"; INI="$TMP/ini"; SEEN="$TMP/seen"
: > "$RUNTIMES"; : > "$FINDINGS"; : > "$INI"; : > "$SEEN"
TAB=$(printf '\t')
FS=$(printf '\037')  # record separator: empty fields survive read

# ---------------------------------------------------------------- verdicts
# verdict_for <version> -> sets V_VERDICT (PATCHED|VULNERABLE|UNKNOWN),
# V_FIX (upgrade target), V_NOTE, V_EOL (1 for 5.x-7.3: no fix exists).
verdict_for() {
  vf_v=$1
  V_VERDICT=UNKNOWN; V_FIX=""; V_NOTE=""; V_EOL=0
  vf_maj=$(printf '%s' "$vf_v" | sed -n 's/^\([0-9][0-9]*\)\..*/\1/p')
  vf_min=$(printf '%s' "$vf_v" | sed -n 's/^[0-9][0-9]*\.\([0-9][0-9]*\).*/\1/p')
  vf_pat=$(printf '%s' "$vf_v" | sed -n 's/^[0-9][0-9]*\.[0-9][0-9]*\.\([0-9][0-9]*\).*/\1/p')
  vf_rest=$(printf '%s' "$vf_v" | sed -n 's/^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*//p' | tr 'A-Z' 'a-z')
  if [ -z "$vf_maj" ] || [ -z "$vf_min" ]; then
    V_NOTE="cannot parse version"; return
  fi
  vf_pre=""; vf_rc=""
  vf_rest=${vf_rest#[-._]}   # 8.6.0-RC3, 8.4.27-dev, 8.4.27.rc1
  case "$vf_rest" in
    rc[0-9]*) vf_pre=rc; vf_rc=$(printf '%s' "$vf_rest" | sed 's/^rc\([0-9]*\).*/\1/') ;;
    alpha*|beta*|dev*) vf_pre=early ;;
  esac
  if [ "$vf_maj" -ge 9 ] || { [ "$vf_maj" -eq 8 ] && [ "$vf_min" -ge 7 ]; }; then
    V_VERDICT=PATCHED; V_FIX="-"; return
  fi
  if [ "$vf_maj" -eq 8 ] && [ "$vf_min" -eq 6 ]; then
    V_FIX="8.6.0RC4"
    if [ -z "$vf_pat" ]; then
      V_NOTE="branch only, exact pre-release unknown"; return
    fi
    if [ "$vf_pat" -ge 1 ]; then V_VERDICT=PATCHED; return; fi
    case "$vf_pre" in
      rc) if [ "${vf_rc:-0}" -ge 4 ]; then V_VERDICT=PATCHED; else
            V_VERDICT=VULNERABLE; V_NOTE="pre-release before 8.6.0RC4"; fi ;;
      early) V_VERDICT=VULNERABLE; V_NOTE="pre-release before 8.6.0RC4" ;;
      *) V_VERDICT=PATCHED ;;
    esac
    return
  fi
  vf_fixpat=""
  if [ "$vf_maj" -eq 8 ]; then
    case "$vf_min" in
      5) vf_fixpat=12 ;; 4) vf_fixpat=27 ;; 3) vf_fixpat=36 ;; 2) vf_fixpat=35 ;;
    esac
  fi
  if [ -n "$vf_fixpat" ]; then
    V_FIX="8.$vf_min.$vf_fixpat"
    if [ -z "$vf_pat" ]; then
      V_NOTE="branch only, exact patch level unknown"; return
    fi
    if [ "$vf_pat" -gt "$vf_fixpat" ]; then V_VERDICT=PATCHED
    elif [ "$vf_pat" -eq "$vf_fixpat" ]; then
      if [ -n "$vf_pre" ]; then
        V_VERDICT=VULNERABLE; V_NOTE="pre-release build before the $V_FIX release"
      else V_VERDICT=PATCHED; fi
    else V_VERDICT=VULNERABLE; fi
    return
  fi
  if { [ "$vf_maj" -eq 8 ] && [ "$vf_min" -le 1 ]; } || { [ "$vf_maj" -eq 7 ] && [ "$vf_min" -eq 4 ]; }; then
    V_VERDICT=VULNERABLE; V_FIX="8.2.35+ (or a vendor backport)"
    V_NOTE="no official upstream release for $vf_maj.$vf_min; only distro/LTS vendor backports or the PHP security team source patches fix it"
    return
  fi
  V_VERDICT=VULNERABLE; V_FIX="8.2.35+"; V_EOL=1
  V_NOTE="EOL branch $vf_maj.$vf_min: no fix exists, upgrade to a supported branch"
}

# run a discovered binary: no stdin (lsphp/php-cgi may wait on it), bounded time
run_bin() {
  if command -v timeout >/dev/null 2>&1; then timeout 10 "$@" </dev/null
  elif command -v gtimeout >/dev/null 2>&1; then gtimeout 10 "$@" </dev/null
  else "$@" </dev/null; fi
}

# "FrankenPHP v1.9.0 PHP 8.4.27 Caddy v2.10.0 ..." -> "8.4.27"
version_of_frankenphp() {
  printf '%s' "$1" | sed -n 's/.*[[:space:]]PHP[[:space:]]\{1,\}\([0-9][^[:space:]]*\).*/\1/p'
}

# strip "PHP 8.2.7-1~deb12u1 (cli) ..." -> "8.2.7-1~deb12u1"
version_of_line() {
  printf '%s' "$1" | sed -n 's/^PHP[[:space:]]\{1,\}\([0-9][^[:space:]]*\).*/\1/p'
}
sapi_of_line() {
  printf '%s' "$1" | sed -n 's/^PHP[[:space:]]\{1,\}[^[:space:]]*[[:space:]]\{1,\}(\([^)]*\)).*/\1/p'
}

# portable symlink resolution (no readlink -f on older macOS)
resolve_path() {
  rp_p=$1; rp_n=0
  while [ -L "$rp_p" ] && [ $rp_n -lt 20 ]; do
    rp_t=$(readlink "$rp_p")
    case "$rp_t" in /*) rp_p=$rp_t ;; *) rp_p=$(dirname "$rp_p")/$rp_t ;; esac
    rp_n=$((rp_n + 1))
  done
  rp_d=$(cd "$(dirname "$rp_p")" 2>/dev/null && pwd -P) || rp_d=$(dirname "$rp_p")
  printf '%s/%s' "$rp_d" "$(basename "$rp_p")"
}

# package_check <path> -> sets P_PKG, P_MGR, P_BACKPORT (yes|no|unknown)
package_check() {
  P_PKG=""; P_MGR=""; P_BACKPORT=unknown; pc_log=""
  pc_path=$1
  if command -v dpkg >/dev/null 2>&1; then
    P_PKG=$(dpkg -S "$pc_path" 2>/dev/null | head -n 1 | sed 's/:.*//')
    if [ -n "$P_PKG" ]; then
      P_MGR=dpkg
      for pc_f in /usr/share/doc/"$P_PKG"/changelog.Debian.gz /usr/share/doc/"$P_PKG"/changelog.gz; do
        [ -r "$pc_f" ] && { pc_log=$(gzip -dc "$pc_f" 2>/dev/null); break; }
      done
      # no `apt-get changelog` fallback: it is a network call and returns the
      # newest available version's changelog, not the installed one's.
    fi
  fi
  if [ -z "$P_PKG" ] && command -v rpm >/dev/null 2>&1; then
    pc_out=$(rpm -qf "$pc_path" 2>/dev/null | head -n 1)
    case "$pc_out" in ""|*"not owned"*|*"No such"*) ;; *)
      P_PKG=$pc_out; P_MGR=rpm
      pc_log=$(rpm -q --changelog "$P_PKG" 2>/dev/null) ;;
    esac
  fi
  if [ -z "$P_PKG" ] && command -v apk >/dev/null 2>&1; then
    pc_out=$(apk info --who-owns "$pc_path" 2>/dev/null | sed -n 's/.* is owned by //p' | head -n 1)
    [ -n "$pc_out" ] && { P_PKG=$pc_out; P_MGR=apk; }
  fi
  [ -z "$P_PKG" ] && return
  if [ -n "$pc_log" ]; then
    if printf '%s' "$pc_log" | grep -q "$CVE_A"; then P_BACKPORT=yes; else P_BACKPORT=no; fi
  fi
}

esc() { printf '%s' "$1" | tr '\t\n\r\037' '    '; }

# add_runtime source path sapi version verdict fix package note
add_runtime() {
  printf '%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\n' "$(esc "$1")" "$(esc "$2")" "$(esc "$3")" \
    "$(esc "$4")" "$(esc "$5")" "$(esc "$6")" "$(esc "$7")" "$(esc "$8")" >> "$RUNTIMES"
}
# add_finding file kind value verdict counts(yes|no) note
add_finding() {
  printf '%s\037%s\037%s\037%s\037%s\037%s\n' "$(esc "$1")" "$(esc "$2")" "$(esc "$3")" \
    "$(esc "$4")" "$(esc "$5")" "$(esc "$6")" >> "$FINDINGS"
}

# ---------------------------------------------------------------- binaries
check_binary() {
  cb_bin=$1
  [ -x "$cb_bin" ] || { add_runtime binary "$cb_bin" "" "" UNKNOWN "" "" "not executable"; return; }
  cb_real=$(resolve_path "$cb_bin")
  if grep -qxF "$cb_real" "$SEEN" 2>/dev/null; then return; fi
  printf '%s\n' "$cb_real" >> "$SEEN"
  case "$(basename "$cb_bin")" in
    frankenphp*)
      cb_line=$(run_bin "$cb_bin" version 2>/dev/null | grep 'PHP[[:space:]][[:space:]]*[0-9]' | head -n 1)
      cb_ver=$(version_of_frankenphp "$cb_line"); cb_sapi=frankenphp ;;
    *)
      # first "PHP x.y" line: startup warnings may come before it
      cb_line=$(run_bin "$cb_bin" -v 2>/dev/null | grep '^PHP[[:space:]][[:space:]]*[0-9]' | head -n 1)
      cb_ver=$(version_of_line "$cb_line")
      cb_sapi=$(sapi_of_line "$cb_line") ;;
  esac
  if [ -z "$cb_ver" ]; then
    add_runtime binary "$cb_bin" "$cb_sapi" "" UNKNOWN "" "" "could not read version"; return
  fi
  verdict_for "$cb_ver"
  cb_verdict=$V_VERDICT; cb_note=$V_NOTE; cb_pkgdesc=""
  if [ "$cb_verdict" = VULNERABLE ]; then
    package_check "$cb_real"
    if [ -n "$P_PKG" ]; then
      cb_pkgdesc="$P_MGR:$P_PKG"
      cb_bp=$P_BACKPORT
      # 5.x-7.3: EOL, no fix exists; a distro version string does not soften that
      [ "$V_EOL" = 1 ] && cb_bp=eol
      # Alpine packages track upstream version numbers: below the fix is below the fix
      [ "$P_MGR" = apk ] && [ "$cb_bp" = unknown ] && cb_bp=apk
      case "$cb_bp" in
        eol) cb_note="$V_NOTE; the distro package does not change that" ;;
        apk) cb_note="Alpine packages follow upstream version numbers: apk upgrade to the fixed release" ;;
        yes) cb_verdict=PATCHED-BACKPORT
             cb_note="package changelog lists $CVE_A; vendor backport under the old version string" ;;
        no)  cb_verdict=BACKPORT-POSSIBLE
             cb_note="distro package; changelog does not mention $CVE_A yet: update the package and recheck" ;;
        *)   cb_verdict=BACKPORT-POSSIBLE
             cb_note="distro package; vendors patch under the old version string, check your distro advisory" ;;
      esac
    fi
  fi
  add_runtime binary "$cb_bin" "$cb_sapi" "$cb_ver" "$cb_verdict" "$V_FIX" "$cb_pkgdesc" "$cb_note"
  if [ "$DO_INI" = 1 ]; then
    case "$cb_sapi" in
      fpm*|frankenphp) ;; # no -r here; FPM pool config checked separately
      *) check_ini "$cb_bin" "$cb_ver" ;;
    esac
  fi
}

discover() {
  dc_list=""
  dc_names="php php-fpm php-cgi php-fpm8.5 php-fpm8.4 php-fpm8.3 php-fpm8.2 php-fpm8.1 php-fpm8.0 php-fpm7.4 php8.5 php8.4 php8.3 php8.2 php8.1 php8.0 php7.4 frankenphp"
  dc_oldifs=$IFS; IFS=:
  for dc_dir in ${PHP2SHELL_PATH:-$PATH}; do
    IFS=$dc_oldifs
    [ -n "$dc_dir" ] || continue
    for dc_n in $dc_names; do
      [ -f "$dc_dir/$dc_n" ] && [ -x "$dc_dir/$dc_n" ] && dc_list="$dc_list$dc_dir/$dc_n$NL"
    done
    IFS=:
  done
  IFS=$dc_oldifs
  if [ "${PHP2SHELL_NO_SYSTEM_SCAN:-0}" != 1 ]; then
    for dc_f in /usr/sbin/php-fpm* /usr/local/sbin/php-fpm* /usr/bin/php[0-9]* /usr/bin/php-cgi* \
                /usr/local/bin/php /opt/homebrew/bin/php /opt/homebrew/sbin/php-fpm \
                /opt/homebrew/opt/php*/bin/php /opt/homebrew/opt/php*/sbin/php-fpm \
                /usr/local/opt/php*/bin/php /usr/local/opt/php*/sbin/php-fpm \
                /opt/remi/php*/root/usr/sbin/php-fpm /opt/remi/php*/root/usr/bin/php \
                /opt/cpanel/ea-php*/root/usr/sbin/php-fpm /opt/cpanel/ea-php*/root/usr/bin/php \
                /opt/plesk/php/*/sbin/php-fpm /opt/plesk/php/*/bin/php \
                /usr/local/lsws/lsphp*/bin/lsphp /usr/local/lsws/lsphp*/bin/php \
                /usr/local/bin/frankenphp; do
      [ -f "$dc_f" ] && [ -x "$dc_f" ] && dc_list="$dc_list$dc_f$NL"
    done
  fi
  printf '%s' "$dc_list"
}

# ---------------------------------------------------------------- ini
to_bytes() {
  printf '%s' "$1" | awk '{
    v=$0; m=1; u=toupper(substr(v,length(v),1));
    if (u=="K") m=1024; else if (u=="M") m=1048576; else if (u=="G") m=1073741824;
    if (m>1) v=substr(v,1,length(v)-1);
    printf "%d", v*m }'
}

check_ini() {
  ci_bin=$1; ci_ver=$2
  ci_out=$(run_bin "$ci_bin" -r 'foreach(array("memory_limit","post_max_size","upload_max_filesize","session.upload_progress.enabled","fatal_error_backtraces","file_uploads") as $k){$v=ini_get($k); echo $k,"=",($v===false?"(unset)":$v),"\n";}' 2>/dev/null)
  [ -n "$ci_out" ] || return
  ci_post=""; ci_upl=""; ci_fu=""
  printf '%s\n' "$ci_out" | while IFS='=' read -r ci_k ci_v; do
    [ -n "$ci_k" ] || continue
    printf '%s\t%s\t%s\n' "$ci_bin" "$ci_k" "$ci_v" >> "$INI.raw"
  done
  [ -f "$INI.raw" ] || return
  get_ini() { awk -F'\t' -v b="$ci_bin" -v k="$1" '$1==b && $2==k {print $3}' "$INI.raw" | tail -n 1; }
  ci_mem=$(get_ini memory_limit); ci_post=$(get_ini post_max_size); ci_upl=$(get_ini upload_max_filesize)
  ci_sup=$(get_ini session.upload_progress.enabled); ci_feb=$(get_ini fatal_error_backtraces)
  ci_fu=$(get_ini file_uploads)
  ci_src="$ci_bin, cli ini only"
  if [ -n "$ci_mem" ]; then
    if [ "$ci_mem" = "-1" ]; then add_ini "$ci_src" memory_limit "$ci_mem" ok "matches the $CVE_A stopgap in the CLI ini only; the FPM pool / Apache vhost may differ"
    else add_ini "$ci_src" memory_limit "$ci_mem" stopgap "$CVE_A stopgap: php_admin_value[memory_limit] = -1 in the web SAPI config (never RLIMIT_AS/RLIMIT_DATA)"; fi
  fi
  if [ -n "$ci_post" ]; then
    ci_pb=$(to_bytes "$ci_post")
    case "$ci_fu" in 1|On|on) ci_cap=33554432; ci_capt=32M ;; *) ci_cap=8388608; ci_capt=8M ;; esac
    if [ "$ci_pb" -eq 0 ] || [ "$ci_pb" -gt "$ci_cap" ]; then
      add_ini "$ci_src" post_max_size "$ci_post" stopgap "$CVE_A stopgap: post_max_size = 8M without uploads, 32M with uploads (now $ci_post)"
    else add_ini "$ci_src" post_max_size "$ci_post" ok "within the stopgap cap ($ci_capt)"; fi
    if [ -n "$ci_upl" ]; then
      ci_ub=$(to_bytes "$ci_upl")
      if [ "$ci_ub" -ge "$ci_pb" ] && [ "$ci_pb" -gt 0 ]; then
        add_ini "$ci_src" upload_max_filesize "$ci_upl" stopgap "keep upload_max_filesize below post_max_size"
      else add_ini "$ci_src" upload_max_filesize "$ci_upl" ok "below post_max_size"; fi
    fi
  fi
  case "$ci_sup" in
    1|On|on) add_ini "$ci_src" session.upload_progress.enabled "$ci_sup" stopgap "$CVE_B stopgap: session.upload_progress.enabled = 0 in php.ini or FPM pool php_admin_value (not ini_set/.user.ini)" ;;
    "") ;;
    *) add_ini "$ci_src" session.upload_progress.enabled "$ci_sup" ok "disabled" ;;
  esac
  case "$ci_ver" in 8.5.*|8.5)
    case "$ci_feb" in
      1|On|on) add_ini "$ci_src" fatal_error_backtraces "$ci_feb" stopgap "$CVE_B stopgap on 8.5: fatal_error_backtraces = 0" ;;
      "(unset)"|"") ;;
      *) add_ini "$ci_src" fatal_error_backtraces "$ci_feb" ok "disabled" ;;
    esac ;;
  esac
}
add_ini() {
  printf '%s\037%s\037%s\037%s\037%s\n' "$(esc "$1")" "$(esc "$2")" "$(esc "$3")" "$(esc "$4")" "$(esc "$5")" >> "$INI"
}

check_fpm_pools() {
  [ "${PHP2SHELL_NO_SYSTEM_SCAN:-0}" = 1 ] && return
  for cp_f in /etc/php/*/fpm/pool.d/*.conf /etc/php-fpm.d/*.conf /usr/local/etc/php-fpm.d/*.conf \
              /opt/homebrew/etc/php/*/php-fpm.d/*.conf /usr/local/etc/php/*/php-fpm.d/*.conf \
              /etc/opt/remi/php*/php-fpm.d/*.conf; do
    [ -r "$cp_f" ] || continue
    if grep -Eiq '^[[:space:]]*php_admin_(value|flag)\[session\.upload_progress\.enabled\][[:space:]]*=[[:space:]]*"?(0|off|false|no)"?[[:space:]]*(;.*)?$' "$cp_f"; then
      add_ini "$cp_f" session.upload_progress.enabled 0 ok "pool disables upload progress"
    else
      add_ini "$cp_f" session.upload_progress.enabled "(pool default)" stopgap "$CVE_B stopgap: add php_admin_value[session.upload_progress.enabled] = 0 and restart FPM"
    fi
  done
}

# ---------------------------------------------------------------- repo scan
judge_tag_version() {
  # judge_tag_version <file> <kind> <value> <version-or-empty> <counts>
  jt_file=$1; jt_kind=$2; jt_val=$3; jt_ver=$4; jt_counts=$5
  if [ -z "$jt_ver" ]; then
    add_finding "$jt_file" "$jt_kind" "$jt_val" FLOATING no "floating tag: patched only if pulled and rebuilt after 2026-10-21 (docker build --pull --no-cache); pin an exact fixed tag"
    return
  fi
  verdict_for "$jt_ver"
  case "$V_VERDICT" in
    UNKNOWN)
      if [ -n "$V_FIX" ]; then
        add_finding "$jt_file" "$jt_kind" "$jt_val" FLOATING no "branch tag $jt_ver: patched only if pulled/rebuilt after 2026-10-21; pin $V_FIX or newer"
      else add_finding "$jt_file" "$jt_kind" "$jt_val" UNKNOWN no "$V_NOTE"; fi ;;
    *) jt_note="fix: $V_FIX"; [ -n "$V_NOTE" ] && jt_note="$jt_note; $V_NOTE"
       [ "$V_VERDICT" = PATCHED ] && jt_note="at or above the fix"
       add_finding "$jt_file" "$jt_kind" "$jt_val" "$V_VERDICT" "$jt_counts" "$jt_note" ;;
  esac
}

image_finding() {
  # image_finding <file> <image-ref>
  if_file=$1; if_img=$2
  if_ref=${if_img%%@*}   # php:8.3.10-fpm@sha256:... -> php:8.3.10-fpm
  case "$if_ref" in
    php:*|*/php:*) ;;
    php|*/php)
      if [ "$if_ref" != "$if_img" ]; then
        add_finding "$if_file" docker-image "$if_img" UNKNOWN no "pinned by digest only: run 'docker run --rm <image> php -v' to read its version"
      else judge_tag_version "$if_file" docker-image "$if_img" "" yes; fi
      return ;;
    *) return ;;
  esac
  case "$if_ref" in
    php:*|library/php:*|docker.io/library/php:*|docker.io/php:*) ;;
    *) return ;;  # some other org's php image: not the official one
  esac
  if_tag=${if_ref##*:}
  case "$if_tag" in *'$'*) add_finding "$if_file" docker-image "$if_img" UNKNOWN no "tag comes from a build ARG; resolve it and rerun"; return ;; esac
  if_ver=$(printf '%s' "$if_tag" | sed -n 's/^\([0-9][0-9.]*\)\(RC[0-9][0-9]*\)\{0,1\}.*/\1\2/p' | sed 's/\.$//')
  judge_tag_version "$if_file" docker-image "$if_img" "$if_ver" yes
}

scan_repo() {
  sr_dir=$1
  [ -d "$sr_dir" ] || { add_finding "$sr_dir" repo "" UNKNOWN no "repo dir not found"; return; }
  find "$sr_dir" \( -name node_modules -o -name vendor -o -name .git -o -name dist -o -name build \) -prune -o \
       -type f \( -name 'Dockerfile*' -o -name '*.Dockerfile' -o -name '*.dockerfile' -o -name 'Containerfile*' \
       -o -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' -o -name 'compose*.yml' -o -name 'compose*.yaml' \
       -o -name '.php-version' -o -name '.tool-versions' -o -name composer.json \) -print 2>/dev/null > "$TMP/files"
  if [ -d "$sr_dir/.github/workflows" ]; then
    find "$sr_dir/.github/workflows" -type f \( -name '*.yml' -o -name '*.yaml' \) -print 2>/dev/null >> "$TMP/files"
  fi
  while IFS= read -r sr_f; do
    sr_rel=${sr_f#"$sr_dir"/}
    case "$sr_f" in
      */.github/workflows/*)
        grep -E '^[[:space:]]*-?[[:space:]]*php-version[[:space:]]*:' "$sr_f" 2>/dev/null | while IFS= read -r sr_l; do
          sr_v=$(printf '%s' "$sr_l" | sed 's/^[^:]*:[[:space:]]*//; s/[[:space:]]*#.*$//; s/["'\'']//g')
          add_finding "$sr_rel" ci-setup-php "$sr_v" INFO no "CI runtime only, not the attack surface; keep it on a fixed patch level"
        done ;;
      */Dockerfile*|*.Dockerfile|*.dockerfile|*/Containerfile*)
        grep -iE '^[[:space:]]*FROM[[:space:]]' "$sr_f" 2>/dev/null | while IFS= read -r sr_l; do
          sr_img=$(printf '%s' "$sr_l" | awk '{for(i=2;i<=NF;i++){ if ($i ~ /^--/) continue; print $i; exit }}')
          image_finding "$sr_rel" "$sr_img"
        done ;;
      *compose*.yml|*compose*.yaml)
        grep -E '^[[:space:]]*image[[:space:]]*:' "$sr_f" 2>/dev/null | while IFS= read -r sr_l; do
          sr_img=$(printf '%s' "$sr_l" | sed 's/^[^:]*:[[:space:]]*//; s/[[:space:]]*#.*$//; s/["'\'']//g; s/[[:space:]]*$//')
          image_finding "$sr_rel" "$sr_img"
        done ;;
      */.php-version)
        sr_v=$(head -n 1 "$sr_f" | tr -d ' \r\t')
        [ -n "$sr_v" ] && judge_tag_version "$sr_rel" php-version "$sr_v" "$sr_v" yes ;;
      */.tool-versions)
        sr_v=$(awk '$1=="php"{print $2; exit}' "$sr_f")
        [ -n "$sr_v" ] && judge_tag_version "$sr_rel" tool-versions "php $sr_v" "$sr_v" yes ;;
      */composer.json) scan_composer "$sr_f" "$sr_rel" ;;
    esac
  done < "$TMP/files"
}

scan_composer() {
  sc_f=$1; sc_rel=$2
  awk '
  { buf = buf $0 "\n" }
  END {
    n = length(buf); depth = 0; mode = "val"; key = ""
    for (i = 1; i <= n; i++) {
      c = substr(buf, i, 1)
      if (c == "\"") {
        s = ""; i++
        while (i <= n) {
          c = substr(buf, i, 1)
          if (c == "\\") { s = s substr(buf, i + 1, 1); i += 2; continue }
          if (c == "\"") break
          s = s c; i++
        }
        if (mode == "key") key = s
        else if (obj[depth] && key == "php") {
          if (depth == 2 && name[2] == "require") print "require\t" s
          if (depth == 3 && name[2] == "config" && name[3] == "platform") print "platform\t" s
        }
      } else if (c == "{") { depth++; name[depth] = key; obj[depth] = 1; mode = "key" }
      else if (c == "[") { depth++; name[depth] = key; obj[depth] = 0; mode = "val" }
      else if (c == "}" || c == "]") { depth--; mode = "val" }
      else if (c == ":") mode = "val"
      else if (c == ",") mode = obj[depth] ? "key" : "val"
    }
  }' "$sc_f" 2>/dev/null | while IFS="$TAB" read -r sc_kind sc_val; do
    case "$sc_kind" in
      require)
        sc_min=$(printf '%s' "$sc_val" | grep -oE '[0-9]+\.[0-9]+' | sort -t. -k1,1n -k2,2n | head -n 1)
        sc_note="composer constraint, not the runtime: the deployed PHP decides"
        case "$sc_min" in
          5.*|7.*|8.0|8.1) sc_note="$sc_note; it allows $sc_min, which has no official fix, so require ^8.2 where you can" ;;
        esac
        add_finding "$sc_rel" composer-require-php "$sc_val" INFO no "$sc_note" ;;
      platform)
        verdict_for "$sc_val"
        add_finding "$sc_rel" composer-platform-php "$sc_val" INFO no "config.platform.php pins the version Composer assumes ($V_VERDICT for that runtime, fix $V_FIX); it does not change the runtime" ;;
    esac
  done
}

# ---------------------------------------------------------------- url
check_url() {
  cu_u=$1
  case "$cu_u" in http://*|https://*) ;; *) cu_u="https://$cu_u" ;; esac
  if ! command -v curl >/dev/null 2>&1; then
    add_runtime url "$cu_u" "" "" UNKNOWN "" "" "curl not installed"; return
  fi
  cu_h=$(curl -sI -m 15 -A "php2shell-check/$TOOL_VERSION" "$cu_u" 2>/dev/null | tr -d '\r')
  if [ -z "$cu_h" ]; then add_runtime url "$cu_u" "" "" UNKNOWN "" "" "no response"; return; fi
  cu_xpb=$(printf '%s\n' "$cu_h" | grep -i '^x-powered-by:' | head -n 1 | sed 's/^[^:]*:[[:space:]]*//')
  cu_ver=$(printf '%s' "$cu_xpb" | sed -n 's/.*PHP\/\([0-9][0-9A-Za-z.~+-]*\).*/\1/p')
  if [ -z "$cu_ver" ]; then
    add_runtime url "$cu_u" "" "" UNKNOWN "" "" "no PHP version in headers (hidden is not safe: run this script on the server)"
    return
  fi
  verdict_for "$cu_ver"
  cu_v=$V_VERDICT; cu_note="from X-Powered-By: $cu_xpb"
  if [ "$cu_v" = VULNERABLE ] && [ "$V_EOL" != 1 ]; then
    case "$cu_ver" in *-*|*deb*|*ubuntu*|*el[0-9]*)
      cu_v=BACKPORT-POSSIBLE; cu_note="$cu_note; distro build string, verify on the server" ;;
    esac
  fi
  add_runtime url "$cu_u" "" "$cu_ver" "$cu_v" "$V_FIX" "" "$cu_note"
}

# ---------------------------------------------------------------- run
if [ -n "$EXPLICIT_PHP" ]; then
  printf '%s' "$EXPLICIT_PHP" | while IFS= read -r ep; do [ -n "$ep" ] && check_binary "$ep"; done
elif [ -z "$EXPLICIT_VER" ]; then
  discover > "$TMP/bins"
  while IFS= read -r db; do [ -n "$db" ] && check_binary "$db"; done < "$TMP/bins"
  [ "$DO_INI" = 1 ] && check_fpm_pools
fi
if [ -n "$EXPLICIT_VER" ]; then
  printf '%s' "$EXPLICIT_VER" | while IFS= read -r ev; do
    [ -n "$ev" ] || continue
    verdict_for "$ev"
    add_runtime manual "--version" "" "$ev" "$V_VERDICT" "$V_FIX" "" "$V_NOTE"
  done
fi
if [ "$DO_REPO" = 1 ]; then
  RP=$(cd "$REPO" 2>/dev/null && pwd -P || printf '%s' "$REPO")
  HP=$(cd "${HOME:-/nonexistent}" 2>/dev/null && pwd -P || printf '%s' "${HOME:-}")
  if [ "$REPO_SET" = 0 ] && { [ "$RP" = / ] || [ "$RP" = "$HP" ]; }; then
    add_finding "$RP" repo "" UNKNOWN no "skipped: current dir $RP is not a project; pass --repo <dir> or --no-repo"
  else scan_repo "$RP"; fi
fi
[ -n "$URL" ] && check_url "$URL"

# overall verdict: runtimes + counted repo findings
{ cut -d "$FS" -f5 "$RUNTIMES"; awk -F "$FS" '$5=="yes"{print $4}' "$FINDINGS"; } > "$TMP/verdicts"
if grep -qx VULNERABLE "$TMP/verdicts"; then OVERALL=VULNERABLE; RC=1
elif grep -qx BACKPORT-POSSIBLE "$TMP/verdicts"; then OVERALL=BACKPORT-POSSIBLE; RC=3
elif grep -qE '^PATCHED' "$TMP/verdicts"; then OVERALL=PATCHED; RC=0
else OVERALL=UNKNOWN; RC=2; fi
NRT=$(wc -l < "$RUNTIMES" | tr -d ' ')

# ---------------------------------------------------------------- output
json_str() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}
if [ "$JSON" = 1 ]; then
  printf '{"tool":"php2shell-check","tool_version":"%s","cves":["%s","%s"],' "$TOOL_VERSION" "$CVE_A" "$CVE_B"
  printf '"verdict":"%s","exit_code":%s,"runtimes":[' "$OVERALL" "$RC"
  sep=""
  while IFS="$FS" read -r a b c d e f g h; do
    printf '%s{"source":%s,"path":%s,"sapi":%s,"version":%s,"verdict":%s,"fixed_in":%s,"package":%s,"note":%s}' \
      "$sep" "$(json_str "$a")" "$(json_str "$b")" "$(json_str "$c")" "$(json_str "$d")" \
      "$(json_str "$e")" "$(json_str "$f")" "$(json_str "$g")" "$(json_str "$h")"
    sep=","
  done < "$RUNTIMES"
  printf '],"repo_findings":['
  sep=""
  while IFS="$FS" read -r a b c d e f; do
    cnt=false; [ "$e" = yes ] && cnt=true
    printf '%s{"file":%s,"kind":%s,"value":%s,"verdict":%s,"counts_toward_verdict":%s,"note":%s}' \
      "$sep" "$(json_str "$a")" "$(json_str "$b")" "$(json_str "$c")" "$(json_str "$d")" "$cnt" "$(json_str "$f")"
    sep=","
  done < "$FINDINGS"
  printf '],"ini":['
  sep=""
  while IFS="$FS" read -r a b c d e; do
    printf '%s{"source":%s,"key":%s,"value":%s,"status":%s,"advice":%s}' \
      "$sep" "$(json_str "$a")" "$(json_str "$b")" "$(json_str "$c")" "$(json_str "$d")" "$(json_str "$e")"
    sep=","
  done < "$INI"
  printf ']}\n'
  exit $RC
fi

echo "php2shell check ($CVE_A, $CVE_B), tool $TOOL_VERSION"
echo
echo "Runtimes:"
if [ "$NRT" -eq 0 ]; then echo "  (no PHP binary found)"; fi
while IFS="$FS" read -r a b c d e f g h; do
  line="  [$e] $b"
  [ -n "$d" ] && line="$line  PHP $d"
  [ -n "$c" ] && line="$line ($c)"
  [ -n "$f" ] && [ "$f" != "-" ] && [ "$e" != PATCHED ] && line="$line  fix: $f"
  [ -n "$g" ] && line="$line  pkg: $g"
  echo "$line"
  [ -n "$h" ] && echo "      $h"
done < "$RUNTIMES"
if [ "$DO_REPO" = 1 ]; then
  echo
  echo "Repo findings ($REPO):"
  if [ ! -s "$FINDINGS" ]; then echo "  (none)"; fi
  while IFS="$FS" read -r a b c d e f; do
    echo "  [$d] $a: $b $c"
    [ -n "$f" ] && echo "      $f"
  done < "$FINDINGS"
fi
if [ -s "$INI" ]; then
  echo
  echo "Ini stopgaps (CLI ini can differ from FPM/Apache ini; check the web SAPI too):"
  while IFS="$FS" read -r a b c d e; do
    echo "  [$d] $b = $c  ($a)"
    [ "$d" = stopgap ] && echo "      $e"
  done < "$INI"
fi
echo
echo "Overall: $OVERALL (exit $RC)"
case "$OVERALL" in
  VULNERABLE) echo "Upgrade to 8.2.35 / 8.3.36 / 8.4.27 / 8.5.12 (or 8.6.0RC4+), restart every PHP worker. Fix plan: SKILL.md." ;;
  BACKPORT-POSSIBLE) echo "Distro package below the upstream fix: update it from your vendor, confirm the advisory, restart workers." ;;
  PATCHED) echo "Patched. Make sure FPM/Apache/FrankenPHP workers were restarted after the upgrade." ;;
  UNKNOWN) echo "Nothing conclusive. Run on the server that serves PHP, or pass --php <path> / --version <x.y.z>." ;;
esac
exit $RC
