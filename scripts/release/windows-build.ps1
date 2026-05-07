# ---------------------------------------------------------------------------
# windows-build.ps1 -- End-to-end Windows .msi release build for Skill Studio.
#
# Owned by 0829 (vskill distribution & marketing, windows-port agent).
#
# Runs on a Windows host (Windows 11 / Windows Server 2022 in CI). Produces:
#   src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\*.msi
#
# Order of operations:
#   1. Sanity checks (Node 22 x64, Rust + cargo + tauri-cli, npm).
#   2. Install x86_64-pc-windows-msvc Rust target if missing.
#   3. npm ci  (install JS dependencies if not already present).
#   4. Build the Windows sidecar binary via build-sidecar-windows.ps1.
#      Output: src-tauri\binaries\vskill-server-x86_64-pc-windows-msvc.exe
#   5. cargo tauri build --target x86_64-pc-windows-msvc --bundles msi
#      Tauri will:
#        - Build src-tauri\ Rust crate.
#        - Bundle the WebView2 evergreen bootstrapper (per
#          tauri.conf.json bundle.windows.webviewInstallMode = embedBootstrapper).
#        - Run WiX to produce the .msi (default Tauri WiX template; the
#          tauri-plugin-deep-link entry adds the HKCU\Software\Classes\vskill
#          registry component for `vskill://` URL handling per spec AC-US07).
#        - Skip Authenticode signing because tauri.conf.json has
#          certificateThumbprint = null and signCommand = null in v1.
#          The unsigned .msi triggers SmartScreen "Run anyway" -- documented
#          for users in scripts\release\windows-README.md (AC-US06).
#   6. Print the final .msi path + SHA256 (AC-US06-04: SHA256 published with
#      Release).
#
# Usage (on Windows):
#   pwsh scripts/release/windows-build.ps1
#   # or:
#   powershell -ExecutionPolicy Bypass -File scripts\release\windows-build.ps1
#
# CI usage: this is the single entrypoint that the matrix `windows-2022` job
# in .github/workflows/desktop-release.yml invokes. Mirrors the macOS-side
# `tauri-action` step's responsibilities for the Windows runner.
# ---------------------------------------------------------------------------

#Requires -Version 5.1
$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Resolve-Path (Join-Path $ScriptDir "..\..")
Set-Location $RootDir

Write-Host "=========================================="
Write-Host "Skill Studio -- Windows .msi build"
Write-Host "Working directory: $RootDir"
Write-Host "=========================================="

# Ensure Tauri picks up the right targets list. Even though tauri.conf.json
# already contains "msi" in bundle.targets (added by macos-distribution-agent
# per coordination message), we narrow to msi here so cargo tauri build
# does not also try to assemble app-only or nsis bundles on this runner.
$env:TAURI_BUNDLE_TARGETS = "msi"

# --- 1. Toolchain sanity checks ------------------------------------------------
Write-Host "==> Toolchain checks"

$NodeArch = (& node -p 'process.arch').Trim()
if ($NodeArch -ne "x64") {
  Write-Error "windows-build.ps1: node arch '$NodeArch' detected; need x64 for SEA sidecar build"
  exit 2
}
$NodeMajor = [int]((& node -p 'process.versions.node.split(".")[0]').Trim())
if ($NodeMajor -lt 22) {
  Write-Error "windows-build.ps1: Node $NodeMajor detected; need >= 22"
  exit 2
}
Write-Host "    node: $(node --version) ($NodeArch)"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Error "windows-build.ps1: cargo not found. Install Rust 1.78+ via https://rustup.rs/"
  exit 2
}
Write-Host "    cargo: $(cargo --version)"

if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
  Write-Error "windows-build.ps1: rustup not found. Install via https://rustup.rs/"
  exit 2
}

# Tauri CLI must be installed. CI installs via `cargo install tauri-cli --version "^2"`
# before invoking this script; locally users follow the contributor README.
$TauriCli = & cargo tauri --version 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Error "windows-build.ps1: cargo tauri not found. Run: cargo install tauri-cli --version `"^2`""
  exit 2
}
Write-Host "    tauri-cli: $TauriCli"

# --- 2. Ensure Rust target is installed ----------------------------------------
$Target = "x86_64-pc-windows-msvc"
$InstalledTargets = & rustup target list --installed
if ($InstalledTargets -notcontains $Target) {
  Write-Host "==> Installing Rust target $Target"
  & rustup target add $Target
  if ($LASTEXITCODE -ne 0) { throw "rustup target add $Target failed" }
}

# --- 3. JS dependencies --------------------------------------------------------
if (-not (Test-Path (Join-Path $RootDir "node_modules"))) {
  Write-Host "==> npm ci"
  & npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
} else {
  Write-Host "    node_modules present -- skipping npm ci (set CI=1 + delete node_modules to force)"
}

# --- 4. Build the Windows sidecar ---------------------------------------------
Write-Host "==> Building Windows sidecar (vskill-server-$Target.exe)"
$SidecarBuildScript = Join-Path $RootDir "scripts\desktop\build-sidecar-windows.ps1"

# Prefer pwsh (PS 7+, preinstalled on windows-2022 runners), fall back to
# Windows PowerShell 5.1 if pwsh is not on PATH (rare but possible on locked-down
# corporate boxes). Both invocations honor #Requires -Version 5.1 in the script.
$PsHost = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }
& $PsHost -NoProfile -ExecutionPolicy Bypass -File $SidecarBuildScript
if ($LASTEXITCODE -ne 0) { throw "sidecar build failed (exit $LASTEXITCODE)" }

$SidecarBin = Join-Path $RootDir "src-tauri\binaries\vskill-server-$Target.exe"
if (-not (Test-Path $SidecarBin)) {
  Write-Error "windows-build.ps1: sidecar missing at $SidecarBin after build"
  exit 1
}
Write-Host "    sidecar OK: $SidecarBin"

# --- 5. Tauri build (Windows .msi) --------------------------------------------
Write-Host "==> cargo tauri build --target $Target --bundles msi"

# `cargo tauri build` runs the Rust + WebView2 + WiX pipeline. WebView2
# bootstrapper embed adds ~1.8 MiB to the .msi (already accepted in plan §5.1).
# WiX 3.x must be on PATH; it ships with Visual Studio Build Tools 2022.
& cargo tauri build --target $Target --bundles msi
if ($LASTEXITCODE -ne 0) { throw "cargo tauri build failed (exit $LASTEXITCODE)" }

# --- 6. Locate + report output -------------------------------------------------
$BundleDir = Join-Path $RootDir "src-tauri\target\$Target\release\bundle\msi"
$Msi = Get-ChildItem -Path $BundleDir -Filter "*.msi" | Select-Object -First 1
if (-not $Msi) {
  Write-Error "windows-build.ps1: no .msi found in $BundleDir"
  exit 1
}

$MsiSizeMb = [math]::Round($Msi.Length / 1MB, 1)
$MsiSha256 = (Get-FileHash -Algorithm SHA256 $Msi.FullName).Hash.ToLower()

Write-Host ""
Write-Host "=========================================="
Write-Host "BUILD COMPLETE"
Write-Host "=========================================="
Write-Host "MSI:    $($Msi.FullName)"
Write-Host "Size:   ${MsiSizeMb} MB"
Write-Host "SHA256: $MsiSha256"
Write-Host ""
Write-Host "Next steps (CI workflow handles these):"
Write-Host "  - GPG-sign the .msi (scripts/release/gpg-sign-windows.sh)"
Write-Host "  - Upload to R2 (scripts/release/upload-r2.sh windows-x86_64 <version>)"
Write-Host "  - Emit manifest fragment (scripts/release/emit-platform-fragment.sh)"
Write-Host "=========================================="

# Emit machine-readable summary for CI consumption.
$Summary = [ordered]@{
  msiPath  = $Msi.FullName
  msiName  = $Msi.Name
  sizeMb   = $MsiSizeMb
  sha256   = $MsiSha256
  target   = $Target
}
$SummaryJson = $Summary | ConvertTo-Json -Compress
$SummaryPath = Join-Path $RootDir "src-tauri\target\$Target\release\bundle\msi\build-summary.json"
[System.IO.File]::WriteAllText($SummaryPath, $SummaryJson)
Write-Host "Build summary: $SummaryPath"
