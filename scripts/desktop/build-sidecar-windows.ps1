# ---------------------------------------------------------------------------
# build-sidecar-windows.ps1 -- Build the vskill-server sidecar as a single
# Windows PE executable, ready to be embedded as Tauri externalBin.
#
# Owned by 0829 (vskill distribution & marketing, windows-port agent).
# Windows analog of scripts/desktop/build-sidecar.sh.
#
# IMPORTANT: This script must run on a Windows host with a Windows-arch
# Node 22 binary. It cannot run on macOS or Linux — Node SEA injects the
# blob into the host node.exe, so the host arch must match the target.
# In the v1 release pipeline this runs on a `windows-2022` GitHub Actions
# runner; macOS contributors do not run it locally.
#
# Strategy mirrors build-sidecar.sh:
#   1. Build the upstream artifacts (npm run build + npm run build:eval-ui)
#      so dist/eval-server and dist/eval-ui are fresh.
#   2. scripts/desktop/bundle-sidecar.mjs (esbuild JS API, shared with the
#      macOS/Linux scripts) bundles sidecar-entry.mjs + the eval-server graph
#      into dist/sidecar/server.cjs and gates it with `node --check`.
#   3. scripts/desktop/sidecar-assets.mjs writes eval-ui-manifest.json,
#      vskill-version.txt and
#   4. sea-config.json referencing the bundle + every eval-ui asset.
#   5. node --experimental-sea-config produces sea-prep.blob.
#   6. Copy node.exe to src-tauri\binaries\vskill-server-x86_64-pc-windows-msvc.exe,
#      strip node.exe's Authenticode signature (best-effort, signtool from the
#      Windows SDK) and inject the blob via postject. Re-signing happens in
#      Tauri's bundler when a cert is configured (v1 ships unsigned per spec
#      AC-US06; SmartScreen "Run anyway" is documented).
#
# After this script, run the runtime smoke (the release + smoke workflows do):
#   node scripts/desktop/smoke-sidecar.mjs
#
# Usage (on a Windows host):
#   pwsh scripts/desktop/build-sidecar-windows.ps1
#   # or:
#   powershell -ExecutionPolicy Bypass -File scripts\desktop\build-sidecar-windows.ps1
#
# Env overrides:
#   $env:SKIP_UPSTREAM_BUILD = "1"  # skip tsc + vite if dist/ is fresh
#   $env:TARGET_TRIPLE       = "x86_64-pc-windows-msvc"  # default; only target supported in v1
# ---------------------------------------------------------------------------

#Requires -Version 5.1
$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir     = Resolve-Path (Join-Path $ScriptDir "..\..")
$SidecarDir  = Join-Path $RootDir "dist\sidecar"
$BinDir      = Join-Path $RootDir "src-tauri\binaries"

Set-Location $RootDir

# --- 0. Resolve target triple --------------------------------------------------
# v1 only ships x64. arm64 Windows support is deferred (low Tauri-WebView2
# coverage on arm64 + sidecar SEA needs an arm64 node.exe; revisit in v1.1).
$TargetTriple = if ($env:TARGET_TRIPLE) { $env:TARGET_TRIPLE } else { "x86_64-pc-windows-msvc" }

if ($TargetTriple -ne "x86_64-pc-windows-msvc") {
  Write-Error "build-sidecar-windows.ps1: only x86_64-pc-windows-msvc is supported in v1 (got '$TargetTriple')"
  exit 1
}

# Sanity check: node arch must be x64. Node SEA injects into host node.exe.
$NodeArch = (& node -p 'process.arch').Trim()
if ($NodeArch -ne "x64") {
  Write-Error "build-sidecar-windows.ps1: node arch '$NodeArch' cannot produce $TargetTriple (need x64). Install Node 22 x64."
  exit 2
}

$NodeMajor = [int]((& node -p 'process.versions.node.split(".")[0]').Trim())
if ($NodeMajor -lt 22) {
  Write-Error "build-sidecar-windows.ps1: Node $NodeMajor.x detected; need >= 22 for SEA support."
  exit 2
}

$OutBin = Join-Path $BinDir "vskill-server-$TargetTriple.exe"
Write-Host "==> Target: $TargetTriple -> $OutBin"

# --- 1. Upstream build ---------------------------------------------------------
if ($env:SKIP_UPSTREAM_BUILD -ne "1") {
  Write-Host "==> Building upstream artifacts (tsc + vite)..."
  if (-not (Test-Path (Join-Path $RootDir "node_modules"))) {
    Write-Error "build-sidecar-windows.ps1: node_modules missing -- run ``npm install`` first"
    exit 1
  }
  & npm run build | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
  & npm run build:eval-ui | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "npm run build:eval-ui failed (exit $LASTEXITCODE)" }
}

if (-not (Test-Path (Join-Path $RootDir "dist\eval-server\eval-server.js"))) {
  Write-Error "build-sidecar-windows.ps1: dist\eval-server\eval-server.js missing -- upstream build failed"
  exit 1
}
if (-not (Test-Path (Join-Path $RootDir "dist\eval-ui\index.html"))) {
  Write-Error "build-sidecar-windows.ps1: dist\eval-ui\index.html missing -- upstream build failed"
  exit 1
}

# --- 2. esbuild bundle ---------------------------------------------------------
# Shared JS-API bundler. Do NOT go back to node_modules\.bin\esbuild.cmd with a
# multi-line --banner:js: cmd.exe truncates argv at the first newline, which
# shipped a half prologue in v1.0.62 and made vskill-server.exe die with a
# SyntaxError before printing LISTEN_PORT ("sidecar exited before announcing
# port"). bundle-sidecar.mjs asserts the prologue and runs `node --check`;
# the explicit `node --check` below is the build-script-level gate.
New-Item -ItemType Directory -Force -Path $SidecarDir | Out-Null
Write-Host "==> Bundling sidecar-entry.mjs -> dist\sidecar\server.cjs (esbuild CJS via JS API)"

$OutFile = Join-Path $SidecarDir "server.cjs"
& node (Join-Path $ScriptDir "bundle-sidecar.mjs") --outfile $OutFile
if ($LASTEXITCODE -ne 0) { throw "bundle-sidecar.mjs failed (exit $LASTEXITCODE)" }
& node --check $OutFile
if ($LASTEXITCODE -ne 0) { throw "dist\sidecar\server.cjs does not parse (exit $LASTEXITCODE)" }

$BundleSize = (Get-Item $OutFile).Length
Write-Host ("    bundle size: {0} KiB" -f [int]($BundleSize / 1024))

# --- 3. eval-ui manifest + version asset + sea-config.json --------------------
Write-Host "==> Generating eval-ui manifest + sea-config.json"
& node (Join-Path $ScriptDir "sidecar-assets.mjs")
if ($LASTEXITCODE -ne 0) { throw "sidecar-assets.mjs failed (exit $LASTEXITCODE)" }

$SeaConfigPath   = Join-Path $SidecarDir "sea-config.json"
$SeaPrepBlobPath = Join-Path $SidecarDir "sea-prep.blob"

# --- 5. Build SEA blob ---------------------------------------------------------
Write-Host "==> Building SEA blob"
& node --experimental-sea-config $SeaConfigPath 2>&1 |
  Where-Object { $_ -notmatch "ExperimentalWarning" -and $_ -notmatch "Use ``node --trace-warnings" } |
  ForEach-Object { Write-Host $_ }

if (-not (Test-Path $SeaPrepBlobPath)) {
  Write-Error "build-sidecar-windows.ps1: sea-prep.blob missing -- SEA build failed"
  exit 1
}
$BlobSize = (Get-Item $SeaPrepBlobPath).Length
Write-Host ("    SEA blob: {0} KiB" -f [int]($BlobSize / 1024))

# --- 6. Copy node.exe, inject blob --------------------------------------------
$NodeBin = (Get-Command node).Source
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

Write-Host "==> Copying $NodeBin -> $OutBin"
Copy-Item -Force $NodeBin $OutBin

# Strip node.exe's Authenticode signature before injection (Node SEA docs:
# "remove the signature before postject"). Otherwise the blob invalidates the
# signature in place and postject warns "The signature seems corrupted!" --
# an invalid-signature PE that AppLocker/WDAC-style policies may refuse.
# Best-effort: signtool ships with the Windows SDK (present on GitHub runners).
$Signtool = $null
$SigntoolCmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
if ($SigntoolCmd) {
  $Signtool = $SigntoolCmd.Source
} else {
  $KitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  if (Test-Path $KitsRoot) {
    $Found = Get-ChildItem -Path $KitsRoot -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -like "*\x64\signtool.exe" } |
      Sort-Object FullName | Select-Object -Last 1
    if ($Found) { $Signtool = $Found.FullName }
  }
}
if ($Signtool) {
  Write-Host "==> Stripping Authenticode signature ($Signtool)"
  & $Signtool remove /s $OutBin
  if ($LASTEXITCODE -ne 0) { Write-Warning "signtool remove failed (exit $LASTEXITCODE); continuing with the signed copy" }
} else {
  Write-Warning "signtool.exe not found; node.exe signature left in place (postject will report it as corrupted)"
}

# Resolve postject. Pin the version that build-sidecar.sh uses so macOS and
# Windows builds inject blobs with identical sentinel-fuse semantics.
$PostjectLocal = Join-Path $RootDir "node_modules\.bin\postject.cmd"
if (Test-Path $PostjectLocal) {
  $PostjectCmd = $PostjectLocal
  $PostjectArgs = @($OutBin, "NODE_SEA_BLOB", $SeaPrepBlobPath, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2")
} else {
  # `npx --yes postject@1.0.0-alpha.6` keeps the version in lockstep with the
  # macOS build script. On Windows the sentinel fuse is the same; the Mach-O
  # segment flag is omitted (PE has no analog).
  $PostjectCmd  = "npx"
  $PostjectArgs = @("--yes", "postject@1.0.0-alpha.6", $OutBin, "NODE_SEA_BLOB", $SeaPrepBlobPath, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2")
}

Write-Host "==> Injecting SEA blob via postject"
& $PostjectCmd @PostjectArgs
if ($LASTEXITCODE -ne 0) { throw "postject injection failed (exit $LASTEXITCODE)" }

# No codesign step here. Authenticode signing happens separately during
# `cargo tauri build` when a certificateThumbprint or signCommand is set
# in tauri.conf.json. v1 ships unsigned per AC-US06 (SmartScreen "Run anyway"
# UX is documented in scripts/release/windows-README.md). When an OV cert
# is acquired in v1.1+, set bundle.windows.certificateThumbprint and Tauri
# signs both this exe and the .msi automatically.

$OutSize = (Get-Item $OutBin).Length
Write-Host ("==> Done: $OutBin ({0} MiB)" -f [int]($OutSize / 1MB))
