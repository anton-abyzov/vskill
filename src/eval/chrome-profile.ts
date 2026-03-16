// ---------------------------------------------------------------------------
// chrome-profile.ts -- macOS Chrome profile path resolver
// ---------------------------------------------------------------------------

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export class UnsupportedPlatformError extends Error {
  constructor(currentPlatform: string) {
    super(
      `Chrome profile resolution is only supported on macOS. ` +
      `Current platform: ${currentPlatform}. ` +
      `Linux and Windows support is planned for a future release.`,
    );
    this.name = "UnsupportedPlatformError";
  }
}

/**
 * Get the base Chrome user data directory on macOS.
 */
function getChromeBaseDir(): string {
  return join(homedir(), "Library", "Application Support", "Google", "Chrome");
}

/**
 * Resolve a Chrome profile name to its absolute directory path.
 *
 * @param profileName - e.g. "Profile 3", "Default"
 * @returns Absolute path to the profile directory
 * @throws UnsupportedPlatformError on non-macOS
 * @throws Error if profile directory does not exist
 */
export function resolveProfile(profileName: string): string {
  if (platform() !== "darwin") {
    throw new UnsupportedPlatformError(platform());
  }

  const baseDir = getChromeBaseDir();
  const profilePath = join(baseDir, profileName);

  if (!existsSync(profilePath)) {
    const available = listProfiles();
    const profileList = available.length > 0
      ? `Available profiles:\n  ${available.join("\n  ")}`
      : "No Chrome profiles found. Is Chrome installed?";
    throw new Error(
      `Chrome profile "${profileName}" not found at ${profilePath}\n${profileList}`,
    );
  }

  return profilePath;
}

/**
 * List available Chrome profile names.
 */
export function listProfiles(): string[] {
  const baseDir = getChromeBaseDir();
  if (!existsSync(baseDir)) return [];

  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        // Chrome profiles are "Default", "Profile 1", "Profile 2", etc.
        return entry.name === "Default" || entry.name.startsWith("Profile ");
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
