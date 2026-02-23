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
