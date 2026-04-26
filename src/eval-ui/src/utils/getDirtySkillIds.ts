// ---------------------------------------------------------------------------
// 0759 Phase 6 — getDirtySkillIds.
//
// Pure resolver. Maps a flat list of git-dirty paths (porcelain output, as
// returned by /api/git/status) onto the set of skills whose directory
// contains those paths, so the sidebar can highlight authored skills with
// uncommitted changes.
//
// Inputs:
//   - skills: SkillInfo[] from /api/skills (each carries an absolute `dir`).
//   - dirtyPaths: string[] relative to the workspace root. Tolerates an
//     optional leading 3-char porcelain status (" M ", "?? ", etc.) for
//     robustness — callers that already parse porcelain can pass clean paths.
//   - workspaceRoot: absolute path the eval-server was started against.
//
// Output: Set<string> of "plugin/skill" IDs.
// ---------------------------------------------------------------------------

import type { SkillInfo } from "../types";

const PORCELAIN_PREFIX_RE = /^[ MADRCU?!]{1,2} +/;

function stripPorcelainPrefix(p: string): string {
  return p.replace(PORCELAIN_PREFIX_RE, "");
}

function relPathFrom(root: string, abs: string): string | null {
  // Defensive: skill dirs OUTSIDE the workspace root are ignored. We compare
  // by string prefix because adding a Node `path` import would pull a CJS
  // dep into the UI bundle for no benefit — paths from the server are already
  // POSIX-normalised on this surface.
  const rootWithSlash = root.endsWith("/") ? root : root + "/";
  if (abs === root) return "";
  if (!abs.startsWith(rootWithSlash)) return null;
  return abs.slice(rootWithSlash.length);
}

export function getDirtySkillIds(
  skills: readonly SkillInfo[],
  dirtyPaths: readonly string[],
  workspaceRoot: string,
): Set<string> {
  const result = new Set<string>();
  if (dirtyPaths.length === 0 || skills.length === 0) return result;

  // Pre-clean dirty paths once: strip porcelain prefix, drop empties.
  const cleanDirty = dirtyPaths
    .map((p) => stripPorcelainPrefix(p).trim())
    .filter((p) => p.length > 0);

  for (const skill of skills) {
    const skillDir = skill.dir;
    if (!skillDir) continue;
    const rel = relPathFrom(workspaceRoot, skillDir);
    if (rel === null) continue;
    const id = `${skill.plugin}/${skill.skill}`;

    // Skill dir IS the workspace root → any dirty path counts.
    if (rel === "") {
      if (cleanDirty.length > 0) result.add(id);
      continue;
    }

    const prefix = rel + "/";
    for (const p of cleanDirty) {
      if (p === rel || p.startsWith(prefix)) {
        result.add(id);
        break;
      }
    }
  }

  return result;
}
