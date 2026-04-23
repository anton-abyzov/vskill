/**
 * Classify a version bump as "major" | "minor" | "patch" by comparing
 * the installed and latest semver strings. Unparseable inputs fall back
 * to "patch" (least-scary default) and emit a single `console.warn`.
 *
 * Shared between `UpdatesPanel` (bulk view) and `UpdateDropdown`
 * (studio top-rail summary) so both surfaces render the same dot color
 * for the same skill.
 */
export function classifyBump(
  installed: string,
  latest: string,
): "major" | "minor" | "patch" {
  const [iMajRaw, iMinRaw] = installed.split(".");
  const [lMajRaw, lMinRaw] = latest.split(".");
  const iMaj = Number(iMajRaw);
  const iMin = Number(iMinRaw);
  const lMaj = Number(lMajRaw);
  const lMin = Number(lMinRaw);
  if (!Number.isFinite(iMaj) || !Number.isFinite(lMaj)) {
    // eslint-disable-next-line no-console
    console.warn(`[semverBump] unparseable version: installed=${installed} latest=${latest}`);
    return "patch";
  }
  if (lMaj > iMaj) return "major";
  if (!Number.isFinite(iMin) || !Number.isFinite(lMin)) {
    // eslint-disable-next-line no-console
    console.warn(`[semverBump] unparseable minor: installed=${installed} latest=${latest}`);
    return "patch";
  }
  if (lMin > iMin) return "minor";
  return "patch";
}

/**
 * Theme-variable bg/text pair for the matching bump color. Consumers can
 * ignore this and read the raw result of `classifyBump` too.
 */
export const BUMP_COLORS: Record<
  "major" | "minor" | "patch",
  { bg: string; text: string }
> = {
  major: { bg: "var(--red-muted)", text: "var(--red)" },
  minor: { bg: "var(--yellow-muted)", text: "var(--yellow)" },
  patch: { bg: "var(--green-muted)", text: "var(--green)" },
};
