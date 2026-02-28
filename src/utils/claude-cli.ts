import { execSync } from "node:child_process";

/**
 * Check if `claude` CLI binary is available in PATH.
 */
export function isClaudeCliAvailable(): boolean {
  try {
    execSync("claude --version", { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Register a Claude Code plugin marketplace.
 *
 * Accepts either a git URL (preferred — Claude Code clones to a persistent
 * location) or an absolute local path. Using a git URL avoids the stale-path
 * bug where a temp directory is deleted after registration.
 *
 * @param source - Git URL (e.g. "https://github.com/owner/repo") or absolute path
 * @returns true on success, false on failure
 */
export function registerMarketplace(source: string): boolean {
  try {
    execSync(`claude plugin marketplace add "${source}"`, {
      stdio: "ignore",
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a plugin from a registered marketplace.
 *
 * @param pluginName - Plugin name (e.g. "frontend")
 * @param marketplaceName - Marketplace name from marketplace.json (e.g. "vskill")
 * @returns true on success, false on failure
 */
export function installNativePlugin(pluginName: string, marketplaceName: string): boolean {
  const pluginKey = `${pluginName}@${marketplaceName}`;
  try {
    execSync(`claude plugin install "${pluginKey}"`, {
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
  const pluginKey = `${pluginName}@${marketplaceName}`;
  try {
    execSync(`claude plugin uninstall "${pluginKey}"`, {
      stdio: "ignore",
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}
