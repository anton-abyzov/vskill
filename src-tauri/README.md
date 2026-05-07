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

## What this shell does NOT do

- It does not modify `src/eval-server/**` or `src/studio/**`.
- It does not include the studio UI assets in this directory; Tauri's
  `frontendDist` resolves to `../dist/eval-ui` at build time.
- Phases 2-5 (signing, notarization, auto-update, deep-link wiring,
  Windows port) live in subsequent increments.
