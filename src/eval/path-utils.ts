// ---------------------------------------------------------------------------
// 0686 — cross-platform path resolution for agent skill scopes.
//
// Single source of truth for expanding `~`-prefixed registry paths and
// resolving an agent's globalSkillsDir to the platform-native absolute path.
// Every `/api/*` response must go through these helpers so no response
// contains a `~` literal (AC-US7-04) and every path satisfies
// `path.isAbsolute` on the current platform.
//
// Design (ADR-04):
//   - Use `os.platform()` at call time (not at module-eval) so tests can
//     mock the platform via `vi.spyOn(os, "platform")`.
//   - Use `path.posix` or `path.win32` explicitly based on the mocked
//     platform so tests behave identically on any host OS.
//   - win32 deterministic fallback: registry entries starting with
//     `~/.config/X/` map to `%APPDATA%/X/` expanded as
//     `<homedir>/AppData/Roaming/X/` with native separators.
// ---------------------------------------------------------------------------

import * as os from "node:os";
import path from "node:path";
import type { AgentDefinition } from "../agents/agents-registry.js";

/** Pick the path module that matches the effective platform. */
function pathFor(platform: NodeJS.Platform): typeof path.posix | typeof path.win32 {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Expand a leading `~` (or `~/`) in `p` to the current user's home directory
 * using platform-native separators.
 *
 * Accepts both `/` and `\` as input separators so POSIX-shaped registry
 * entries (e.g. `~/.claude/skills`) survive the trip through a win32 runtime.
 * Returns absolute + tilde-free output for every expandable input.
 */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (!p.startsWith("~/") && !p.startsWith("~\\")) return p;

  const rest = p.slice(1).replace(/^[/\\]+/, "");
  const parts = rest.length > 0 ? rest.split(/[/\\]+/) : [];
  const platform = os.platform();
  const pMod = pathFor(platform);
  return pMod.join(os.homedir(), ...parts);
}

/**
 * Resolve an agent's globalSkillsDir to a fully-qualified absolute path for
 * the current platform.
 *
 * Resolution order on win32:
 *   1. `agent.win32PathOverride` (explicit escape hatch)
 *   2. `~/.config/X/...` deterministic fallback to `%APPDATA%/X/...`
 *   3. Default: `expandHome(agent.globalSkillsDir)`
 *
 * On darwin + linux: always `expandHome(agent.globalSkillsDir)`. The
 * `win32PathOverride` is intentionally ignored on non-win32 so POSIX
 * hosts keep behaving exactly as they did before.
 */
export function resolveGlobalSkillsDir(agent: AgentDefinition): string {
  const platform = os.platform();
  if (platform === "win32") {
    if (agent.win32PathOverride) {
      return expandHome(agent.win32PathOverride);
    }
    const CONFIG_PREFIX = "~/.config/";
    if (agent.globalSkillsDir.startsWith(CONFIG_PREFIX)) {
      const tail = agent.globalSkillsDir.slice(CONFIG_PREFIX.length);
      const parts = tail.split(/[/\\]+/);
      return path.win32.join(os.homedir(), "AppData", "Roaming", ...parts);
    }
  }
  return expandHome(agent.globalSkillsDir);
}
