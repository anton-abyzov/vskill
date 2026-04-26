// ---------------------------------------------------------------------------
// 0779 — Save default patch bump.
//
// Pure helper used by EditorPanel.handleSave. Decides whether the editor's
// current content should be persisted as-is or with the patch version
// auto-incremented.
//
// Rule (matches user expectation: "Save bumps patch by default"):
//   - If both `content` and `savedContent` declare a parseable frontmatter
//     version AND those versions are identical → bump patch in `content` and
//     return the bumped content. The user did not click +patch/+minor/+major
//     before Save, so we apply the default patch bump for them.
//   - Otherwise → return `content` unchanged. Either the user already bumped
//     manually (editor version > saved version), or the version field is
//     unparseable on either side (in which case the existing
//     validateVersionTransition guard at the call site handles the error).
//
// Pure function: no React state, no DOM. Trivially unit-testable.
// ---------------------------------------------------------------------------

import { bumpVersion } from "./bumpVersion";
import {
  getFrontmatterVersion,
  setFrontmatterVersion,
} from "./setFrontmatterVersion";

export interface SavePayload {
  /** Content to persist (may equal `content` or be a patch-bumped variant). */
  contentToSave: string;
  /** Frontmatter version inside `contentToSave`, or null if unparseable. */
  version: string | null;
  /** Frontmatter version of `savedContent` (the previous baseline), or null
   *  if unparseable. Exposed so callers don't re-parse for the
   *  validateVersionTransition check. */
  fromVersion: string | null;
}

export function computeSavePayload(
  content: string,
  savedContent: string,
): SavePayload {
  const fromVersion = getFrontmatterVersion(savedContent);
  const toVersion = getFrontmatterVersion(content);

  if (fromVersion !== null && toVersion !== null && fromVersion === toVersion) {
    try {
      const bumped = bumpVersion(fromVersion, "patch");
      return {
        contentToSave: setFrontmatterVersion(content, bumped),
        version: bumped,
        fromVersion,
      };
    } catch {
      // bumpVersion only throws when the input isn't a valid semver — we
      // already gated on getFrontmatterVersion returning a non-null string,
      // but if it wasn't semver-shaped, fall through to "save as-is".
      return { contentToSave: content, version: toVersion, fromVersion };
    }
  }

  return { contentToSave: content, version: toVersion, fromVersion };
}
