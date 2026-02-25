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
 * Register a local directory as a Claude Code plugin marketplace.
 *
 * @param marketplacePath - Absolute path to the repo root containing .claude-plugin/marketplace.json
 * @returns true on success, false on failure
 */
export function registerMarketplace(marketplacePath: string): boolean {
  try {
    execSync(`claude plugin marketplace add "${marketplacePath}"`, {
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
