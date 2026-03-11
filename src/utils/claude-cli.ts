import { execSync } from "node:child_process";
import { resolveCliBinary } from "./resolve-binary.js";

/**
 * Check if `claude` CLI binary is available (searches beyond current PATH).
 */
export function isClaudeCliAvailable(): boolean {
  try {
    const binary = resolveCliBinary("claude");
    execSync(`"${binary}" --version`, { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Marketplace registration
// ---------------------------------------------------------------------------

export interface RegisterResult {
  success: boolean;
  stderr?: string;
}

/**
 * Register a Claude Code plugin marketplace.
 *
 * Accepts either a git URL (preferred — Claude Code clones to a persistent
 * location) or an absolute local path. Using a git URL avoids the stale-path
 * bug where a temp directory is deleted after registration.
 *
 * @param source - Git URL (e.g. "https://github.com/owner/repo") or absolute path
 * @returns RegisterResult with success flag and optional stderr on failure
 */
export function registerMarketplace(source: string): RegisterResult {
  const binary = resolveCliBinary("claude");
  try {
    execSync(`"${binary}" plugin marketplace add "${source}"`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    });
    return { success: true };
  } catch (err) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString().trim();
    return { success: false, stderr: stderr || (err as Error).message };
  }
}

/**
 * Deregister a Claude Code plugin marketplace.
 * Used to clean up stale registrations before retrying.
 */
export function deregisterMarketplace(source: string): boolean {
  const binary = resolveCliBinary("claude");
  try {
    execSync(`"${binary}" plugin marketplace remove "${source}"`, {
      stdio: "ignore",
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * List registered Claude Code plugin marketplaces.
 * Returns marketplace source paths/URLs, or empty array on failure.
 */
export function listMarketplaces(): string[] {
  const binary = resolveCliBinary("claude");
  try {
    const output = execSync(`"${binary}" plugin marketplace list`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    }).toString().trim();
    if (!output) return [];
    return output.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Install a plugin from a registered marketplace.
 *
 * @param pluginName - Plugin name (e.g. "frontend")
 * @param marketplaceName - Marketplace name from marketplace.json (e.g. "vskill")
 * @param scope - Installation scope: "user" (global) or "project" (per-project, default)
 * @returns true on success, false on failure
 */
export function installNativePlugin(
  pluginName: string,
  marketplaceName: string,
  scope: "user" | "project" = "project",
): boolean {
  const binary = resolveCliBinary("claude");
  const pluginKey = `${pluginName}@${marketplaceName}`;
  const scopeFlag = scope === "user" ? "" : ` --scope ${scope}`;
  try {
    execSync(`"${binary}" plugin install "${pluginKey}"${scopeFlag}`, {
      stdio: "ignore",
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Uninstall a plugin from Claude Code's native system.
 */
export function uninstallNativePlugin(pluginName: string, marketplaceName: string): boolean {
  const binary = resolveCliBinary("claude");
  const pluginKey = `${pluginName}@${marketplaceName}`;
  try {
    execSync(`"${binary}" plugin uninstall "${pluginKey}"`, {
      stdio: "ignore",
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}
