import os from "node:os";

/**
 * Resolve leading `~` in a path to the user's home directory.
 * Passes through absolute and relative paths unchanged.
 */
export function resolveTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return os.homedir() + p.slice(1);
  return p;
}
