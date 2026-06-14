// Shared helpers for verify units that spawn the real vskill bin.
// Every unit MUST go through these to keep env isolation + the vskill binary
// path in one place.

import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 0857: harness was promoted from the umbrella increment into the vskill repo.
// It now lives at <vskill>/test/verify/lib, so the vskill repo root is 3 levels
// up and the binary is the in-repo dist build. Fixtures live beside the harness
// at <vskill>/test/verify/fixtures.
export const REPO_ROOT = resolve(__dirname, "../../..");
export const VSKILL_BIN = join(REPO_ROOT, "dist/bin.js");
export const FIXTURE_SOURCE = join(__dirname, "..", "fixtures", "tiny-skill-source");

// Agent dot-dirs are discovered dynamically: vskill cross-installs to every
// agent it detects on the host (binary on PATH or config dir), and that set
// varies per machine and registry version (e.g. 1.0.21 targets
// claude/codex/gemini/openclaw/opencode — not the 1.0.18-era cursor/kiro/
// aider/pi). Any dot-dir in the workdir with a skills/ subtree is an agent dir.
function discoverAgentDirs(workdir) {
  return readdirSync(workdir).filter((d) => {
    if (!d.startsWith(".")) return false;
    const skillsRoot = join(workdir, d, "skills");
    return existsSync(skillsRoot) && statSync(skillsRoot).isDirectory();
  });
}

/** Spawn vskill in a workdir with HOME redirected. Returns { status, stdout, stderr } */
export function runVskill(args, ctx, opts = {}) {
  const env = {
    ...process.env,
    HOME: ctx.workdir,
    CLAUDE_HOME: join(ctx.workdir, ".claude"),
    XDG_CONFIG_HOME: join(ctx.workdir, ".config"),
    VSKILL_DISABLE_TELEMETRY: "1",
    NO_COLOR: "1",
    ...ctx.env,
    ...(opts.env || {}),
  };
  return spawnSync(process.execPath, [VSKILL_BIN, ...args], {
    cwd: ctx.workdir,
    env,
    encoding: "utf8",
    timeout: opts.timeout || 30000,
  });
}

/** One-line helper: install the tiny-test-plugin fixture into ctx.workdir. */
export function installBaseline(ctx, extraArgs = []) {
  return runVskill(
    [
      "install",
      "--plugin-dir",
      FIXTURE_SOURCE,
      "--plugin",
      "tiny-test-plugin",
      "--cwd",
      "--no-enable",
      "--yes",
      ...extraArgs,
    ],
    ctx,
  );
}

/** Walk every detected agent dir and return all installed skills as flat list. */
export function readInstalledSkills(workdir) {
  const installed = [];
  for (const ag of discoverAgentDirs(workdir)) {
    const root = join(workdir, ag, "skills");
    if (!existsSync(root)) continue;
    for (const plugin of readdirSync(root)) {
      const pDir = join(root, plugin);
      if (!statSync(pDir).isDirectory()) continue;
      for (const skill of readdirSync(pDir)) {
        const md = join(pDir, skill, "SKILL.md");
        if (!existsSync(md)) continue;
        installed.push({ agent: ag, plugin, name: skill, path: md, bytes: statSync(md).size });
      }
    }
  }
  return installed;
}

/** Read lockfile JSON if present in any of the known locations. */
export function readLockfile(workdir) {
  const candidates = [
    join(workdir, "vskill.lock"),
    join(workdir, ".specweave", "state", "vskill.lock"),
    join(workdir, ".claude", "vskill.lock"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return { path: p, body: JSON.parse(readFileSync(p, "utf8")) };
    } catch {
      return { path: p, body: null };
    }
  }
  return { path: null, body: null };
}

/** Minimal schema validator — fail when required keys are missing or wrong type. */
export function simpleValidator(required) {
  return {
    safeParse(value) {
      const issues = [];
      if (typeof value !== "object" || value === null) issues.push("not an object");
      else {
        for (const [k, t] of Object.entries(required)) {
          if (!(k in value)) issues.push(`missing key: ${k}`);
          else if (t && typeof value[k] !== t && !(t === "array" && Array.isArray(value[k])))
            issues.push(`wrong type for ${k}: expected ${t}, got ${typeof value[k]}`);
        }
      }
      return issues.length ? { success: false, error: { issues } } : { success: true, data: value };
    },
  };
}

/**
 * Spawn vskill studio in background.
 * Resolves with { child, token } once /api/health responds AND the studio token
 * has been parsed from stdout. The token is required for all /api/* calls
 * except /api/health (router.ts tokenGate).
 */
export async function startStudio(ctx, port) {
  const env = {
    ...process.env,
    HOME: ctx.workdir,
    CLAUDE_HOME: join(ctx.workdir, ".claude"),
    XDG_CONFIG_HOME: join(ctx.workdir, ".config"),
    VSKILL_DISABLE_TELEMETRY: "1",
    NO_COLOR: "1",
    BROWSER: "none",
  };
  const child = spawn(
    process.execPath,
    [VSKILL_BIN, "studio", "--root", ctx.workdir, "--port", String(port), "--force"],
    { cwd: ctx.workdir, env, stdio: ["ignore", "pipe", "pipe"], detached: false },
  );

  let token = null;
  let buf = "";
  const tokenRe = /Studio token:\s*([A-Za-z0-9._\-]+)/;
  child.stdout.on("data", (b) => {
    buf += b.toString();
    if (!token) {
      const m = tokenRe.exec(buf);
      if (m) token = m[1];
    }
  });
  child.stderr.on("data", () => {});

  const start = Date.now();
  while (Date.now() - start < 45000) {
    if (token) {
      try {
        await httpGet(`http://127.0.0.1:${port}/api/health`);
        return { child, token };
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`studio did not respond on port ${port} within 45s (token=${!!token})`);
}

export function stopStudio(child) {
  if (!child) return;
  try {
    child.kill("SIGTERM");
    setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1500);
  } catch {}
}

/** Tiny GET wrapper that resolves with parsed JSON. Accepts optional headers. */
export function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http
      .request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: "GET",
          headers,
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            if (res.statusCode >= 400) return reject(new Error(`http ${res.statusCode}: ${data.slice(0, 200)}`));
            try {
              resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
            } catch {
              resolve({ status: res.statusCode, body: data });
            }
          });
        },
      )
      .on("error", reject)
      .end();
  });
}

/** Grab a real free ephemeral TCP port (OS-assigned) to avoid collisions in the daily suite. */
export async function pickPort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));
  return port;
}
