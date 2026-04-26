// ---------------------------------------------------------------------------
// 0774 T-003: SkillOverview right-rail — Setup (MCP/skill deps) +
// Credentials sections. Replaces the old separate Deps tab as the place
// where users see "what does this skill need to run?"
//
// The DepsPanel still exists for `?panel=deps` deep-link back-compat
// (preserved by 0769 CONSUMER_BACKCOMPAT_TABS), but Overview is now the
// canonical surface.
// ---------------------------------------------------------------------------

import { McpDependencies } from "./McpDependencies";
import { CredentialManager } from "../pages/workspace/CredentialManager";

interface Props {
  plugin: string;
  skill: string;
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h3
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        color: "var(--text-tertiary)",
        margin: "0 0 8px",
      }}
    >
      {children}
    </h3>
  );
}

export function SkillOverviewRightRail({ plugin, skill }: Props) {
  return (
    <aside
      data-testid="skill-overview-rightrail"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <section data-testid="overview-rightrail-setup">
        <SectionHeading>Setup</SectionHeading>
        <McpDependencies plugin={plugin} skill={skill} />
      </section>
      <section data-testid="overview-rightrail-credentials">
        <SectionHeading>Credentials</SectionHeading>
        <CredentialManager plugin={plugin} skill={skill} />
      </section>
    </aside>
  );
}
