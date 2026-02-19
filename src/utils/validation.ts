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
 * Validate a skill name.
 * Rejects path traversal (../, ..\) and null bytes.
 */
export function validateSkillName(name: string): boolean {
  if (!name) return false;
  if (name.includes("\0")) return false;
  if (name.includes("../") || name.includes("..\\")) return false;
  if (name === ".." || name === ".") return false;
  return true;
}
