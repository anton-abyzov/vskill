# Desktop sidecar build (0828)

This directory builds the `vskill-server` Node sidecar for the Tauri desktop
app. The binary is what Tauri loads via `externalBin` and what
`desktop-shell-agent` spawns at app start.

## Output

```
src-tauri/binaries/vskill-server-aarch64-apple-darwin   # Apple Silicon
src-tauri/binaries/vskill-server-x86_64-apple-darwin    # Intel (cross-arch)
```

Each is a self-contained Mach-O executable (~110 MiB) with the entire
`eval-server` module graph and the `dist/eval-ui/` static bundle embedded as
SEA assets. No external `node` install is required to run it.

## Contract

The binary honors the contract owned by 0828's sidecar agent:

| What | How |
|---|---|
| `--port <N>` | Listen on port N. `0` (default) asks the OS to pick a free port. |
| `LISTEN_PORT=<n>\n` on stdout | Emitted exactly once, after the HTTP server is listening. The desktop shell parses this to learn the port. |
| `GET /api/health` | `200 {"ok":true}` — served by eval-server's existing `api-routes.ts` route, NOT by the wrapper. |
| `POST /api/shutdown` | Loopback-only. `200 {"ok":true,"shuttingDown":true}`, process exits within ~2s. Served by eval-server's existing route in `eval-server.ts`, NOT by the wrapper. |
| `SIGTERM` / `SIGINT` | Graceful close, exit 0 (handled by the wrapper). |
| `GET /...` | The embedded studio UI (eval-ui SPA). |

The wrapper deliberately does NOT register `/api/health` or `/api/shutdown`
itself — those routes already ship inside eval-server. Re-registering them
would duplicate behaviour and risk diverging the response shape from the
upstream contract.

## Build

```bash
# Host arch (auto-detected from uname -m)
bash scripts/desktop/build-sidecar.sh

# Or via npm:
npm run desktop:sidecar:build

# Skip the upstream tsc + vite build if dist/ is already fresh
SKIP_UPSTREAM_BUILD=1 bash scripts/desktop/build-sidecar.sh
```

The script:

1. Runs `npm run build` and `npm run build:eval-ui` so `dist/eval-server/` and
   `dist/eval-ui/` are current.
2. Bundles `scripts/desktop/sidecar-entry.mjs` + the entire eval-server
   module graph into `dist/sidecar/server.cjs` via esbuild
   (`--platform=node --format=cjs --target=node22`). esbuild's `--define`
   replaces `import.meta.url` / `.dirname` / `.filename` with synthesized
   CJS-friendly equivalents so eval-server's source-level
   `fileURLToPath(import.meta.url)` continues to work.
3. Generates `dist/sidecar/eval-ui-manifest.json` listing every file under
   `dist/eval-ui/` and writes `dist/sidecar/vskill-version.txt` with the
   current package version. Both are referenced from the SEA config.
4. Generates `dist/sidecar/sea-config.json` with one asset per eval-ui file
   plus the manifest and version blobs.
5. Runs `node --experimental-sea-config dist/sidecar/sea-config.json` to
   produce `dist/sidecar/sea-prep.blob`.
6. Copies the host `node` binary to
   `src-tauri/binaries/vskill-server-${TARGET_TRIPLE}`, strips its existing
   signature, injects the SEA blob via `postject`, and re-ad-hoc-signs it so
   macOS will execute it.

## Supported architectures

The build script can ONLY produce a binary for an arch whose `node`
interpreter is available locally — Node SEA injects the blob into a copy of
the host `node`, so we cannot cross-compile.

| TARGET_TRIPLE | How to build |
|---|---|
| `aarch64-apple-darwin` | Run on Apple Silicon with `node` arm64. |
| `x86_64-apple-darwin` | Run on an Intel Mac, OR on Apple Silicon under `arch -x86_64` with an Intel-arch `node` installed (e.g. via `arch -x86_64 nvm install 22`). |

If you need both architectures from a single host, install both Node arches
side-by-side and run the script twice with different `TARGET_TRIPLE` values.
A future iteration may bundle a universal2 `node` binary to remove the
host-arch constraint, but that is not implemented yet.

### Current v1 gap

The CI/release pipeline (and this v1 build) ships only the host-arch binary.
For Apple Silicon developers that means the Intel binary will be missing;
Tauri builds on Intel CI runners (or Apple Silicon under x86_64 emulation)
must produce that artifact. Document and track in the increment's tasks.md.

## How the eval-ui statics are served

`eval-server.ts` resolves its static directory as
`path.resolve(__dirname, "../eval-ui")`. Inside the SEA, `__dirname` is the
runtime directory of the bundled binary, so this would normally point to a
non-existent on-disk location.

`scripts/desktop/sidecar-entry.mjs` patches three `fs` primitives at startup
when `node:sea.isSea()` returns true:

- `fs.statSync(path)`
- `fs.readFileSync(path)`
- `fs.createReadStream(path)`

For any path ending in `/eval-ui/<rel>` where `<rel>` is in the embedded
manifest, the patched primitives return the SEA asset bytes instead of
hitting disk. All other paths fall through to the real `fs`. The patches are
narrow on purpose (matched by suffix + manifest membership) so unrelated fs
reads — settings store, cache files, user repos — keep working.

The patches are installed BEFORE the `import { startEvalServer }` line so
that any boot-time fs reads inside the eval-server graph would also be
intercepted. In practice eval-server defers all eval-ui reads to
request-time `serveStatic`, so the patches only fire on incoming HTTP
requests for `/`, `/index.html`, `/assets/*`, etc.

## What is NOT in the bundle

`@napi-rs/keyring` (and its arch-specific `.node` bindings) is marked
external in the esbuild step. It is a lazy darwin-only dependency loaded
only when the user triggers GitHub-token features, so the startup +
health-check + shutdown contract does not need it. The first time a user
hits a keyring-backed endpoint inside the SEA, the runtime `require()` will
throw; v1 mitigates by always falling back to the file-backed key store.
A follow-up will either embed the binding via `postject` as a sibling file
or replace `@napi-rs/keyring` with a pure-JS keychain shim.

## Troubleshooting

### Binary exits immediately with no output
Run with `--inspect-brk` (does not work in SEA — disabled) or run the
non-bundled wrapper instead: `node scripts/desktop/sidecar-entry.mjs --port 0`.
The wrapper has identical contract behavior in dev mode.

### `LISTEN_PORT=` line never appears
The wrapper emits this line via `process.stdout.write` immediately after
`startEvalServer` resolves. If it does not appear, eval-server itself failed
to listen — check stderr for the upstream error.

### `/api/health` returns the wrong shape
The route is served by eval-server's `api-routes.ts` (`{ ok: true }`). The
wrapper does not override it. If the response is missing or malformed, the
upstream `registerRoutes(...)` call in `eval-server.ts` is suspect — verify
the bundled `server.cjs` still contains `router.get("/api/health", ...)`
inside `registerRoutes`.

### `npm run desktop:sidecar:build` says "command not found"
The npm script is owned by `desktop-shell-agent` (primary owner of
`package.json`). Until they wire it up, run the script directly:
`bash scripts/desktop/build-sidecar.sh`.

### Codesign error: "the executable is not a Mach-O"
The host machine likely has SIP enforcement or a hardened-runtime entitlement
on `node` that postject cannot strip. Confirm with `codesign -dv $(which node)`
and try a Node version installed via `nvm` (which is unsigned by default).

### Built but won't launch from Tauri
Verify `tauri.conf.json` has the binary listed in `bundle.externalBin` and
that the path matches `src-tauri/binaries/vskill-server-${TRIPLE}` exactly
(Tauri auto-appends the triple). The desktop-shell-agent owns that config.
