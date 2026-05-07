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
#   2. esbuild bundles scripts/desktop/sidecar-entry.mjs + the entire
#      eval-server module graph into dist/sidecar/server.cjs (CJS for SEA).
#   3. Generate dist/sidecar/eval-ui-manifest.json.
#   4. Generate sea-config.json referencing the bundle + every eval-ui asset.
#   5. node --experimental-sea-config produces sea-prep.blob.
#   6. Copy node.exe to src-tauri\binaries\vskill-server-x86_64-pc-windows-msvc.exe,
#      inject the blob via postject. No codesign step on Windows — Tauri's
#      bundler runs Authenticode separately when a cert is configured (v1
#      ships unsigned per spec AC-US06; SmartScreen "Run anyway" is documented).
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
New-Item -ItemType Directory -Force -Path $SidecarDir | Out-Null
Write-Host "==> Bundling sidecar-entry.mjs -> dist\sidecar\server.cjs (esbuild CJS)"

# Banner mirrors build-sidecar.sh: synthesizes import.meta.url for CJS-bundled
# ESM source. Keep in lockstep with the Bash script's banner.
$BannerJs = @'
const __sea_pathToFileURL = (() => {
  try { return require('node:url').pathToFileURL; } catch { return null; }
})();
const __sea_import_meta_url = (() => {
  try { return __sea_pathToFileURL ? __sea_pathToFileURL(__filename).href : ('file://' + __filename); }
  catch { return 'file://' + __filename; }
})();
'@

$EsbuildBin = Join-Path $RootDir "node_modules\.bin\esbuild.cmd"
if (-not (Test-Path $EsbuildBin)) {
  Write-Error "build-sidecar-windows.ps1: esbuild not found at $EsbuildBin -- run ``npm install`` first"
  exit 1
}

# Note on `--external:@napi-rs/keyring*`: same posture as macOS build —
# keyring is a lazy darwin-only dep behind a function-scope require() and
# is not exercised by the startup/health/shutdown contract. On Windows the
# fallback file-backed key store is even more important since DPAPI bindings
# would also need separate cross-arch handling. v1 mitigates by always
# falling back; the gap is documented in scripts/release/windows-README.md.
$EntryFile  = Join-Path $ScriptDir "sidecar-entry.mjs"
$OutFile    = Join-Path $SidecarDir "server.cjs"

& $EsbuildBin `
  $EntryFile `
  --bundle `
  --platform=node `
  --target=node22 `
  --format=cjs `
  --outfile="$OutFile" `
  --external:@napi-rs/keyring `
  --external:@napi-rs/keyring-* `
  --define:import.meta.url=__sea_import_meta_url `
  --define:import.meta.dirname=__dirname `
  --define:import.meta.filename=__filename `
  --banner:js="$BannerJs" `
  --legal-comments=none `
  --log-level=warning
if ($LASTEXITCODE -ne 0) { throw "esbuild failed (exit $LASTEXITCODE)" }

$BundleSize = (Get-Item $OutFile).Length
Write-Host ("    bundle size: {0} KiB" -f [int]($BundleSize / 1024))

# --- 3. Generate eval-ui manifest + version asset -----------------------------
Write-Host "==> Generating eval-ui manifest"

$ManifestPath = Join-Path $SidecarDir "eval-ui-manifest.json"
$VersionPath  = Join-Path $SidecarDir "vskill-version.txt"

# Use Node (instead of pure PowerShell) for path-norm parity with build-sidecar.sh.
# Inline ESM so we avoid temp files. Forward-slash separators match the macOS
# build's manifest exactly so sidecar-entry.mjs's lookup logic works unchanged.
$ManifestPathFwd = $ManifestPath.Replace('\','/')
$EvalUiRootFwd   = (Join-Path $RootDir "dist\eval-ui").Replace('\','/')

$Inline = @"
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = '$EvalUiRootFwd';
const out = [];
function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (s.isFile()) out.push(relative(root, p).split('\\\\').join('/'));
  }
}
walk(root);
const manifest = Object.fromEntries(out.map((rel) => [rel, true]));
writeFileSync('$ManifestPathFwd', JSON.stringify(manifest));
console.error('   ' + out.length + ' eval-ui files indexed');
"@

& node --input-type=module -e $Inline
if ($LASTEXITCODE -ne 0) { throw "eval-ui manifest generation failed" }

$VskillVersion = (& node -p 'require("./package.json").version').Trim()
[System.IO.File]::WriteAllText($VersionPath, $VskillVersion)
Write-Host "    vskill version: $VskillVersion"

# --- 4. Generate sea-config.json ----------------------------------------------
Write-Host "==> Generating sea-config.json"

$SeaConfigPath    = Join-Path $SidecarDir "sea-config.json"
$SeaPrepBlobPath  = Join-Path $SidecarDir "sea-prep.blob"
$ServerCjsPath    = $OutFile
$SeaConfigPathFwd = $SeaConfigPath.Replace('\','/')
$SeaPrepBlobFwd   = $SeaPrepBlobPath.Replace('\','/')
$ServerCjsFwd     = $ServerCjsPath.Replace('\','/')
$ManifestFwd      = $ManifestPath.Replace('\','/')
$VersionFwd       = $VersionPath.Replace('\','/')

$Inline2 = @"
import { readFileSync, writeFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('$ManifestFwd', 'utf8'));
const assets = {
  'eval-ui-manifest.json': '$ManifestFwd',
  'vskill-version.txt':    '$VersionFwd',
};
for (const rel of Object.keys(manifest)) {
  assets['eval-ui/' + rel] = '$EvalUiRootFwd/' + rel;
}
const cfg = {
  main: '$ServerCjsFwd',
  output: '$SeaPrepBlobFwd',
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
};
writeFileSync('$SeaConfigPathFwd', JSON.stringify(cfg, null, 2));
console.error('   sea-config.json written ('+Object.keys(assets).length+' assets)');
"@

& node --input-type=module -e $Inline2
if ($LASTEXITCODE -ne 0) { throw "sea-config.json generation failed" }

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
