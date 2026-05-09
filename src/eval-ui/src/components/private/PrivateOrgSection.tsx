// 0826 — Studio CLI Private Org section.
// Renders the amber-tinted block that mirrors the web platform's
// /orgs/<slug> sidebar — same visual contract, same reading instinct.

import type { CSSProperties } from "react";
import { PrivateBadge } from "./PrivateBadge";
import { ConnectGitHubCard } from "./ConnectGitHubCard";

export interface PrivateOrgSkill {
  slug: string;
  name: string;
}

export interface PrivateOrg {
  slug: string;
  name: string;
  skills: PrivateOrgSkill[];
}

export interface PrivateOrgSectionProps {
  /** null = no auth (credential store empty); empty array = auth ok but no installations. */
  orgs: PrivateOrg[] | null;
  activeSkillSlug?: string | null;
  onSelectSkill?: (orgSlug: string, skillSlug: string) => void;
  onConnectAuth?: () => void;
}

export function PrivateOrgSection({ orgs, activeSkillSlug, onSelectSkill, onConnectAuth }: PrivateOrgSectionProps) {
  const heading: CSSProperties = {
    fontSize: "0.6875rem",
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#78350F",
    padding: "16px 20px 8px",
    margin: 0,
  };

  if (orgs === null) {
    return (
      <section data-private-section="true" data-state="no-auth" aria-label="Private orgs — sign in required">
        <h3 style={heading}>Private — Your Orgs</h3>
        <ConnectGitHubCard state="no-auth" onConnect={onConnectAuth} />
      </section>
    );
  }

  if (orgs.length === 0) {
    return (
      <section data-private-section="true" data-state="no-installations" aria-label="Private orgs — none installed">
        <h3 style={heading}>Private — Your Orgs</h3>
        <ConnectGitHubCard state="no-installations" />
      </section>
    );
  }

  const orgWrap: CSSProperties = {
    backgroundColor: "rgba(252, 211, 77, 0.18)",
    borderTop: "1px solid #FCD34D",
    borderBottom: "1px solid #FCD34D",
    margin: "8px 0",
    padding: "10px 0 12px",
  };
  const orgHeader: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "0 20px 8px",
  };
  const orgTitle: CSSProperties = { fontSize: "0.8125rem", fontWeight: 700, color: "#78350F", letterSpacing: "0.01em", margin: 0 };
  const item: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 20px",
    fontSize: "0.8125rem",
    color: "#451A03",
    background: "transparent",
    border: 0,
    width: "100%",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const itemActive: CSSProperties = { ...item, backgroundColor: "rgba(252, 211, 77, 0.30)", fontWeight: 600 };

  return (
    <section data-private-section="true" data-state="loaded" aria-label="Private orgs">
      <h3 style={heading}>Private — Your Orgs</h3>
      {orgs.map((org) => (
        <div key={org.slug} data-org-section={org.slug} style={orgWrap}>
          <header style={orgHeader}>
            <h4 style={orgTitle}>Org · {org.name}</h4>
            <PrivateBadge tenantName={org.name} variant="small" />
          </header>
          {org.skills.length === 0 ? (
            <div style={{ padding: "0 20px", fontSize: "0.75rem", color: "#92400E" }}>No private skills yet.</div>
          ) : (
            org.skills.map((skill) => (
              <button
                key={skill.slug}
                type="button"
                onClick={() => onSelectSkill?.(org.slug, skill.slug)}
                style={skill.slug === activeSkillSlug ? itemActive : item}
                data-skill-slug={skill.slug}
              >
                <PrivateBadge tenantName={org.name} variant="small" />
                <span style={{ flex: 1 }}>{skill.name}</span>
              </button>
            ))
          )}
        </div>
      ))}
      <ConnectGitHubCard state="add-another" />
    </section>
  );
}

export default PrivateOrgSection;
