// 0826 — Studio CLI Connect-GitHub CTA card.
// Shown in the org sidebar section when no auth or no installations exist.
//
// 0839 T-013 — When the signed-in user belongs to one or more tenants the
// card promotes itself into a `<TenantPicker />` so the user can switch
// active tenant without leaving the sidebar. The N=0 (no installations)
// path falls through to the existing "no-installations" CTA, preserving
// the 0834 onboarding flow verbatim.

import type { CSSProperties } from "react";
import { TenantPicker } from "./TenantPicker";

export interface ConnectGitHubCardProps {
  /**
   * Mode shifts the message + CTA wording.
   *
   * - `no-auth`           — pre-login banner ("Run vskill auth login")
   * - `no-installations`  — logged-in but the App is on no orgs
   * - `add-another`       — bottom-of-section "+ Connect another org" link
   * - `tenant-picker`     — 0839: signed-in + ≥1 tenant → render the
   *                         tenant switcher inline. Falls back to the
   *                         `no-installations` CTA when N=0 so the user
   *                         is nudged toward the install flow.
   */
  state: "no-auth" | "no-installations" | "add-another" | "tenant-picker";
  /** Called when the user clicks the CTA. In studio runtime this typically
      triggers `vskill auth login` via the eval-server endpoint. */
  onConnect?: () => void;
  /**
   * 0839 T-013 — Fired after the TenantPicker successfully POSTs a new
   * active tenant to `/__internal/active-tenant`. The host wires this
   * to invalidate caches that depend on `X-Vskill-Tenant` so subsequent
   * fetches go through with the new header value.
   */
  onTenantChange?: (slug: string) => void;
}

export function ConnectGitHubCard({ state, onConnect, onTenantChange }: ConnectGitHubCardProps) {
  // 0839 T-013 — tenant-picker mode renders the switcher with the
  // existing "no-installations" CTA as its empty-state fallback, so the
  // N=0 path still nudges users toward installing the App on an org.
  if (state === "tenant-picker") {
    return (
      <div data-cta="connect-github" data-state="tenant-picker">
        <TenantPicker onTenantChange={onTenantChange}>
          <ConnectGitHubCard state="no-installations" onConnect={onConnect} />
        </TenantPicker>
      </div>
    );
  }

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
