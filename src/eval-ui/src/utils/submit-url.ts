// ---------------------------------------------------------------------------
// 0729 — buildSubmitUrl
//
// Pure helper for constructing the verified-skill.com submission URL used by
// the Versions tab CTA shown to authors of local-only skills.
//
// Defensive against credential-bearing or non-GitHub URLs: anything that
// doesn't match the public-https-github shape collapses to the bare
// /submit URL so we never leak a token in a query string.
// ---------------------------------------------------------------------------

const SUBMIT_BASE = "https://verified-skill.com/submit";

// Strict: https + github.com host + owner/repo path. Disallows credentials,
// other protocols, and other hosts. Trailing path segments (e.g. /tree/main)
// are allowed.
const PUBLIC_GITHUB_HTTPS = /^https:\/\/github\.com\/[^/?#@:]+\/[^/?#@:]+(?:[/?#].*)?$/;

export function buildSubmitUrl(repoUrl?: string | null): string {
  if (!repoUrl) return SUBMIT_BASE;
  const trimmed = repoUrl.trim();
  if (!trimmed || !PUBLIC_GITHUB_HTTPS.test(trimmed)) return SUBMIT_BASE;
  return `${SUBMIT_BASE}?repo=${encodeURIComponent(trimmed)}`;
}
