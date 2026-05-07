# vSkill Desktop on Linux

vSkill Desktop ships three Linux package formats from a single build:

| Format       | Best for                                  | Auto-update?   |
|--------------|-------------------------------------------|----------------|
| `.AppImage`  | Recommended default — any modern distro   | Yes (in-place) |
| `.deb`       | Debian / Ubuntu / Pop!_OS / Mint           | Manual reinstall |
| `.rpm`       | Fedora / RHEL / openSUSE                   | Manual reinstall |

All three are GPG-signed (detached-armored) and accompanied by a single
`SHA256SUMS` aggregate that is also GPG-signed. Verify before installing.

## Supported distributions (v1)

| Distro              | Status            | Notes |
|---------------------|-------------------|-------|
| Ubuntu 22.04+       | Tested (.deb / AppImage) | LTS baseline. |
| Ubuntu 24.04        | Tested            | Inherits 22.04 build (glibc 2.35 lower bound). |
| Debian 12+          | Tested (.deb)     | Bookworm onwards. |
| Pop!_OS 22.04+      | Expected to work  | Ubuntu-derivative. |
| Linux Mint 21+      | Expected to work  | Ubuntu-derivative. |
| Fedora 40+          | Tested (.rpm / AppImage) | webkit2gtk4.1 native. |
| Fedora 41           | Tested            | |
| RHEL 9+ / Rocky 9+  | Tested (.rpm)     | |
| openSUSE Tumbleweed | Tested (AppImage) | rolling release. |

**Out of scope (v1)**: Ubuntu 20.04, Debian 11, RHEL 8, Fedora ≤39 — all ship
with `webkit2gtk-4.0` instead of `4.1` and cannot run vSkill Desktop. Either
upgrade or fall back to the web studio at https://verified-skill.com.

## Install

### `.deb` (Debian / Ubuntu)

```bash
sudo dpkg -i vSkill_*.deb
# If dpkg complains about missing deps:
sudo apt-get install -f
```

Uninstall:
```bash
sudo apt remove vskill
```

### `.rpm` (Fedora / RHEL / openSUSE)

```bash
# Fedora / Rocky / RHEL
sudo dnf install ./vSkill-*.rpm

# openSUSE
sudo zypper install ./vSkill-*.rpm

# Or with raw rpm:
sudo rpm -ivh ./vSkill-*.rpm
```

Uninstall:
```bash
sudo dnf remove vskill   # or: sudo rpm -e vskill
```

### `.AppImage` (any modern distro)

```bash
chmod +x vSkill_*.AppImage
./vSkill_*.AppImage
```

The AppImage is FUSE-mounted at runtime. Ubuntu 22.04+ needs `libfuse2`
installed (most distros include it; `sudo apt install libfuse2` if not).
For headless servers or sandboxes without FUSE, extract first:

```bash
./vSkill_*.AppImage --appimage-extract
./squashfs-root/AppRun
```

Uninstall: just delete the `.AppImage` file.

## Verify the GPG signature (recommended)

The vSkill release public key fingerprint is published at
**https://verified-skill.com/.well-known/pgp-key.asc** and mirrored to
**https://keys.openpgp.org**. The fingerprint will appear here once
ci-pipeline-agent generates and publishes the release key:

> **Fingerprint**: `<TBD — pending GPG key generation>`

Verification flow (one-time key import + every-download verify):

```bash
# 1) Import the vSkill release key (one-time per machine).
curl -fsSL https://verified-skill.com/.well-known/pgp-key.asc | gpg --import

# Or fetch from a key server with the fingerprint:
gpg --keyserver keys.openpgp.org --recv-keys <FINGERPRINT>

# 2) Download artifacts + SHA256SUMS + their .asc signatures.

# 3) Verify SHA256SUMS aggregate is signed by the vSkill key.
gpg --verify SHA256SUMS.asc SHA256SUMS

# 4) Verify each downloaded artifact's hash matches SHA256SUMS.
sha256sum -c SHA256SUMS

# 5) (Optional) Verify the per-file detached signature directly.
gpg --verify vSkill_*.AppImage.asc vSkill_*.AppImage
```

If `gpg --verify` says `Good signature from "vSkill Releases <releases@verified-skill.com>"`
and `sha256sum -c` prints `OK` for every line, the artifacts are authentic and
unmodified. If you see `BAD signature` or hash mismatch, do **not** install —
report it via https://github.com/anton-abyzov/vskill/security/advisories.

## Auto-update behavior

- **AppImage**: in-app updater downloads the new AppImage and replaces the
  current one in place. Restart the app to apply.
- **.deb / .rpm**: in-app updater fetches the new package and prompts you to
  run `sudo dpkg -i` or `sudo dnf install` to apply. We don't ship in our
  distros' repos, so unattended-upgrades won't pick us up.

If you want the smoothest update experience, use the AppImage.

## Known limitations (v1)

- **No aarch64 Linux build.** ARM64 Linux desktops are out of scope for the
  first release; deferred to a future increment. Use the web studio at
  https://verified-skill.com on ARM Linux.
- **No Snap, Flatpak, or distro-repo distribution.** GPG-signed direct
  download is the only Linux channel for v1 (per ADR 0829-02 — explicit
  user direction).
- **No automatic security backports via your distro's update daemon.** Run
  the in-app updater, or watch https://github.com/anton-abyzov/vskill/releases.
