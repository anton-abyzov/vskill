// 0741 T-007: Ported from
// vskill-platform/src/app/skills/[owner]/[repo]/[skill]/RepoHealthBadge.tsx.
// `"use client"` directive dropped (Vite has no SSR).

import { useEffect, useState } from "react";
import { skillApiPath } from "../../../lib/skill-url";

const MONO = "var(--font-geist-mono)";

const STATUS_COLORS: Record<string, string> = {
  ONLINE: "var(--status-success-text)",
  OFFLINE: "var(--status-danger-text)",
  STALE: "var(--status-neutral-text)",
};

const STATUS_BGS: Record<string, string> = {
  ONLINE: "var(--status-success-bg)",
  OFFLINE: "var(--status-danger-bg)",
  STALE: "var(--status-neutral-bg)",
};

interface RepoHealthBadgeProps {
  skillName: string;
  repoUrl: string | undefined;
}

export default function RepoHealthBadge({ skillName, repoUrl }: RepoHealthBadgeProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!repoUrl) return;
    setLoading(true);
    fetch(skillApiPath(skillName, "repo-health"))
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      })
      .then((data) => {
        setStatus(data.status);
        setLoading(false);
      })
      .catch(() => {
        setStatus(null);
        setLoading(false);
      });
  }, [skillName, repoUrl]);

  if (!repoUrl) return null;

  if (loading) {
    return (
      <span
        data-testid="repo-health-loading"
        style={{
          display: "inline-block",
          width: 56,
          height: 20,
          borderRadius: "4px",
          backgroundColor: "color-mix(in srgb, var(--text-faint) 20%, transparent)",
          animation: "pulse 1.5s ease-in-out infinite",
        }}
      />
    );
  }

  if (!status || status === "UNKNOWN") return null;

  const color = STATUS_COLORS[status] ?? "var(--status-neutral-text)";
  const bg = STATUS_BGS[status] ?? "var(--status-neutral-bg)";

  return (
    <span
      data-testid="repo-health-badge"
      style={{
        fontFamily: MONO,
        fontSize: "0.75rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        padding: "0.2rem 0.6rem",
        borderRadius: "999px",
        backgroundColor: bg,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}
