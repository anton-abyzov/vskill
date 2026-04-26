// ---------------------------------------------------------------------------
// 0772 US-005 — PublishStatusRow.
//
// A small status row mounted on the Skill Overview tab. Three states:
//   - github     → green "Publish-ready" badge + reused PublishButton
//   - non-github → amber "Origin is not GitHub" + `gh remote add origin ...`
//   - no-git     → amber "No GitHub repo yet" + `gh repo create ... --push`
//
// The Copy button (one per actionable state) writes the suggested command to
// the clipboard. No localStorage dismissal here — the sidebar icon owns
// dismissal (US-006), this row stays informational.
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import { useGitHubStatus } from "../hooks/useGitHubStatus";
import { PublishButton } from "./PublishButton";

interface Props {
  /** Optional override for the project basename used to compose the
   *  `gh repo create` suggestion. Defaults to the empty string when absent
   *  (so the user has to fill it in). */
  projectBasename?: string;
  /** Studio-configured LLM provider — forwarded to PublishButton. */
  provider?: string;
  /** Studio-configured LLM model — forwarded to PublishButton. */
  model?: string;
}

function buildNoGitCommand(name: string): string {
  const safe = name.trim() || "<repo-name>";
  return `gh repo create ${safe} --public --source=. --remote=origin --push`;
}

const NON_GITHUB_HINT =
  "Add a GitHub remote: `gh repo create --public --source=.` (replace existing origin if needed).";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable in test environments — non-fatal */
    }
  }, [value]);
  return (
    <button
      type="button"
      data-testid="publish-status-copy"
      aria-label="Copy GitHub setup command"
      onClick={onClick}
      style={{
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 4,
        border: "1px solid var(--border-default, var(--border-subtle))",
        background: "var(--surface-2)",
        color: "var(--text-primary)",
        cursor: "pointer",
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Badge({
  tone,
  label,
}: {
  tone: "ok" | "warn";
  label: string;
}) {
  const bg =
    tone === "ok"
      ? "color-mix(in srgb, var(--color-ok, #22c55e) 18%, transparent)"
      : "color-mix(in srgb, var(--color-own, #f59e0b) 18%, transparent)";
  const fg = tone === "ok" ? "var(--color-ok, #22c55e)" : "var(--color-own, #f59e0b)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        color: fg,
        background: bg,
      }}
    >
      {label}
    </span>
  );
}

export function PublishStatusRow(props: Props = {}): React.ReactElement | null {
  const { status, loading } = useGitHubStatus();

  // Don't render anything while the initial probe is in flight — the row
  // would otherwise flash the wrong state.
  if (loading || !status) return null;

  if (status.status === "github") {
    return (
      <div
        data-testid="publish-status-row"
        data-status="github"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "10px 12px",
          border: "1px solid var(--border-default, var(--border-subtle))",
          borderRadius: 8,
          background: "var(--bg-surface, var(--surface-1))",
        }}
      >
        <Badge tone="ok" label="Publish-ready" />
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          GitHub origin: {status.githubOrigin}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <PublishButton
            remoteUrl={status.githubOrigin ?? ""}
            provider={props.provider}
            model={props.model}
          />
        </div>
      </div>
    );
  }

  const command =
    status.status === "no-git"
      ? buildNoGitCommand(props.projectBasename ?? "")
      : NON_GITHUB_HINT;

  return (
    <div
      data-testid="publish-status-row"
      data-status={status.status}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        border: "1px solid var(--border-default, var(--border-subtle))",
        borderRadius: 8,
        background: "var(--bg-surface, var(--surface-1))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Badge
          tone="warn"
          label={status.status === "no-git" ? "No GitHub repo yet" : "Origin is not GitHub"}
        />
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Connect GitHub to publish your skills.
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <code
          data-testid="publish-status-command"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "6px 10px",
            borderRadius: 4,
            background: "var(--surface-2)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {command}
        </code>
        <CopyButton value={command} />
      </div>
    </div>
  );
}
