// ---------------------------------------------------------------------------
// 0772 US-006 — SidebarGitHubIndicator.
//
// Sparse "GitHub not connected" cue rendered in the AVAILABLE > Project
// section header. Renders nothing when the project is already connected
// (absence = healthy). Click → focuses the Overview tab's Publish row by
// dispatching a `studio:focus-publish-row` CustomEvent that App.tsx listens
// for; falls back to opening the inline create flow when no skill is
// selected. Dismissal is shared with PublishStatusRow via the
// `vskill-github-hint-dismissed-<projectRoot>` localStorage key.
// ---------------------------------------------------------------------------

import { useGitHubStatus } from "../hooks/useGitHubStatus";

interface Props {
  /** Project root used to namespace the dismiss key in localStorage. */
  projectRoot: string;
}

function isDismissed(projectRoot: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(`vskill-github-hint-dismissed-${projectRoot}`) === "true"
    );
  } catch {
    return false;
  }
}

export function SidebarGitHubIndicator({ projectRoot }: Props): React.ReactElement | null {
  const { status, loading } = useGitHubStatus();
  if (loading || !status) return null;
  if (status.status === "github") return null;
  if (isDismissed(projectRoot)) return null;

  const tooltip =
    status.status === "no-git"
      ? "GitHub not connected — run `gh repo create ...` to publish your skills"
      : "Origin is not GitHub — add a github.com remote to publish";

  const onClick = (): void => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("studio:focus-publish-row"));
  };

  return (
    <button
      type="button"
      data-testid="sidebar-github-not-connected"
      aria-label="GitHub not connected — click for help"
      title={tooltip}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        padding: 0,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: "var(--color-own, #f59e0b)",
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {/* cloud-off (Lucide) */}
        <path d="m2 2 20 20" />
        <path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193" />
        <path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07" />
      </svg>
    </button>
  );
}
