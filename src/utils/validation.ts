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

/**
 * Parse a GitHub source — accepts both `owner/repo` shorthand and full GitHub URLs.
 * Handles .git suffix, trailing slashes, and extra path segments (e.g. /tree/main/...).
 * Returns null for invalid or non-GitHub input.
 */
export function parseGitHubSource(
  source: string
): { owner: string; repo: string } | null {
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
    return { owner, repo };
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
