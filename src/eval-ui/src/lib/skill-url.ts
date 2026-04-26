// ---------------------------------------------------------------------------
// Centralized URL builder for skill pages and API paths.
// Ported from vskill-platform/src/lib/skill-url.ts (0741 T-005).
// All FindSkillsPalette components in eval-ui use these helpers instead of
// inline URL construction. No Next.js dependencies — safe for the Vite bundle.
// ---------------------------------------------------------------------------

/**
 * Build a frontend URL path for a skill page.
 * Handles both hierarchical ("owner/repo/slug") and legacy flat names.
 *
 * Examples:
 *   "anton-abyzov/vskill/architect" → "/skills/anton-abyzov/vskill/architect"
 *   "architect"                      → "/skills/architect" (legacy fallback)
 */
export function skillUrl(name: string): string {
  const parts = name.split("/");
  if (parts.length === 3) {
    return `/skills/${parts.map(encodeURIComponent).join("/")}`;
  }
  return `/skills/${encodeURIComponent(name)}`;
}

/**
 * Build an API path for a skill endpoint.
 *
 * Examples:
 *   skillApiPath("owner/repo/slug")           → "/api/v1/skills/owner/repo/slug"
 *   skillApiPath("owner/repo/slug", "badge")  → "/api/v1/skills/owner/repo/slug/badge"
 *   skillApiPath("owner/repo/slug", "versions") → "/api/v1/skills/owner/repo/slug/versions"
 */
export function skillApiPath(name: string, ...suffixes: string[]): string {
  const parts = name.split("/");
  const base = parts.length === 3
    ? `/api/v1/skills/${parts.map(encodeURIComponent).join("/")}`
    : `/api/v1/skills/${encodeURIComponent(name)}`;
  if (suffixes.length === 0) return base;
  return `${base}/${suffixes.map(encodeURIComponent).join("/")}`;
}

/**
 * Build a full skill page URL for external sharing (e.g. "see all on
 * verified-skill.com" link in the SkillDetailPanel install footer).
 */
export function skillFullUrl(name: string, baseUrl = "https://verified-skill.com"): string {
  return `${baseUrl}${skillUrl(name)}`;
}
