import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// T-004 (0707): SourceFileLink — anchor to the skill source on GitHub
// (when a repo URL is known) OR copy-to-clipboard chip for the local
// absolute path.
//
// The anchor format is `{repoUrl-without-tree-or-blob}/blob/HEAD/{skillPath}`
// and always includes a trailing ↗ Unicode affordance so the anchor is
// visually distinct from in-app navigation.
// ---------------------------------------------------------------------------

export interface SourceFileLinkProps {
  /** Optional repo URL ("https://github.com/.../vskill" or any /tree/… /blob/… variant). */
  repoUrl?: string | null;
  /** Relative path inside the repo (e.g. "plugins/easychamp/skills/tournament-manager"). */
  skillPath?: string | null;
  /** Absolute local path (used by the copy chip when repoUrl is absent). */
  absolutePath?: string | null;
  /** Optional data-testid. */
  "data-testid"?: string;
}

/** Strip trailing `/tree/<branch>` or `/blob/<branch>[/path]` from a repo URL. */
export function canonicalRepoUrl(url: string): string {
  // Drop query + hash + trailing slash, then drop /tree/<ref> or /blob/<ref>[/path].
  let cleaned = url.split("#")[0].split("?")[0].replace(/\/+$/, "");
  cleaned = cleaned.replace(/\/(?:tree|blob)\/[^/]+(?:\/.*)?$/, "");
  return cleaned;
}

export function buildBlobUrl(repoUrl: string, skillPath: string | null | undefined): string {
  const base = canonicalRepoUrl(repoUrl);
  const rel = (skillPath ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
  return rel ? `${base}/blob/HEAD/${rel}` : `${base}/blob/HEAD/`;
}

function lastSegment(p: string | null | undefined): string {
  if (!p) return "source";
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function SourceFileLink(props: SourceFileLinkProps) {
  const { repoUrl, skillPath, absolutePath } = props;
  const [copied, setCopied] = useState(false);

  const canLink =
    typeof repoUrl === "string" &&
    repoUrl.trim() !== "" &&
    /^https?:\/\//.test(repoUrl.trim());

  const label = skillPath ? lastSegment(skillPath) : absolutePath ? lastSegment(absolutePath) : "source";

  const onCopy = useCallback(async () => {
    const toCopy = absolutePath ?? skillPath ?? "";
    if (!toCopy) return;
    try {
      await navigator.clipboard?.writeText(toCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // swallow — surfaced elsewhere in the shell via a toast.
    }
  }, [absolutePath, skillPath]);

  if (canLink) {
    const href = buildBlobUrl(repoUrl as string, skillPath);
    return (
      <a
        data-testid={props["data-testid"] ?? "source-file-link"}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={href}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontFamily: "var(--font-mono, var(--font-geist-mono))",
          fontSize: 12,
          color: "var(--text-accent, var(--text-primary))",
          textDecoration: "none",
          whiteSpace: "nowrap",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <span>{label}</span>
        <span aria-hidden="true">↗</span>
      </a>
    );
  }

  if (!absolutePath && !skillPath) {
    return (
      <span
        data-testid={props["data-testid"] ?? "source-file-empty"}
        style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-secondary)" }}
      >
        —
      </span>
    );
  }

  const toCopy = absolutePath ?? skillPath ?? "";
  return (
    <button
      type="button"
      data-testid={props["data-testid"] ?? "source-file-copy"}
      title={`Copy ${toCopy}`}
      onClick={onCopy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        border: "1px solid var(--border-default, var(--border))",
        borderRadius: 4,
        background: "transparent",
        fontFamily: "var(--font-mono, var(--font-geist-mono))",
        fontSize: 12,
        color: "var(--text-secondary)",
        cursor: "pointer",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      <span>{label}</span>
      <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>{copied ? "✓" : "⧉"}</span>
    </button>
  );
}

export default SourceFileLink;
