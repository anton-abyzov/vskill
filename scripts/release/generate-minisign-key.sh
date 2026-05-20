#!/usr/bin/env bash
# generate-minisign-key.sh — One-shot local generator for the Tauri Updater
# minisign keypair. Run ONCE by the maintainer; never run in CI.
#
# This produces a Rust-minisign-compatible keypair:
#   ./minisign-priv.key  — KEEP SECRET. Goes into 1Password + GH Actions secret.
#   ./minisign-pub.txt   — Public verifier key file.
#
# After running this, you must:
#   1. Paste base64(full minisign-pub.txt file) into
#      src-tauri/tauri.conf.json under plugins.updater.pubkey.
#   2. base64-encode the private key + password into GH Actions secrets:
#         TAURI_SIGNING_PRIVATE_KEY           = base64 of minisign-priv.key
#         TAURI_SIGNING_PRIVATE_KEY_PASSWORD  = the passphrase you typed
#      Commands (macOS):
#         base64 -i minisign-priv.key | tr -d '\n' | pbcopy
#         gh secret set TAURI_SIGNING_PRIVATE_KEY --body "$(pbpaste)" --repo anton-abyzov/vskill
#   3. Store the private key + passphrase in 1Password (Family vault → vSkill).
#   4. Delete minisign-priv.key from your local disk:
#         shred -u minisign-priv.key   # Linux
#         rm -P minisign-priv.key      # macOS (overwrites then unlinks)
#
# DO NOT commit minisign-priv.key. .gitignore should already exclude *.key.

set -euo pipefail

if ! command -v rsign >/dev/null 2>&1; then
  echo "ERROR: rsign not installed." >&2
  echo "Install:" >&2
  echo "  cargo install rsign2" >&2
  exit 1
fi

OUT_DIR="$(pwd)"
PRIV="$OUT_DIR/minisign-priv.key"
PUB="$OUT_DIR/minisign-pub.txt"

if [[ -e "$PRIV" || -e "$PUB" ]]; then
  echo "ERROR: $PRIV or $PUB already exists. Refusing to overwrite." >&2
  echo "Move the existing keys aside first." >&2
  exit 1
fi

echo "Generating Rust minisign-compatible keypair (you will be prompted for a passphrase) ..."
rsign generate -p "$PUB" -s "$PRIV" -f

echo
echo "==================================================================="
echo "Public key (paste into src-tauri/tauri.conf.json plugins.updater.pubkey):"
echo "==================================================================="
# Tauri expects base64 of the full minisign.pub file contents, not the raw
# second-line key. This exact trap broke desktop-v1.0.13..v1.0.28.
base64 -i "$PUB" | tr -d '\n\r\t '
echo
echo "==================================================================="
echo
echo "Private key written to:  $PRIV"
echo "Public key written to:   $PUB"
echo
echo "Next steps:"
echo "  1. Paste the base64(full pub file) value above into tauri.conf.json."
echo "  2. base64 -i $PRIV | tr -d '\\n' | pbcopy"
echo "     gh secret set TAURI_SIGNING_PRIVATE_KEY --body \"\$(pbpaste)\" --repo anton-abyzov/vskill"
echo "  3. gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body '<the passphrase>' --repo anton-abyzov/vskill"
echo "  4. Save private key + passphrase to 1Password (Family vault → vSkill)."
echo "  5. rm -P $PRIV   # macOS — overwrite then delete"
echo
echo "Optionally commit $PUB to the repo (it's the public verifier; safe to share)."
