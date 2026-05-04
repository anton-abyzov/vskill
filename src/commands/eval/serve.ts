// ---------------------------------------------------------------------------
// vskill eval serve -- start the eval UI web server
// ---------------------------------------------------------------------------

import { resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
// 0706 T-007: dropped `execSync` — no more lsof/ps shell-outs (Windows had
// no lsof, no POSIX ps, which crashed `vskill studio` on Windows).
import * as net from "node:net";
import { join } from "node:path";
import { startEvalServer } from "../../eval-server/eval-server.js";
import { yellow, dim, red, cyan, bold, green } from "../../utils/output.js";
import { isSkillCreatorInstalled } from "../../utils/skill-creator-detection.js";

/**
 * Deterministic port for a project path.
 * Maps the absolute path to a port in range 3077-3177 using a hash.
 * Same project always gets the same port — bookmarkable, no collisions.
 */
export function projectPort(rootPath: string): number {
  const hash = createHash("md5").update(rootPath).digest();
  const offset = hash.readUInt16BE(0) % 101; // 0-100
  return 3077 + offset;
}

function checkSkillCreator(root: string): void {
  if (!isSkillCreatorInstalled(root)) {
    console.log(
      yellow("\n  Skill-Creator not detected.") +
        "\n\n" +
        dim("  The Skill-Creator skill provides the gold-standard evaluation\n") +
        dim("  methodology (grading, blind A/B comparison, analysis).\n") +
        dim("  The eval UI uses the same methodology natively, but for best\n") +
        dim("  results, install the Skill-Creator skill:\n\n") +
        "  1. Install via npx:       " +
        "npx vskill install anthropics/skills/skill-creator" +
        "\n" +
        "  2. Or browse the source:  " +
        "https://github.com/anthropics/skills/tree/main/skills/skill-creator" +
        "\n" +
        "  3. Then reload plugins:   " +
        "Restart your AI coding agent or start a new session" +
        "\n",
    );
  }
}

// ---------------------------------------------------------------------------
// Port conflict resolution
// ---------------------------------------------------------------------------

/** Quick TCP probe to check if a port is in use. */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => { server.close(() => resolve(false)); });
    server.listen(port);
  });
}

/** Probe a port to see if it's a vskill eval server. */
async function probeVskillServer(port: number): Promise<{ projectName: string | null; root: string; model: string } | null> {
  try {
    const resp = await fetch(`http://localhost:${port}/api/config`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { projectName?: string; root?: string; model?: string };
    if (data.root) {
      return { projectName: data.projectName || null, root: data.root, model: data.model || "unknown" };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 0706 T-007: Windows-safe port-conflict handler.
 *
 * The prior implementation shelled out to `lsof -ti:${port}` and `ps -p`
 * to discover which process owned the port. Neither tool exists on
 * Windows — `vskill studio` crashed there. Replacement strategy:
 *
 * 1. HTTP-probe the port with `probeVskillServer(port)` — if it returns
 *    vskill identity, reuse the existing server (same contract as before).
 * 2. Otherwise, print the Windows-safe "port in use by a non-vskill
 *    process — please free it manually" message and exit.
 *
 * We drop the PID discovery + kill-and-confirm flow entirely: it didn't
 * work on Windows, and telling the user "PID 4723 is node.exe" isn't
 * actionable. The probe alone distinguishes our server from everything
 * else, which is the only discrimination `vskill studio` needs.
 */
function killHint(port: number): string {
  // Printable strings only — vskill itself doesn't shell out (Windows-safe).
  // Show both Unix and Windows so the user can copy whichever applies.
  const unix = `lsof -ti:${port} | xargs kill`;
  const win = `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`;
  return (
    `  ${dim("To free the port (macOS/Linux):")} ${cyan(unix)}\n` +
    `  ${dim("To free the port (Windows):    ")} ${cyan(win)}\n`
  );
}

/**
 * Ask the running vskill server to shut itself down via POST /api/shutdown,
 * then poll until the port is free (or timeout). Returns true if the port
 * is free and the caller can proceed to bind it.
 */
export async function requestShutdownAndWait(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/api/shutdown`, {
      method: "POST",
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // The server typically closes the connection mid-response while shutting
    // down — fetch may reject. That's fine; verify by polling the port.
  }

  // Poll up to ~5s in 100ms ticks for the port to free.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!(await isPortInUse(port))) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * @returns true if the caller should proceed to start a fresh server on
 *   `port` (i.e. --force successfully freed the port). On every other
 *   outcome this function calls `process.exit(...)` directly and never
 *   returns.
 */
async function handlePortConflict(
  port: number,
  resolvedRoot: string,
  force: boolean,
): Promise<boolean> {
  const existing = await probeVskillServer(port);

  if (existing) {
    if (force) {
      const sameProject = existing.root === resolvedRoot;
      console.log(
        `\n  ${dim("Force-restarting existing vskill server on port")} ${cyan(String(port))}${sameProject ? dim(" (same project)") : dim(` (was: ${existing.projectName || "unknown"})`)}…`,
      );
      const freed = await requestShutdownAndWait(port);
      if (!freed) {
        console.error(
          red(`\n  Force-restart failed: port ${port} is still in use after shutdown request.\n\n`) +
          killHint(port) +
          "\n",
        );
        process.exit(1);
      }
      console.log(`  ${green("✓")} ${dim("Port freed — starting fresh server.")}\n`);
      return true;
    }

    const sameProject = existing.root === resolvedRoot;
    console.log(
      `\n  ${bold("Port")} ${cyan(String(port))} ${bold("is already in use by a vskill server:")}` +
      `\n  ${bold("Project:")}  ${cyan(existing.projectName || "unknown")}${sameProject ? dim(" (same project)") : ""}` +
      `\n  ${bold("Root:")}     ${dim(existing.root)}` +
      `\n  ${bold("Model:")}    ${dim(existing.model)}` +
      `\n\n  ${dim("Open the browser to:")} ${cyan(`http://localhost:${port}`)}` +
      `\n\n  ${bold("Or force-restart in place")} ${dim("(stops the existing server and starts fresh):")}` +
      `\n  ${cyan("vskill studio --force")}    ${dim("# or: vskill eval serve --force")}` +
      `\n\n  ${dim("Or kill the existing server manually and re-run vskill studio:")}\n` +
      killHint(port) +
      "\n",
    );
    // Reuse semantics: exit cleanly so the user can point their browser.
    process.exit(0);
  }

  // Port occupied by a non-vskill process. No PID discovery (Windows can't
  // do it portably, and the PID wasn't actionable anyway). Print kill hints
  // for both platforms so the user can free the port without leaving the
  // terminal. --force can't help here — we have no shutdown endpoint to call
  // on a process we don't own.
  console.error(
    red(`\n  Port ${port} is in use by a non-vskill process — please free it manually.\n`) +
    dim(`  (--force only works against an existing vskill server; the running process here is something else.)\n\n`) +
    killHint(port) +
    `\n  ${dim("Or pick a different port:")} ${cyan(`vskill studio --port ${port + 1}`)}\n`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runEvalServe(
  root: string,
  port: number | null,
  options: { force?: boolean } = {},
): Promise<void> {
  const resolvedRoot = resolve(root);
  const force = options.force === true;

  checkSkillCreator(resolvedRoot);

  if (!existsSync(resolvedRoot)) {
    console.error(
      red(`\n  Directory not found: ${resolvedRoot}\n`) +
      dim("  Check the --root path. If running from the umbrella root, use the full path:\n") +
      dim(`  vskill eval serve --root repositories/org/vskill/plugins/...\n`),
    );
    process.exit(1);
  }

  const effectivePort = port ?? projectPort(resolvedRoot);
  const name = basename(resolvedRoot);

  // 0702 T-041: prompt to configure API key on first run if none detected.
  // Non-TTY / already-configured → silent skip.
  const { firstRunOnboarding } = await import("../../first-run-onboarding.js");
  await firstRunOnboarding();

  // Handle port conflicts gracefully. Returns true only on the --force
  // success path (existing vskill server gracefully shut down); every
  // other branch process.exit()s inside.
  if (await isPortInUse(effectivePort)) {
    await handlePortConflict(effectivePort, resolvedRoot, force);
  }

  const server = await startEvalServer({
    port: effectivePort,
    root: resolvedRoot,
    projectName: name,
  });

  // Graceful shutdown — idempotent so SIGINT + SIGTERM (or two SIGINTs from
  // a parent shell forwarding) don't print the banner twice or race the
  // exit timer. 0826: previously a single ^C printed "Shutting down…" twice
  // because the shell delivered both SIGINT and SIGTERM.
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down eval server...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
