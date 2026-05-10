# Skill Studio (Tauri 2 shell)

Native macOS / Windows wrapper around the existing `vskill studio` runtime.
The Rust binary spawns the Node `eval-server` as a sidecar, captures the
listening port from stdout (`LISTEN_PORT=<port>`), polls `/api/health`, then
opens a WebView pointed at `http://127.0.0.1:<port>/`.

## Layout

| Path | Purpose |
|------|---------|
| `Cargo.toml` | Standalone crate (`vskill-desktop`). |
| `tauri.conf.json` | Bundle config: identifier, window, externalBin, icons. |
| `capabilities/default.json` | Tauri 2 permission grants for the main window. |
| `src/main.rs` | Thin entrypoint — calls `vskill_desktop_lib::run()`. |
| `src/lib.rs` | App builder, plugin wiring, sidecar boot, window setup. |
| `src/sidecar.rs` | Spawn Node sidecar, capture port, health-poll, crash supervisor. |
| `src/menu.rs` | Native menu bar (vSkill / File / Edit / View / Window / Help). |
| `src/lifecycle.rs` | Window state persistence + close-hides-window behavior. |
| `src/commands.rs` | Tauri commands: `get_server_port`, `restart_server`, `open_logs_folder`, `quit`. |
| `icons/` | Bundle icons (placeholders — swap with brand assets before GA). |
| `binaries/` | Sidecar binaries (`vskill-server-aarch64-apple-darwin`, etc.) — populated by the sidecar pipeline; not checked in. |

## Sidecar contract

The bundled `vskill-server` binary must:

1. Accept `--port 0` to auto-allocate a free port.
2. Print `LISTEN_PORT=<port>` to stdout once listening.
3. Respond `200 OK` with `{ "ok": true }` on `GET /api/health` within 10 s.
4. Accept `POST /api/shutdown` and exit within 2 s.

If health doesn't return 200 within 10 s, the shell shows a fallback HTML
page in the main window and logs the error.

## Crash recovery

3-strikes-in-60s rule: silent restart for the first three unexpected exits in
a 60-second sliding window (emits `server-restarted`). The fourth exit
surfaces a `server-crashed` event the studio bundle can render as a banner.
Manual `restart_server` resets the strike counter.

## Run locally

Once a sidecar binary is dropped at
`src-tauri/binaries/vskill-server-<target-triple>`:

```sh
# from repo root
npm install                   # picks up @tauri-apps/cli
npm run desktop:dev           # tauri dev — hot-reloads on Rust + frontend changes
npm run desktop:build         # produces .app + .dmg under src-tauri/target/
```

For pure compile checks without the sidecar binary:

```sh
cd src-tauri
cargo check
cargo build --release
```

`cargo test` runs the pure-Rust unit tests (e.g. `parse_listen_port`).

## Build-time secrets

### `GITHUB_OAUTH_CLIENT_ID` (required for release builds — 0836 US-004)

Release builds **require** the OAuth App `client_id` to be set as a build
environment variable. The placeholder constant
`Iv1.placeholder-replace-before-ship` is rejected by `build.rs` in release
profile, and a CI step `strings | grep` re-checks the signed binary as a
second line of defense.

| Profile | Behavior |
|---|---|
| `cargo build` (debug) | Tolerates missing/placeholder. Runtime guard catches usage. |
| `cargo build --release` | **Panics** if env is unset OR equals the placeholder. |
| CI `desktop-release.yml` | Sets `GITHUB_OAUTH_CLIENT_ID` from a repo secret + `strings | grep` post-sign. |

#### Local dev (testing the OAuth flow)

```sh
export GITHUB_OAUTH_CLIENT_ID=Iv1.your-test-app-id
cd src-tauri
cargo build --release            # uses env-supplied id; no panic
```

#### CI (GitHub Actions)

The secret lives at **Settings → Secrets and variables → Actions →
`GITHUB_OAUTH_CLIENT_ID`**. The `desktop-release.yml` workflow exports it
to the build step automatically. To rotate the OAuth App, follow the
runbook at
[`.specweave/docs/internal/specs/oauth-client-id-rotation.md`](../.specweave/docs/internal/specs/oauth-client-id-rotation.md).

#### What happens if it's missing

`cargo build --release` fails with:

```
error: failed to run custom build command for `vskill-desktop v1.0.x`
Caused by:
  thread 'main' panicked at src-tauri/build.rs:36:13:
  GITHUB_OAUTH_CLIENT_ID is unset or equals the placeholder
  (Iv1.placeholder-replace-before-ship); release builds REQUIRE a real
  OAuth App client_id. Set it in CI secrets / shell env before
  `cargo build --release`. See src-tauri/README.md and
  .specweave/docs/internal/specs/oauth-client-id-rotation.md.
```

## What this shell does NOT do

- It does not modify `src/eval-server/**` or `src/studio/**`.
- It does not include the studio UI assets in this directory; Tauri's
  `frontendDist` resolves to `../dist/eval-ui` at build time.
- Phases 2-5 (signing, notarization, auto-update, deep-link wiring,
  Windows port) live in subsequent increments.
