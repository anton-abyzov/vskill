// ---------------------------------------------------------------------------
// vskill eval serve -- start the eval UI web server
// ---------------------------------------------------------------------------

import { resolve, basename } from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import * as net from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { startEvalServer } from "../../eval-server/eval-server.js";
import { yellow, dim, red, cyan, bold } from "../../utils/output.js";
import { createPrompter } from "../../utils/prompts.js";

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

function checkSkillCreator(): void {
  const home = homedir();
  const locations = [
    join(home, ".claude", "plugins", "cache", "claude-plugins-official", "skill-creator"),
    join(home, ".claude", "skills", "skill-creator.md"),
    join(home, ".claude", "plugins", "cache", "specweave", "sw", "1.0.0", "skills", "skill-creator"),
  ];

  const found = locations.some((loc) => existsSync(loc));

  if (!found) {
    console.log(
      yellow("\n  Skill-Creator not detected.") +
        "\n\n" +
        dim("  The Skill-Creator skill provides the gold-standard evaluation\n") +
        dim("  methodology (grading, blind A/B comparison, analysis).\n") +
        dim("  The eval UI uses the same methodology natively, but for best\n") +
        dim("  results, install the Skill-Creator skill:\n\n") +
        "  1. Install via vskill:    " +
        "vskill install anthropics/skills/skill-creator" +
        "\n" +
        "  2. Or browse the source:  " +
        "https://github.com/anthropics/skills/tree/main/skills/skill-creator" +
        "\n" +
        "  3. Then reload plugins:   " +
        "Restart Claude Code or run a new session" +
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

/** Find the PID using a port. */
function findProcessOnPort(port: number): { pid: number; command: string } | null {
  try {
    const output = execSync(`lsof -ti:${port}`, { encoding: "utf-8", timeout: 3000 }).trim();
    const pid = parseInt(output.split("\n")[0], 10);
    if (!pid) return null;
    const cmd = execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8", timeout: 3000 }).trim();
    return { pid, command: cmd.slice(0, 120) };
  } catch {
    return null;
  }
}

/** Kill a process and wait for the port to actually free up. */
async function killAndWait(pid: number, port: number): Promise<void> {
  try { process.kill(pid, "SIGTERM"); } catch { return; }

  // Wait for process to exit
  const procDeadline = Date.now() + 3000;
  while (Date.now() < procDeadline) {
    try { process.kill(pid, 0); } catch { break; } // gone
    await new Promise((r) => setTimeout(r, 100));
  }
  // Force-kill if still alive
  try { process.kill(pid, 0); process.kill(pid, "SIGKILL"); } catch { /* already dead */ }

  // Wait for port to actually free up (OS may hold it briefly after process exits)
  const portDeadline = Date.now() + 5000;
  while (Date.now() < portDeadline) {
    if (!(await isPortInUse(port))) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Handle port conflict — show what's running and ask user to confirm kill.
 */
async function handlePortConflict(port: number, resolvedRoot: string): Promise<void> {
  const existing = await probeVskillServer(port);
  const proc = findProcessOnPort(port);
  const prompter = createPrompter();

  if (existing) {
    const sameProject = existing.root === resolvedRoot;

    console.log(
      `\n  ${bold("Port")} ${cyan(String(port))} ${bold("is already in use:")}` +
      `\n  ${bold("Project:")}  ${cyan(existing.projectName || "unknown")}${sameProject ? dim(" (same project)") : ""}` +
      `\n  ${bold("Root:")}     ${dim(existing.root)}` +
      `\n  ${bold("Model:")}    ${dim(existing.model)}` +
      (proc ? `\n  ${bold("PID:")}      ${dim(String(proc.pid))}` : "") +
      "\n",
    );

    const confirmed = await prompter.promptConfirm(
      `  Kill it and restart?`,
      sameProject, // default Y for same project, N for different
    );

    if (!confirmed) {
      console.log(dim(`\n  Aborted. Use ${cyan(`vskill eval serve --port ${port + 1}`)} for a different port.\n`));
      process.exit(0);
    }

    if (proc) {
      console.log(dim(`  Stopping process ${proc.pid}...`));
      await killAndWait(proc.pid, port);
    }
    return;
  }

  // Not a vskill server — unknown process
  if (proc) {
    console.log(
      `\n  ${bold("Port")} ${cyan(String(port))} ${bold("is in use by another process:")}` +
      `\n  ${bold("PID:")}      ${proc.pid}` +
      `\n  ${bold("Command:")}  ${dim(proc.command)}` +
      "\n",
    );

    const confirmed = await prompter.promptConfirm(`  Kill it and proceed?`, false);

    if (!confirmed) {
      console.log(dim(`\n  Aborted. Use ${cyan(`vskill eval serve --port ${port + 1}`)} for a different port.\n`));
      process.exit(0);
    }

    console.log(dim(`  Stopping process ${proc.pid}...`));
    await killAndWait(proc.pid, port);
    return;
  }

  // Port in use but can't identify the process
  console.error(
    red(`\n  Port ${port} is in use but the process could not be identified.\n`) +
    `  ${dim("Try:")} ${cyan(`vskill eval serve --port ${port + 1}`)}\n`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runEvalServe(
  root: string,
  port: number | null,
): Promise<void> {
  checkSkillCreator();

  const resolvedRoot = resolve(root);

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

  // Handle port conflicts gracefully
  if (await isPortInUse(effectivePort)) {
    await handlePortConflict(effectivePort, resolvedRoot);
  }

  const server = await startEvalServer({
    port: effectivePort,
    root: resolvedRoot,
    projectName: name,
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down eval server...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
