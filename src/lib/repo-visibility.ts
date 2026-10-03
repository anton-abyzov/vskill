// ---------------------------------------------------------------------------
// repo-visibility.ts — remembers which GitHub repos this process has seen as
// private, so nothing about them (names, URLs, skill paths) is sent to
// verified-skill.com: no install telemetry, no auto-submission for scanning.
// Populated from the `GET /repos/{owner}/{repo}` call install already makes
// (getDefaultBranch), so it costs no extra requests.
// ---------------------------------------------------------------------------

const privateRepos = new Set<string>();

function keyOf(ref: string): string | null {
  const m = ref
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .match(/^([^/\s]+)\/([^/\s?#]+)/);
  if (!m) return null;
  return `${m[1]}/${m[2].replace(/\.git$/i, "")}`.toLowerCase();
}

/** Record what GitHub reported for a repo's visibility. */
export function recordRepoVisibility(
  owner: string,
  repo: string,
  data: { private?: unknown; visibility?: unknown },
): void {
  const key = keyOf(`${owner}/${repo}`);
  if (!key) return;
  const isPrivate =
    data.private === true || data.visibility === "private" || data.visibility === "internal";
  if (isPrivate) privateRepos.add(key);
  else privateRepos.delete(key);
}

/** True when `ref` ("owner/repo" or a github.com URL) was seen as private. */
export function isKnownPrivateRepo(ref: string | undefined | null): boolean {
  if (!ref) return false;
  const key = keyOf(ref);
  return key ? privateRepos.has(key) : false;
}

/** @internal test-only */
export function _resetRepoVisibilityForTests(): void {
  privateRepos.clear();
}
