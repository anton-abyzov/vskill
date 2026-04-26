import type { InstalledPlugin } from "./plugin-cli.js";

/**
 * Resolve a bare plugin name (e.g. "skill-creator") to the full
 * `name@marketplace` form Claude Code requires for `enable`/`disable`/
 * `uninstall`. The CLI returns errors like "Use plugin@marketplace format"
 * when invoked with the bare name; this lookup makes the route layer
 * resilient to UIs that only know the short name.
 *
 * Behavior:
 *  - Already has "@" → returned as-is (don't override an explicit choice).
 *  - Bare name found in `installed` → returns `name@marketplace`.
 *  - Bare name not found, or list is empty → returns bare name unchanged
 *    so the CLI surfaces its real error message.
 */
export function resolvePluginRef(
  name: string,
  installed: InstalledPlugin[],
): string {
  if (name.includes("@")) return name;
  const match = installed.find((p) => p.name === name);
  if (!match) return name;
  return `${name}@${match.marketplace}`;
}
