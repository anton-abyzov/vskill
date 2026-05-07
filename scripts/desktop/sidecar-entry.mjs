// ---------------------------------------------------------------------------
// sidecar-entry.mjs -- Tauri sidecar wrapper around the existing eval-server.
//
// Owned by 0828 (vskill desktop app, sidecar bundling agent). This file:
//   1. Imports the existing eval-server unmodified (preserving the
//      boot-preflight import-order constraint required by 0702 T-020/T-021).
//   2. Parses --port (default 0 = OS-assigned).
//   3. Emits exactly one line `LISTEN_PORT=<port>` to stdout once the server
//      is listening. This is the ONLY contractual stdout signal the desktop
//      shell parses to learn the port.
//   4. Forwards SIGTERM / SIGINT to a graceful close.
//   5. When running inside a Single Executable Application (SEA), patches a
//      narrow set of fs primitives so the eval-server's static-file serving
//      reads the embedded eval-ui asset blobs instead of a non-existent
//      on-disk directory.
//
// /api/health and /api/shutdown are NOT registered here — they already exist
// in eval-server (api-routes.ts registers GET /api/health and eval-server.ts
// registers POST /api/shutdown loopback-only). Re-registering them here
// would duplicate behavior and risk diverging the response shape.
//
// Bundling notes (matters when esbuild produces CJS for SEA):
//   - We use `createRequire` so `node:sea`, `node:fs`, etc. come from CJS
//     `require`, which yields mutable namespace objects (ESM `import * as`
//     bindings are immutable; esbuild errors on patching them).
//   - We avoid `import.meta` in code paths that ship to CJS — `__filename` /
//     `__dirname` are provided by CJS natively and by esbuild via define.
//   - Static `import { startEvalServer }` is preserved so the eval-server
//     module graph is inlined at bundle time AND so the boot-preflight
//     import-order constraint is honored unchanged.
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";

const requireCjs = createRequire(typeof __filename !== "undefined" ? __filename : import.meta.url);
const fs = requireCjs("node:fs");
const { Readable } = requireCjs("node:stream");

let seaApi = null;
try {
  const sea = requireCjs("node:sea");
  if (sea && typeof sea.isSea === "function" && sea.isSea()) {
    seaApi = sea;
  }
} catch {
  /* node:sea not available in the current runtime */
}

// In SEA mode the embedded asset blob holds the entire dist/eval-ui directory
// listing keyed by relative path. Without this map the eval-server's static
// handler would 404 every request because there is no on-disk dist/eval-ui
// sibling next to the bundled code.
let evalUiManifest = null;
if (seaApi) {
  try {
    const manifestRaw = seaApi.getAsset("eval-ui-manifest.json", "utf8");
    evalUiManifest = JSON.parse(manifestRaw);
  } catch (err) {
    process.stderr.write(
      `sidecar: failed to read embedded eval-ui manifest: ${err && err.message ? err.message : err}\n`,
    );
  }
}

function lookupEvalUiAsset(filePath) {
  if (!evalUiManifest) return null;
  const norm = filePath.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/eval-ui/");
  if (idx === -1) return null;
  const rel = norm.slice(idx + "/eval-ui/".length);
  if (!rel) return null;
  if (Object.prototype.hasOwnProperty.call(evalUiManifest, rel)) return rel;
  return null;
}

function makeFakeFileStat(size) {
  return {
    size,
    isFile: () => true,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    dev: 0,
    ino: 0,
    mode: 0o100644,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 4096,
    blocks: Math.ceil(size / 512),
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: new Date(0),
    mtime: new Date(0),
    ctime: new Date(0),
    birthtime: new Date(0),
  };
}

function patchFsForSea() {
  if (!seaApi || !evalUiManifest) return;

  const origStatSync = fs.statSync;
  fs.statSync = function patchedStatSync(filePath, opts) {
    if (typeof filePath === "string") {
      const rel = lookupEvalUiAsset(filePath);
      if (rel) {
        const buf = seaApi.getAsset(`eval-ui/${rel}`);
        return makeFakeFileStat(buf.byteLength ?? 0);
      }
    }
    return origStatSync.call(fs, filePath, opts);
  };

  const origReadFileSync = fs.readFileSync;
  fs.readFileSync = function patchedReadFileSync(filePath, opts) {
    if (typeof filePath === "string") {
      const rel = lookupEvalUiAsset(filePath);
      if (rel) {
        const ab = seaApi.getAsset(`eval-ui/${rel}`);
        const buf = Buffer.from(ab);
        if (typeof opts === "string" || (opts && opts.encoding)) {
          const enc = typeof opts === "string" ? opts : opts.encoding;
          return buf.toString(enc);
        }
        return buf;
      }
    }
    return origReadFileSync.call(fs, filePath, opts);
  };

  const origCreateReadStream = fs.createReadStream;
  fs.createReadStream = function patchedCreateReadStream(filePath, opts) {
    if (typeof filePath === "string") {
      const rel = lookupEvalUiAsset(filePath);
      if (rel) {
        const ab = seaApi.getAsset(`eval-ui/${rel}`);
        const buf = Buffer.from(ab);
        return Readable.from(buf);
      }
    }
    return origCreateReadStream.call(fs, filePath, opts);
  };
}

patchFsForSea();

// Static import — esbuild bundles the entire eval-server graph here.
// boot-preflight is preserved transitively (eval-server.ts imports it as its
// FIRST statement, ahead of any provider SDK). Do not move or replace this
// import.
import { startEvalServer } from "../../dist/eval-server/eval-server.js";

function parsePort(argv) {
  const idx = argv.indexOf("--port");
  if (idx === -1) return 0;
  const raw = argv[idx + 1];
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 65535) {
    process.stderr.write(`invalid --port value: ${raw}\n`);
    process.exit(2);
  }
  return n;
}

async function main() {
  const port = parsePort(process.argv);

  if (!process.env.VSKILL_TELEMETRY) {
    process.env.VSKILL_TELEMETRY_DISABLED = "1";
  }

  let server;
  try {
    server = await startEvalServer({ port });
  } catch (err) {
    process.stderr.write(
      `sidecar: startEvalServer failed: ${err && err.stack ? err.stack : err}\n`,
    );
    process.exit(1);
  }

  // startEvalServer's promise resolves only after the http.Server's
  // `listening` callback fires (see eval-server.ts: `server.listen(port, () =>
  // resolve(server))`). The server is therefore guaranteed to be listening at
  // this point — we read the bound port and emit the contract line once.
  const addr = server.address();
  const actualPort =
    addr && typeof addr === "object" && typeof addr.port === "number" ? addr.port : port;

  process.stdout.write(`LISTEN_PORT=${actualPort}\n`);

  const onSignal = () => {
    try {
      server.close(() => process.exit(0));
    } catch {
      process.exit(0);
    }
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}

main();
