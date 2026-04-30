// ---------------------------------------------------------------------------
// 0809 — RepoLink: clickable `owner/repo` chip in the DetailHeader byline.
//
// Slots between AuthorLink (links to `github.com/{owner}` profile) and
// SourceFileLink (links to `github.com/{owner}/{repo}/blob/HEAD/{skillPath}`)
// to reach parity with verified-skill.com's skill page header layout.
//
// Returns null when `repoUrl` is null/empty or unparseable as a github.com
// URL — non-github skills keep the existing 2-chip byline (no orphaned
// chip, no broken anchor). Reuses `canonicalRepoUrl` from SourceFileLink
// so URL handling stays in one place.
// ---------------------------------------------------------------------------

import { canonicalRepoUrl } from "./SourceFileLink";

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]+$/;

export function parseOwnerRepo(repoUrl: string | null | undefined): { owner: string; repo: string } | null {
  if (!repoUrl || typeof repoUrl !== "string") return null;
  const trimmed = repoUrl.trim();
  if (!trimmed) return null;

  let canonical: string;
  try {
    canonical = canonicalRepoUrl(trimmed);
  } catch {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(canonical);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return null;

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  if (!OWNER_RE.test(owner)) return null;
  if (!repo || !REPO_RE.test(repo)) return null;

  return { owner, repo };
}

export interface RepoLinkProps {
  /** Optional repo URL — any /tree/, /blob/, .git, or www. variant accepted. */
  repoUrl?: string | null;
  /** Optional data-testid override (default: "repo-link"). */
  "data-testid"?: string;
}

export function RepoLink(props: RepoLinkProps) {
  const parsed = parseOwnerRepo(props.repoUrl ?? null);
  if (!parsed) return null;
  const href = `https://github.com/${parsed.owner}/${parsed.repo}`;
  return (
    <a
      data-testid={props["data-testid"] ?? "repo-link"}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        color: "var(--text-accent, var(--text-primary))",
        textDecoration: "none",
        borderBottom: "1px dotted var(--border-default, var(--border))",
        whiteSpace: "nowrap",
      }}
    >
      {parsed.owner}/{parsed.repo}
    </a>
  );
}

export default RepoLink;
