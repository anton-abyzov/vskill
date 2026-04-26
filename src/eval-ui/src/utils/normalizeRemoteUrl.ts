// ---------------------------------------------------------------------------
// 0759 — normalizeRemoteUrl + buildSubmitUrl helpers.
//
// Pure functions, no side effects. Translate `git remote get-url origin`
// output into a canonical HTTPS URL suitable for verified-skill.com/submit.
// ---------------------------------------------------------------------------

const SSH_RE = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/;
const HTTPS_RE = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/;

/**
 * Normalize a github remote URL to canonical HTTPS form (no `.git` suffix).
 * Throws on empty input or unrecognized format.
 */
export function normalizeRemoteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("normalizeRemoteUrl: empty input");
  let m = trimmed.match(SSH_RE);
  if (m) return `https://github.com/${m[1]}/${m[2]}`;
  m = trimmed.match(HTTPS_RE);
  if (m) return `https://github.com/${m[1]}/${m[2]}`;
  throw new Error(`normalizeRemoteUrl: unrecognized remote URL: ${raw}`);
}

/**
 * Build the verified-skill.com submit URL from a raw git remote URL (SSH or
 * HTTPS). Unlike `buildSubmitUrl` in `submit-url.ts` (which expects a
 * canonical HTTPS URL from the Versions tab), this function accepts raw
 * `git remote get-url origin` output and normalises it internally.
 *
 * Named distinctly from the 0729 `buildSubmitUrl` to avoid import confusion:
 * this one handles the publish-button flow (raw remote → submit URL).
 */
export function buildSubmitUrlFromRemote(rawRemoteUrl: string): string {
  const canonical = normalizeRemoteUrl(rawRemoteUrl);
  return `https://verified-skill.com/submit?repo=${encodeURIComponent(canonical)}`;
}
