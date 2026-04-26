// ---------------------------------------------------------------------------
// installed-version.ts -- decide which upstream version is "installed"
//
// 0764: The /api/skills/:plugin/:skill/versions endpoint used to derive
// `isInstalled` exclusively from the vskill lockfile. For Anthropic-style
// installed skills (copied into `.claude/skills/<name>/`), no lockfile entry
// exists, so every row was returned with `isInstalled: undefined` — the
// timeline never marked an installed row and the Update button never
// appeared. This module adds two fallback signals (frontmatter version,
// content-hash match) and exposes a pure picker so the precedence logic is
// testable in isolation.
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface UpstreamVersion {
  version: string;
  contentHash?: string | null;
}

export interface PickInstalledInputs {
  /** Upstream version rows (any order). */
  versions: UpstreamVersion[];
  /** Lockfile-recorded version, if any. Highest precedence. */
  lockfileVersion?: string | null;
  /** `version:` from on-disk SKILL.md frontmatter. Second precedence. */
  frontmatterVersion?: string | null;
  /** sha256 (hex) of on-disk SKILL.md content. Lowest precedence. */
  onDiskContentHash?: string | null;
}

/**
 * Decide which upstream version is "installed", given a precedence chain:
 * lockfile > frontmatter > content-hash match.
 *
 * - Lockfile wins unconditionally (even when its version doesn't appear in
 *   the upstream list — the caller still surfaces the recorded version).
 * - Frontmatter only wins when it matches an upstream row (a frontmatter
 *   version that doesn't appear upstream is treated as "unknown" — we
 *   intentionally avoid claiming the user is on a published version they
 *   actually aren't).
 * - Content-hash matches any upstream row whose `contentHash` equals the
 *   on-disk hash (case-insensitive). Sentinel hashes of the form
 *   `sha256:pending:...` are ignored.
 *
 * Returns the matching version string, or `null` when no signal is
 * available.
 */
export function pickInstalledVersion(input: PickInstalledInputs): string | null {
  const { versions, lockfileVersion, frontmatterVersion, onDiskContentHash } = input;

  if (lockfileVersion) return lockfileVersion;

  if (frontmatterVersion) {
    const match = versions.find((v) => v.version === frontmatterVersion);
    if (match) return frontmatterVersion;
  }

  if (onDiskContentHash) {
    const lower = onDiskContentHash.toLowerCase();
    const match = versions.find((v) => {
      const h = v.contentHash;
      if (!h) return false;
      if (h.startsWith("sha256:pending:")) return false;
      return h.toLowerCase() === lower;
    });
    if (match) return match.version;
  }

  return null;
}

/** Read SKILL.md content if it exists; return null otherwise. */
export function readSkillMd(skillDir: string): string | null {
  const p = join(skillDir, "SKILL.md");
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** sha256(hex) of a UTF-8 string. */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
