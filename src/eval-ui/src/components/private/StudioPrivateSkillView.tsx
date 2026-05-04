// 0826 T-049 — Private skill detail view inside `vskill studio`.
// Mirrors the web platform's private detail page: PrivateBanner at the
// top, tab-title would be set to "[Private] <slug>" by the host shell.

import type { CSSProperties } from "react";
import { PrivateBanner } from "./PrivateBanner";
import { PrivateBadge } from "./PrivateBadge";

export interface StudioPrivateSkill {
  slug: string;
  name: string;
  tenantName: string;
  description?: string;
  version?: string;
  readme?: string;
}

export interface StudioPrivateSkillViewProps {
  skill: StudioPrivateSkill;
}

export function StudioPrivateSkillView({ skill }: StudioPrivateSkillViewProps) {
  const wrap: CSSProperties = { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg, #ffffff)" };
  const main: CSSProperties = { padding: "24px 32px", flex: 1, overflow: "auto", fontFamily: "system-ui, -apple-system, sans-serif" };
  const header: CSSProperties = { display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" };
  const h1: CSSProperties = { fontSize: "1.5rem", fontWeight: 700, margin: 0 };
  const meta: CSSProperties = { fontSize: "0.8125rem", color: "#525252", marginBottom: "16px" };
  const readmeBox: CSSProperties = {
    padding: "16px 20px",
    border: "1px solid #FCD34D",
    borderRadius: "8px",
    background: "#FFFBEB",
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    fontSize: "0.8125rem",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    color: "#451A03",
  };

  return (
    <div style={wrap} data-studio-private-skill={skill.slug}>
      <PrivateBanner tenantName={skill.tenantName} />
      <main style={main}>
        <div style={header}>
          <h1 style={h1}>{skill.name}</h1>
          <PrivateBadge tenantName={skill.tenantName} variant="large" />
        </div>
        <div style={meta}>
          {skill.version && <>v{skill.version} · </>}
          private to {skill.tenantName}
        </div>
        {skill.description && <p style={{ fontSize: "0.9375rem", marginBottom: "16px" }}>{skill.description}</p>}
        {skill.readme && <pre style={readmeBox}>{skill.readme}</pre>}
      </main>
    </div>
  );
}

export default StudioPrivateSkillView;
