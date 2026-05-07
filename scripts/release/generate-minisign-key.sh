#!/usr/bin/env bash
# generate-minisign-key.sh — One-shot local generator for the Tauri Updater
# minisign keypair. Run ONCE by the maintainer; never run in CI.
#
# This produces:
#   ./minisign-priv.key  — KEEP SECRET. Goes into 1Password + GH Actions secret.
#   ./minisign-pub.txt   — Public verifier key. Paste into tauri.conf.json.
#
# After running this, you must:
#   1. Copy the contents of minisign-pub.txt into
#      src-tauri/tauri.conf.json under plugins.updater.pubkey
#      (replacing the <MINISIGN_PUBKEY_PLACEHOLDER> string).
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

if ! command -v minisign >/dev/null 2>&1; then
  echo "ERROR: minisign not installed." >&2
  echo "Install:" >&2
  echo "  macOS:    brew install minisign" >&2
  echo "  Linux:    sudo apt-get install minisign  # or build from https://jedisct1.github.io/minisign/" >&2
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

echo "Generating minisign keypair (you will be prompted for a passphrase) ..."
minisign -G -p "$PUB" -s "$PRIV"

echo
echo "==================================================================="
echo "Public key (paste into src-tauri/tauri.conf.json plugins.updater.pubkey):"
echo "==================================================================="
# tauri.conf.json wants the second line of the .pub file (the actual key),
# not the comment header. minisign-pub.txt has format:
#   untrusted comment: ...
#   <base64 pubkey>
tail -n1 "$PUB"
echo "==================================================================="
echo
echo "Private key written to:  $PRIV"
echo "Public key written to:   $PUB"
echo
echo "Next steps:"
echo "  1. Paste the pubkey above into tauri.conf.json (replace the placeholder)."
echo "  2. base64 -i $PRIV | tr -d '\\n' | pbcopy"
echo "     gh secret set TAURI_SIGNING_PRIVATE_KEY --body \"\$(pbpaste)\" --repo anton-abyzov/vskill"
echo "  3. gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body '<the passphrase>' --repo anton-abyzov/vskill"
echo "  4. Save private key + passphrase to 1Password (Family vault → vSkill)."
echo "  5. rm -P $PRIV   # macOS — overwrite then delete"
echo
echo "Optionally commit $PUB to the repo (it's the public verifier; safe to share)."
