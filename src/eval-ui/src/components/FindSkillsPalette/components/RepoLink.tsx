// 0741 T-007: Ported from vskill-platform/src/app/components/RepoLink.tsx.
// `next/link` removed — eval-ui already uses native <a> for external links.
// All GitHub links open in a new tab with rel="noopener noreferrer".

import { parseRepoUrl } from "../../../lib/repo-utils";

interface RepoLinkProps {
  repoUrl: string | null | undefined;
  skillName?: string | null;
  mono?: string;
  fontSize?: string;
  showPlaceholder?: boolean;
}

function skillSlugForUrl(skillName: string | null | undefined): string | null {
  if (!skillName) return null;
  const parts = skillName.trim().split("/").map((p) => p.trim()).filter(Boolean);
  return parts.at(-1) ?? null;
}

function verifiedSkillUrl(owner: string, repo: string, skillName: string | null | undefined): string | null {
  const skillSlug = skillSlugForUrl(skillName);
  if (!skillSlug) return null;
  return `https://verified-skill.com/skills/${[owner, repo, skillSlug].map(encodeURIComponent).join("/")}`;
}

export function RepoLink({
  repoUrl,
  skillName,
  mono = "var(--font-geist-mono)",
  fontSize = "0.75rem",
  showPlaceholder = true,
}: RepoLinkProps) {
  if (!repoUrl) {
    return showPlaceholder
      ? <span style={{ color: "var(--text-faint)", fontSize }}>--</span>
      : null;
  }

  const parsed = parseRepoUrl(repoUrl);

  if (!parsed) {
    return (
      <span style={{ color: "var(--text-faint)", fontSize, fontFamily: mono }}>
        {repoUrl}
      </span>
    );
  }

  return (
    <a
      data-testid="repo-link"
      href={verifiedSkillUrl(parsed.owner, parsed.name, skillName) ?? parsed.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{ color: "#0D9488", textDecoration: "none", fontSize, fontFamily: mono }}
    >
      {parsed.owner}/{parsed.name}
    </a>
  );
}

export default RepoLink;
