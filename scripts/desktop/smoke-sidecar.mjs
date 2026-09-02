#!/usr/bin/env node
// ---------------------------------------------------------------------------
// smoke-sidecar.mjs -- runtime smoke test for the built sidecar binary.
//
// Zero dependencies. Spawns src-tauri/binaries/vskill-server-<triple>[.exe]
// exactly the way the desktop shell does (`--port 0`), then checks the
// contract the Rust side relies on:
//   1. a `LISTEN_PORT=<n>` line on stdout within 15 s (process must not exit)
//   2. GET  http://127.0.0.1:<n>/api/health  -> 200
//   3. a `Studio token: <token>` banner on stdout (get_studio_token IPC)
//   4. POST http://127.0.0.1:<n>/api/shutdown with `X-Studio-Token` -> 200,
//      process exits 0 within 5 s (the route is token-gated like every
//      /api/* route except /api/health)
//
// stdout/stderr are captured to <log-dir>/sidecar.stdout.log and
// sidecar.stderr.log and printed on failure. Exit code 1 on any failure.
//
// HOME/USERPROFILE are pointed at a temp dir so the run never touches the
// developer's ~/.vskill or ~/SkillProject.
//
// Usage:
//   node scripts/desktop/smoke-sidecar.mjs [path/to/binary] [--log-dir DIR] [--timeout MS]
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PORT_TIMEOUT_MS = 15_000;
export const EXIT_TIMEOUT_MS = 5_000;

/** Rust target triple for the host, matching the build scripts' naming. */
export function targetTriple(platform = process.platform, arch = process.arch) {
  const key = `${platform}/${arch}`;
  const map = {
    "darwin/arm64": "aarch64-apple-darwin",
    "darwin/x64": "x86_64-apple-darwin",
    "win32/x64": "x86_64-pc-windows-msvc",
    "linux/x64": "x86_64-unknown-linux-gnu",
  };
  const triple = map[key];
  if (!triple) throw new Error(`no sidecar target triple for ${key}`);
  return triple;
}

export function sidecarBinaryPath(rootDir = ROOT_DIR, platform = process.platform, arch = process.arch) {
  const ext = platform === "win32" ? ".exe" : "";
  return path.join(rootDir, "src-tauri", "binaries", `vskill-server-${targetTriple(platform, arch)}${ext}`);
}

export function parseListenPort(text) {
  const m = /LISTEN_PORT=(\d{1,5})/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 65535 ? n : null;
}

export function parseStudioToken(text) {
  const m = /Studio token:\s*(\S+)/.exec(text);
  return m ? m[1] : null;
}

function request(method, port, urlPath, { timeoutMs = 5_000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method, timeout: timeoutMs, headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`${method} ${urlPath} timed out after ${timeoutMs} ms`)));
    req.on("error", reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the smoke against `binary`. Resolves with a summary on success, rejects
 * with an Error carrying `.details` (captured output) on failure.
 */
export async function smokeSidecar({
  binary = sidecarBinaryPath(),
  logDir = path.join(ROOT_DIR, "dist", "sidecar", "smoke-logs"),
  portTimeoutMs = PORT_TIMEOUT_MS,
  exitTimeoutMs = EXIT_TIMEOUT_MS,
} = {}) {
  if (!fs.existsSync(binary)) {
    throw new Error(`sidecar binary not found: ${binary} (run the platform build-sidecar script first)`);
  }
  fs.mkdirSync(logDir, { recursive: true });
  const outPath = path.join(logDir, "sidecar.stdout.log");
  const errPath = path.join(logDir, "sidecar.stderr.log");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vskill-smoke-home-"));
  const root = path.join(home, "SkillProject");

  let stdout = "";
  let stderr = "";
  const lines = [];
  const log = (msg) => {
    lines.push(msg);
    console.log(msg);
  };

  log(`smoke: spawning ${binary} --port 0 --root ${root}`);
  const child = spawn(binary, ["--port", "0", "--root", root], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      VSKILL_TELEMETRY_DISABLED: "1",
    },
    windowsHide: true,
  });

  let exited = null;
  const exitPromise = new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      exited = { code, signal };
      resolve(exited);
    });
  });
  child.on("error", (err) => {
    stderr += `\n[spawn error] ${err.message}\n`;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));

  const flush = () => {
    fs.writeFileSync(outPath, stdout);
    fs.writeFileSync(errPath, stderr);
  };

  const fail = (msg) => {
    flush();
    if (exited === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
    const err = new Error(msg);
    err.details =
      `--- captured stdout (${outPath}) ---\n${stdout}\n` +
      `--- captured stderr (${errPath}) ---\n${stderr}\n` +
      `--- exit ---\n${exited ? JSON.stringify(exited) : "(still running, killed)"}\n`;
    return err;
  };

  try {
    // 1. LISTEN_PORT within budget, process must still be alive.
    const started = Date.now();
    let port = null;
    while (Date.now() - started < portTimeoutMs) {
      port = parseListenPort(stdout);
      if (port) break;
      if (exited) break;
      await sleep(100);
    }
    if (exited && !port) {
      throw fail(`sidecar exited before announcing port (exit code ${exited.code}, signal ${exited.signal})`);
    }
    if (!port) {
      throw fail(`timed out after ${portTimeoutMs} ms waiting for LISTEN_PORT=`);
    }
    log(`smoke: LISTEN_PORT=${port} after ${Date.now() - started} ms`);

    // 2. /api/health
    const health = await request("GET", port, "/api/health").catch((e) => {
      throw fail(`GET /api/health failed: ${e.message}`);
    });
    if (health.status !== 200) {
      throw fail(`GET /api/health returned ${health.status}: ${health.body}`);
    }
    log(`smoke: GET /api/health -> ${health.status} ${health.body.trim()}`);

    // 3. Studio token banner (the desktop shell's get_studio_token IPC).
    const tokenDeadline = Date.now() + 2_000;
    while (!parseStudioToken(stdout) && Date.now() < tokenDeadline) await sleep(50);
    const token = parseStudioToken(stdout);
    if (!token) {
      throw fail("`Studio token:` banner missing from stdout");
    }
    log("smoke: Studio token banner present");

    // 4. /api/shutdown (token-gated) -> clean exit.
    const shutdown = await request("POST", port, "/api/shutdown", {
      headers: { "X-Studio-Token": token },
    }).catch((e) => {
      throw fail(`POST /api/shutdown failed: ${e.message}`);
    });
    if (shutdown.status !== 200) {
      throw fail(`POST /api/shutdown returned ${shutdown.status}: ${shutdown.body}`);
    }
    log(`smoke: POST /api/shutdown -> ${shutdown.status} ${shutdown.body.trim()}`);

    const exit = await Promise.race([exitPromise, sleep(exitTimeoutMs).then(() => null)]);
    if (!exit) {
      throw fail(`sidecar did not exit within ${exitTimeoutMs} ms after /api/shutdown`);
    }
    if (exit.code !== 0) {
      throw fail(`sidecar exit code after shutdown: ${exit.code} (signal ${exit.signal})`);
    }
    log(`smoke: exited ${exit.code} -- PASS`);
    flush();
    return { port, binary, outPath, errPath };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--log-dir" && argv[i + 1]) out.logDir = path.resolve(argv[++i]);
    else if (a === "--timeout" && argv[i + 1]) out.portTimeoutMs = Number(argv[++i]);
    else if (!a.startsWith("--")) out.binary = path.resolve(a);
  }
  return out;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  smokeSidecar(parseArgs(process.argv.slice(2)))
    .then((r) => {
      console.log(`smoke: OK (${path.relative(ROOT_DIR, r.binary)}, port ${r.port})`);
    })
    .catch((err) => {
      console.error(`smoke: FAIL -- ${err && err.message ? err.message : err}`);
      if (err && err.details) console.error(err.details);
      process.exit(1);
    });
}
