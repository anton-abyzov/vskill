// ---------------------------------------------------------------------------
// Cross-platform CLI binary resolver
//
// When Node.js spawns a child process, it inherits the parent's PATH.
// But in many environments the PATH is limited:
//   - macOS: GUI-launched apps (Spotlight, Dock) don't load ~/.zshrc
//   - Linux: systemd services have minimal PATH (/usr/bin:/bin)
//   - Windows: npm global bin may not be in system PATH
//   - All: non-interactive shells skip profile/rc files
//
// This module resolves CLI binary names (e.g. "claude", "codex", "gemini")
// to their full absolute path using multiple strategies, and builds an
// enhanced PATH for child processes.
// ---------------------------------------------------------------------------

import { execSync, exec } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";

// 0703 follow-up: hand-rolled promise wrapper for `exec` so we don't have to
// pull `promisify` from node:util (vite's browser shim exports nothing). The
// UI bundle never reaches this — the vite config at src/eval-ui/vite.config.ts
// intercepts `node:*` specifiers with a throwing proxy. Server + vitest
// imports retain their normal behaviour, so the 0706 tests that mock
// `node:child_process` still work end-to-end.
function execPromise(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Build a platform-appropriate "is this binary on PATH?" command.
 *
 * On Windows, `cmd.exe` doesn't know about `which` — the equivalent is
 * `where`. On macOS/Linux, `which` is the canonical choice. This helper
 * keeps the branching in one place so callers don't duplicate the check.
 *
 * 0706 T-001: foundation for platform-aware agent detection.
 */
export function buildDetectCommand(binary: string): string {
  return process.platform === "win32" ? `where ${binary}` : `which ${binary}`;
}

/**
 * Async "is this binary on PATH?" probe. Returns true when the binary is
 * found via `which`/`where`, false otherwise. Never throws — non-zero exit
 * codes and spawn failures both resolve to `false`.
 *
 * Intended for use inside agent-registry `detectInstalled` functions where
 * a one-shot "present or not" answer is enough.
 *
 * 0706 T-001: replaces ad-hoc `exec("which X")` strings in agents-registry.ts
 * so Windows installs can detect agents without piping through shell.
 */
export async function detectBinary(binary: string): Promise<boolean> {
  try {
    await execPromise(buildDetectCommand(binary));
    return true;
  } catch {
    return false;
  }
}

/** Cache resolved paths to avoid repeated lookups within a session */
const resolvedCache = new Map<string, string>();

/**
 * Resolve a CLI binary name to its full absolute path.
 *
 * Tries multiple strategies in order:
 *   1. Current PATH via `which` / `where`
 *   2. Login shell PATH (picks up .zshrc/.bashrc additions)
 *   3. npm global bin directory
 *   4. Common installation directories per OS
 *   5. Falls back to bare name (lets spawn produce a clear ENOENT error)
 *
 * Results are cached per binary name for the lifetime of the process.
 */
export function resolveCliBinary(name: string): string {
  const cached = resolvedCache.get(name);
  if (cached) return cached;

  const resolved = doResolve(name);
  resolvedCache.set(name, resolved);
  return resolved;
}

/**
 * Build an enhanced PATH string that includes common binary directories.
 * Use this when spawning child processes to ensure they can find binaries
 * even if the parent process has a limited PATH.
 */
export function enhancedPath(currentPath?: string): string {
  const base = currentPath || process.env.PATH || "";
  const extra = getExtraPaths();

  // Deduplicate the entire PATH: base entries + extra dirs
  // Preserves first-occurrence order (important for PATH precedence)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const dir of base.split(delimiter)) {
    if (dir && !seen.has(dir)) {
      seen.add(dir);
      deduped.push(dir);
    }
  }
  for (const dir of extra) {
    if (!seen.has(dir)) {
      seen.add(dir);
      deduped.push(dir);
    }
  }

  return deduped.join(delimiter);
}

/** Clear the resolution cache (useful for testing) */
export function clearResolveCache(): void {
  resolvedCache.clear();
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function doResolve(name: string): string {
  // Strategy 1: Check current PATH via which/where
  const fromPath = tryWhich(name);
  if (fromPath) return fromPath;

  // Strategy 2: Login shell (macOS/Linux — picks up .zshrc/.bashrc PATH)
  if (process.platform !== "win32") {
    const fromLogin = tryLoginShellWhich(name);
    if (fromLogin) return fromLogin;
  }

  // Strategy 3: npm global bin directory
  const fromNpm = tryNpmGlobalBin(name);
  if (fromNpm) return fromNpm;

  // Strategy 4: Check common installation directories
  const fromCommon = tryCommonPaths(name);
  if (fromCommon) return fromCommon;

  // Strategy 5: Return bare name — spawn will produce ENOENT with clear error
  return name;
}

/** Try `which` (Unix) or `where` (Windows) on current PATH */
function tryWhich(name: string): string | null {
  try {
    const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
    const result = execSync(cmd, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3_000,
    }).toString().trim();
    // `where` on Windows may return multiple lines — take the first
    const first = result.split("\n")[0]?.trim();
    if (first && !first.includes("not found")) return first;
  } catch {
    // Not found on current PATH
  }
  return null;
}

/** Try to find binary via login shell which (loads full profile PATH) */
function tryLoginShellWhich(name: string): string | null {
  const shell = process.env.SHELL || "/bin/sh";
  try {
    // Use login (-l) to load full PATH from .zshrc/.bashrc/.profile
    // IMPORTANT: Pass minimal env with only HOME and USER so the login shell
    // starts fresh and sources profile files from scratch. If we pass the
    // parent's restricted PATH, the profile scripts may not work properly.
    const result = execSync(
      `${shell} -lc 'which ${name} 2>/dev/null'`,
      {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5_000,
        env: {
          HOME: process.env.HOME || homedir(),
          USER: process.env.USER || "",
          SHELL: shell,
          TERM: process.env.TERM || "xterm-256color",
          PS1: "", // suppress prompt rendering
        },
      },
    ).toString().trim();
    if (result && !result.includes("not found") && existsSync(result)) {
      return result;
    }
  } catch {
    // Login shell resolution failed
  }
  return null;
}

/** Try to find binary in npm's global bin directory */
function tryNpmGlobalBin(name: string): string | null {
  const binName = process.platform === "win32" ? `${name}.cmd` : name;

  // Try `npm config get prefix` (more reliable than deprecated `npm bin -g`)
  try {
    const prefix = execSync("npm config get prefix", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    }).toString().trim();

    if (prefix) {
      // On Unix: prefix/bin/name, On Windows: prefix/name.cmd
      const candidate = process.platform === "win32"
        ? join(prefix, binName)
        : join(prefix, "bin", binName);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // npm not available or timed out
  }

  return null;
}

/** Try common installation directories per platform */
function tryCommonPaths(name: string): string | null {
  const home = homedir();
  const candidates: string[] = [];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) candidates.push(join(appData, "npm", `${name}.cmd`));
    const progFiles = process.env.ProgramFiles;
    if (progFiles) candidates.push(join(progFiles, "nodejs", `${name}.cmd`));
  } else {
    candidates.push(
      // Homebrew (Apple Silicon + Intel)
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
      // User-local installs
      join(home, ".local", "bin", name),
      // npm global with custom prefix
      join(home, ".npm-global", "bin", name),
      join(home, ".npm", "bin", name),
    );

    // nvm: check current default if NVM_DIR is set
    const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
    const nvmVersionsDir = join(nvmDir, "versions", "node");
    if (existsSync(nvmVersionsDir)) {
      try {
        // Try to read default alias to narrow down the version
        const aliasPath = join(nvmDir, "alias", "default");
        let versionHint = "";
        if (existsSync(aliasPath)) {
          versionHint = readFileSync(aliasPath, "utf8").trim().replace(/^v/, "");
        }

        const dirs = readdirSync(nvmVersionsDir).sort();
        if (versionHint) {
          // Find the best match for the version hint
          const match = dirs.filter((d) => d.startsWith("v" + versionHint)).pop();
          if (match) candidates.push(join(nvmVersionsDir, match, "bin", name));
        }
        // Also try the latest installed version as fallback
        const latest = dirs.pop();
        if (latest) candidates.push(join(nvmVersionsDir, latest, "bin", name));
      } catch {
        // nvm resolution failed
      }
    }

    // fnm (Fast Node Manager)
    const fnmDir = process.env.FNM_DIR || join(home, ".fnm");
    const fnmVersionsDir = join(fnmDir, "node-versions");
    if (existsSync(fnmVersionsDir)) {
      try {
        const dirs = readdirSync(fnmVersionsDir).sort();
        const latest = dirs.pop();
        if (latest) {
          candidates.push(join(fnmVersionsDir, latest, "installation", "bin", name));
        }
      } catch {
        // fnm resolution failed
      }
    }

    // Volta
    const voltaHome = process.env.VOLTA_HOME || join(home, ".volta");
    candidates.push(join(voltaHome, "bin", name));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/** Get extra PATH directories to include when spawning child processes */
function getExtraPaths(): string[] {
  const home = homedir();
  const paths: string[] = [];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) paths.push(join(appData, "npm"));
    const progFiles = process.env.ProgramFiles;
    if (progFiles) paths.push(join(progFiles, "nodejs"));
  } else {
    paths.push(
      "/opt/homebrew/bin",
      "/usr/local/bin",
      join(home, ".local", "bin"),
      join(home, ".npm-global", "bin"),
      join(home, ".npm", "bin"),
    );

    // npm global prefix bin
    try {
      const prefix = execSync("npm config get prefix", {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 3_000,
      }).toString().trim();
      if (prefix) paths.push(join(prefix, "bin"));
    } catch {
      // npm not available
    }

    // Volta
    const voltaHome = process.env.VOLTA_HOME || join(home, ".volta");
    paths.push(join(voltaHome, "bin"));
  }

  // Only include directories that actually exist
  return paths.filter((p) => existsSync(p));
}
