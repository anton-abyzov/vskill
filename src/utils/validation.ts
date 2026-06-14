/**
 * Input validation utilities for CLI arguments.
 * Prevents path traversal and injection attacks.
 */

const REPO_SEGMENT_RE = /^[\w.-]+$/;

/**
 * Validate an owner or repo name segment.
 * Only allows word chars, dots, and hyphens.
 */
export function validateRepoSegment(segment: string): boolean {
  if (!segment) return false;
  if (segment.includes("\0")) return false;
  if (segment === "." || segment === "..") return false;
  return REPO_SEGMENT_RE.test(segment);
}

export interface ParsedGitHubSource {
  owner: string;
  repo: string;
  /** Branch/ref from a /tree/<ref>/... or /blob/<ref>/... deep link. */
  ref?: string;
  /** Repo-relative skill directory from a deep link ("" = repo root). */
  skillPath?: string;
}

/**
 * Extract a skill deep link from URL path segments after owner/repo.
 * Recognizes /tree/<ref>/<skill-dir> and /blob/<ref>/<...>/SKILL.md.
 * Returns null when the segments don't pin a single skill (bare repo,
 * /tree/<ref> with no path, blob of a non-SKILL.md file, or any segment
 * that fails validation).
 */
function parseSkillDeepLink(
  segments: string[]
): { ref: string; skillPath: string } | null {
  if (segments.length < 2) return null;
  const [kind, ref, ...path] = segments;
  if (!validateRepoSegment(ref)) return null;
  if (kind === "tree") {
    if (path.length === 0 || !path.every(validateRepoSegment)) return null;
    return { ref, skillPath: path.join("/") };
  }
  if (kind === "blob") {
    if (path[path.length - 1] !== "SKILL.md") return null;
    const dir = path.slice(0, -1);
    if (!dir.every(validateRepoSegment)) return null;
    return { ref, skillPath: dir.join("/") };
  }
  return null;
}

/**
 * Parse a GitHub source — accepts both `owner/repo` shorthand and full GitHub URLs.
 * Handles .git suffix and trailing slashes. URLs deep-linking a skill
 * (/tree/<ref>/<skill-dir> or /blob/<ref>/<...>/SKILL.md) also carry `ref`
 * and `skillPath` so callers install ONLY that skill, not the whole repo.
 * Returns null for invalid or non-GitHub input.
 */
export function parseGitHubSource(source: string): ParsedGitHubSource | null {
  if (!source) return null;

  // Full GitHub URL
  if (source.includes("://") || source.startsWith("github.com/")) {
    let url: URL;
    try {
      url = new URL(
        source.startsWith("github.com/") ? `https://${source}` : source
      );
    } catch {
      return null;
    }
    if (url.hostname !== "github.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    const owner = segments[0];
    const repo = segments[1].replace(/\.git$/, "");
    if (!validateRepoSegment(owner) || !validateRepoSegment(repo)) return null;
    const deepLink = parseSkillDeepLink(segments.slice(2));
    return deepLink ? { owner, repo, ...deepLink } : { owner, repo };
  }

  // owner/repo shorthand
  const parts = source.split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!validateRepoSegment(owner) || !validateRepoSegment(repo)) return null;
  return { owner, repo };
}

/**
 * Validate a skill name.
 * Rejects path traversal (../, ..\) and null bytes.
 */
export function validateSkillName(name: string): boolean {
  if (!name) return false;
  if (name.includes("\0")) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name === ".." || name === ".") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Identifier format classification
// ---------------------------------------------------------------------------

export type IdentifierFormat =
  | { type: "owner-repo"; owner: string; repo: string }
  | { type: "owner-repo-skill"; owner: string; repo: string; skill: string }
  | { type: "url" }
  | { type: "flat"; name: string };

/**
 * Classify a source identifier into its format type.
 * Used for UX messaging and guardrails — does NOT validate existence.
 *
 * - `owner/repo` → owner-repo
 * - `owner/repo/skill` → owner-repo-skill
 * - URLs (http://, github.com/) → url
 * - Everything else → flat (ambiguous, registry lookup)
 */
export function classifyIdentifier(source: string): IdentifierFormat {
  if (source.includes("://") || source.startsWith("github.com/")) {
    return { type: "url" };
  }

  const parts = source.split("/");

  if (parts.length === 2) {
    return { type: "owner-repo", owner: parts[0], repo: parts[1] };
  }

  if (parts.length === 3) {
    return { type: "owner-repo-skill", owner: parts[0], repo: parts[1], skill: parts[2] };
  }

  return { type: "flat", name: source };
}
