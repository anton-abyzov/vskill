// ---------------------------------------------------------------------------
// URL resolver for skills.sh marketplace URLs.
// Parses https://skills.sh/{owner}/{toolkit}/{skill} into structured data.
// ---------------------------------------------------------------------------

export interface SkillsShParsed {
  owner: string;
  toolkit: string;
  skill: string;
}

export interface SkillsShIncomplete {
  incomplete: true;
}

/**
 * Parse a skills.sh marketplace URL.
 *
 * - Full URL (3 path segments): returns { owner, toolkit, skill }
 * - Incomplete URL (1-2 segments): returns { incomplete: true }
 * - Non-skills.sh URL or non-URL: returns null
 */
export function parseSkillsShUrl(
  input: string
): SkillsShParsed | SkillsShIncomplete | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname;
  if (host !== "skills.sh" && host !== "www.skills.sh") {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);

  if (segments.length >= 3) {
    return {
      owner: segments[0],
      toolkit: segments[1],
      skill: segments[2],
    };
  }

  // Incomplete path (1 or 2 segments, but it is a skills.sh URL)
  if (segments.length >= 1) {
    return { incomplete: true };
  }

  // Root URL with no path
  return null;
}

/**
 * Check if a parsed result is a complete skills.sh URL.
 */
export function isCompleteParsed(
  result: SkillsShParsed | SkillsShIncomplete | null
): result is SkillsShParsed {
  return result !== null && !("incomplete" in result);
}

/**
 * Check if a parsed result is an incomplete skills.sh URL.
 */
export function isIncompleteParsed(
  result: SkillsShParsed | SkillsShIncomplete | null
): result is SkillsShIncomplete {
  return result !== null && "incomplete" in result;
}
