// 0826 — Studio CLI Connect-GitHub CTA card.
// Shown in the org sidebar section when no auth or no installations exist.

import type { CSSProperties } from "react";

export interface ConnectGitHubCardProps {
  /** Mode shifts the message + CTA wording. */
  state: "no-auth" | "no-installations" | "add-another";
  /** Called when the user clicks the CTA. In studio runtime this typically
      triggers `vskill auth login` via the eval-server endpoint. */
  onConnect?: () => void;
}

export function ConnectGitHubCard({ state, onConnect }: ConnectGitHubCardProps) {
  const card: CSSProperties = {
    margin: "10px 14px",
    padding: state === "add-another" ? "10px 14px" : "14px 16px",
    border: "1.5px dashed #F59E0B",
    borderRadius: "8px",
    backgroundColor: "#FEF3C7",
    color: "#78350F",
    fontFamily: "system-ui, -apple-system, sans-serif",
  };
  const title: CSSProperties = { fontSize: "0.8125rem", fontWeight: 700, marginBottom: state === "add-another" ? 0 : "4px" };
  const body: CSSProperties = { fontSize: "0.75rem", color: "#92400E", marginBottom: "10px", lineHeight: 1.4 };
  const cta: CSSProperties = {
    display: "inline-block",
    padding: "6px 12px",
    fontSize: "0.75rem",
    fontWeight: 600,
    backgroundColor: "#B45309",
    color: "#FFFFFF",
    borderRadius: "5px",
    border: 0,
    cursor: "pointer",
  };

  const config = {
    "no-auth": {
      title: "Connect your GitHub org",
      body: "Sign in once with `vskill auth login` to see private skills your org has installed.",
      cta: "Run vskill auth login →",
    },
    "no-installations": {
      title: "No orgs have installed Skill Studio",
      body: "Ask an org admin to install at /settings/integrations on verified-skill.com.",
      cta: "Open install docs",
    },
    "add-another": {
      title: "+ Connect another org",
      body: "",
      cta: "+ Connect another org",
    },
  } as const;

  const c = config[state];

  return (
    <div data-cta="connect-github" data-state={state} style={card}>
      <div style={title}>{c.title}</div>
      {state !== "add-another" && <div style={body}>{c.body}</div>}
      {state !== "add-another" && (
        <button type="button" onClick={onConnect} style={cta}>
          {c.cta}
        </button>
      )}
    </div>
  );
}

export default ConnectGitHubCard;
