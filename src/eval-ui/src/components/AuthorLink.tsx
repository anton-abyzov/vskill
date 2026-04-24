import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// T-003 (0707): AuthorLink — clickable GitHub profile link OR copy-to-clipboard
// chip, depending on whether a GitHub-parseable repo URL is available.
//
// The source of truth is the skill's `repoUrl` (when exposed by the eval-
// server). For now the caller typically passes `skill.homepage` — the URL
// parser accepts both github.com and raw.githubusercontent.com shapes and
// falls back to the copy-chip rendering for any unparseable value.
// ---------------------------------------------------------------------------

export interface AuthorLinkProps {
  /** Human-readable author string (displayed as link label / copied value). */
  author: string | null | undefined;
  /** Optional repo URL used to derive the GitHub profile. */
  repoUrl?: string | null;
  /** Optional test id. */
  "data-testid"?: string;
}

/** Best-effort parser: returns the GitHub owner from a github.com URL, or null. */
export function parseGitHubOwner(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Accept bare "owner/repo" shorthand as well.
  if (!trimmed.includes("://")) {
    const [owner] = trimmed.split("/");
    return owner && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) ? owner : null;
  }
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com" && host !== "raw.githubusercontent.com") {
      return null;
    }
    const parts = u.pathname.split("/").filter(Boolean);
    const owner = parts[0];
    if (!owner || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)) return null;
    return owner;
  } catch {
    return null;
  }
}

export function AuthorLink(props: AuthorLinkProps) {
  const { author, repoUrl } = props;
  const owner = parseGitHubOwner(repoUrl ?? null);
  const label = author && author.trim() !== "" ? author : owner ?? "—";
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(label);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // swallow — browser may refuse clipboard in non-secure contexts.
    }
  }, [label]);

  if (owner) {
    return (
      <a
        data-testid={props["data-testid"] ?? "author-link"}
        href={`https://github.com/${owner}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          color: "var(--text-accent, var(--text-primary))",
          textDecoration: "none",
          borderBottom: "1px dotted var(--border-default, var(--border))",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </a>
    );
  }

  if (!author || author.trim() === "") {
    return (
      <span
        data-testid={props["data-testid"] ?? "author-link-empty"}
        style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-secondary)" }}
      >
        —
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid={props["data-testid"] ?? "author-copy"}
      title={`Copy "${label}"`}
      onClick={onCopy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        border: "1px solid var(--border-default, var(--border))",
        borderRadius: 4,
        background: "transparent",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        color: "var(--text-secondary)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>
        {copied ? "✓" : "⧉"}
      </span>
    </button>
  );
}

export default AuthorLink;
