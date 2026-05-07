# vSkill Desktop on Windows

This document covers two audiences:
1. **End users** — installing vSkill Desktop and getting past the SmartScreen warning.
2. **Contributors** — building the `.msi` from source on a Windows host.

---

## 1. Installing vSkill Desktop on Windows (end users)

### 1.1 Download

Download the latest `.msi` from
[GitHub Releases](https://github.com/anton-abyzov/vskill/releases/latest)
or from the official landing page at
[verified-skill.com/desktop](https://verified-skill.com/desktop).

Each release ships:

| File | Purpose |
|---|---|
| `vskill_<version>_x64_en-US.msi` | The Windows installer. |
| `vskill_<version>_x64_en-US.msi.sha256` | SHA256 checksum. |
| `vskill_<version>_x64_en-US.msi.asc` | GPG detached signature. |
| `SHA256SUMS` + `SHA256SUMS.asc` | Aggregate checksums for all platforms (including Windows). |

### 1.2 Verify the download (recommended)

vSkill v1 ships **unsigned** for Windows (no Authenticode signature). To stay
safe, verify the SHA256 and GPG signature before installing.

#### SHA256 verification (PowerShell)

```powershell
# Compare the published checksum against your downloaded file
Get-FileHash -Algorithm SHA256 .\vskill_1.0.0_x64_en-US.msi
# The output must match the value in vskill_1.0.0_x64_en-US.msi.sha256
```

#### GPG verification (optional, recommended)

```powershell
# 1. Import the vSkill release GPG public key (one-time setup)
Invoke-WebRequest https://verified-skill.com/.well-known/pgp-key.asc -OutFile vskill-pubkey.asc
gpg --import vskill-pubkey.asc

# 2. Verify the signature
gpg --verify .\vskill_1.0.0_x64_en-US.msi.asc .\vskill_1.0.0_x64_en-US.msi
# Look for: "Good signature from vSkill Releases <releases@verified-skill.com>"
```

The fingerprint is published at <https://verified-skill.com/security>.

### 1.3 SmartScreen warning — "Windows protected your PC"

Because the `.msi` is unsigned in v1, Windows Defender SmartScreen will show
"Windows protected your PC" the first time you run it. **This is expected and
not a sign of malware** — once you have verified the SHA256/GPG signature
above, the file is authentic. Two ways to proceed:

#### Option A — Right-click → Properties → Unblock (recommended)

1. After download, right-click the `.msi` in File Explorer.
2. Choose **Properties**.
3. At the bottom of the General tab, check **Unblock**, then click **OK**.
4. Double-click the `.msi` to install. SmartScreen will not appear.

#### Option B — Run anyway from the SmartScreen dialog

1. Double-click the `.msi`.
2. When SmartScreen says "Windows protected your PC":
   - Click the small **More info** link.
   - Click the **Run anyway** button that appears.

### 1.4 Why is it unsigned?

A Microsoft-trusted code-signing certificate (Authenticode OV/EV) costs
$300–$700/year and requires identity verification. v1 ships unsigned to
keep the project free and unblock distribution; the code is open source and
binaries are checksum + GPG verifiable. SmartScreen reputation accrues
automatically as more users download the same hash, and the warning typically
diminishes after ~1k clean downloads. We will revisit Authenticode signing
in v1.1+ once user volume justifies the cost.

### 1.5 What gets installed

- **Application files**: `C:\Program Files\vSkill\` (default).
- **WebView2 runtime**: bundled in the installer (`embedBootstrapper` mode).
  If you already have Microsoft Edge / WebView2 (Windows 10 1803+ ships it),
  the bundled copy is skipped at install time. Older Windows installs the
  bundled redistributable automatically — no separate download required.
- **Start Menu shortcut**: `vSkill` (under "All apps").
- **URL protocol handler**: `vskill://` registered under
  `HKCU\Software\Classes\vskill` (per-user, no admin required).
- **User data**: created on first launch at `%USERPROFILE%\.vskill\`.

### 1.6 Uninstall

**Settings → Apps → Installed apps → vSkill → Uninstall**

The uninstaller removes binaries, the Start Menu entry, and the URL protocol
registry keys. **User data at `%USERPROFILE%\.vskill\` is preserved by
default** (so reinstalls keep your settings). To fully purge, delete that
folder manually.

### 1.7 System requirements

- Windows 10 22H2 or Windows 11 (any).
- x64 architecture. (arm64 Windows is deferred to v1.1+.)
- 4 GB RAM minimum, 8 GB recommended.
- 200 MB free disk space.
- Internet connection on first launch (auto-update check + sidecar bootstrap).

---

## 2. Building the .msi from source (contributors)

### 2.1 Requirements

You can only build the Windows `.msi` on a **Windows 10/11 x64 host**.
Cross-compilation from macOS or Linux does not work because the Node sidecar
build (Single Executable Application via `postject`) injects a SEA blob into
the host `node.exe` — the host arch must match the target arch.

In v1 the release pipeline builds the Windows `.msi` on a `windows-2022`
GitHub Actions runner. macOS / Linux contributors do not need to build it
locally; CI handles it on every `desktop-v*` tag.

If you want to build it locally:

1. **Windows 10 22H2 / 11**, x64.
2. **Visual Studio Build Tools 2022** with the *Desktop development with C++*
   workload (provides MSVC, WiX 3.x, and the Windows SDK).
   Download: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>
3. **Rust 1.78+** with the `x86_64-pc-windows-msvc` target.
   ```powershell
   # Install rustup from https://rustup.rs/
   rustup target add x86_64-pc-windows-msvc
   ```
4. **Node 22.x x64** (NOT arm64).
   ```powershell
   # via winget
   winget install OpenJS.NodeJS.LTS
   ```
5. **Tauri CLI v2**.
   ```powershell
   cargo install tauri-cli --version "^2"
   ```
6. **WebView2 SDK** is fetched automatically by `cargo tauri build` — no
   manual installation needed.

### 2.2 Building

```powershell
# From the repo root (vskill/)
pwsh scripts/release/windows-build.ps1
```

The script:

1. Verifies Node 22 x64, cargo, rustup, tauri-cli are present.
2. Installs the `x86_64-pc-windows-msvc` Rust target if missing.
3. Runs `npm ci` if `node_modules\` is absent.
4. Builds the Node sidecar SEA binary via
   `scripts/desktop/build-sidecar-windows.ps1`. Output:
   `src-tauri\binaries\vskill-server-x86_64-pc-windows-msvc.exe`.
5. Runs `cargo tauri build --target x86_64-pc-windows-msvc --bundles msi`.
   Output: `src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\*.msi`.
6. Prints the final path, file size, and SHA256.

### 2.3 Output layout

```
src-tauri\
  target\x86_64-pc-windows-msvc\release\
    bundle\
      msi\
        vskill_<version>_x64_en-US.msi          # the installer
        build-summary.json                       # CI consumption
  binaries\
    vskill-server-x86_64-pc-windows-msvc.exe    # bundled sidecar
```

### 2.4 Testing the build locally

```powershell
# Install (silent — no prompts)
msiexec /i "src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\vskill_1.0.0_x64_en-US.msi" /qn

# Verify the app launches and the sidecar HTTP server is reachable
Start-Process "C:\Program Files\vSkill\vSkill.exe"
Start-Sleep -Seconds 5
Get-Process vSkill              # should show the app process
# The sidecar picks a free port and writes it to ~/.vskill/state/port
$port = Get-Content "$env:USERPROFILE\.vskill\state\port" -ErrorAction SilentlyContinue
if ($port) { Invoke-WebRequest "http://127.0.0.1:$port/api/health" }

# Verify the deep-link registry entry exists
Get-ItemProperty "HKCU:\Software\Classes\vskill" | Format-List
# Should show URL Protocol = "" and a (default) value of "URL:vSkill Protocol"

# Uninstall
msiexec /x "src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\vskill_1.0.0_x64_en-US.msi" /qn
```

### 2.5 Authenticode signing (deferred to v1.1+)

`tauri.conf.json` ships with `bundle.windows.certificateThumbprint = null`
and `bundle.windows.signCommand = null` — Tauri skips Authenticode signing.

When an OV cert is acquired (post-v1):

```jsonc
"bundle": {
  "windows": {
    "certificateThumbprint": "<sha1 thumbprint of cert in CurrentUser\\My>",
    "digestAlgorithm": "sha256",
    "tsp": false,
    "timestampUrl": "http://timestamp.digicert.com"
  }
}
```

Or for cloud-signing services (Azure Trusted Signing, etc.):

```jsonc
"bundle": {
  "windows": {
    "signCommand": "<your sign command, see Tauri docs>"
  }
}
```

After that change, `cargo tauri build` signs the `.msi` automatically. No
script changes are required — the existing `windows-build.ps1` flow stays
the same.

---

## 3. Known v1 limitations on Windows

| Limitation | Status | Notes |
|---|---|---|
| Unsigned installer (SmartScreen warning) | Documented for v1 | OV cert deferred to v1.1+. Documented at §1.3 above. |
| Windows arm64 not supported | Deferred to v1.1+ | Tauri 2 supports it; needs an arm64 Node and CI runner. |
| `winget` submission deferred | Out of v1 | Microsoft requires signed installers for high-trust manifests; revisit after Authenticode. |
| No Authenticode timestamp | N/A in v1 | Re-add when signing is enabled. |
| `@napi-rs/keyring` falls back to file store | Same as macOS | Per-platform native binding cross-arch is non-trivial; file store is the v1 fallback (per `scripts/desktop/README.md`). |
| Windows sidecar built only on Windows hosts | By design | Cross-arch SEA is fundamentally not supported. macOS contributors can ignore the Windows sidecar — CI builds it on every release tag. |

---

## 4. Reporting issues

- **Installer issues**: <https://github.com/anton-abyzov/vskill/issues> with
  the `windows` label. Attach the `.msi` SHA256, your Windows version
  (`winver`), and any SmartScreen / installer log output.
- **Runtime crashes**: include `%USERPROFILE%\.vskill\logs\` if present.
- **Security concerns**: email <security@verified-skill.com>.
