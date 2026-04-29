import type { ReactNode } from "react";
import type { SelectedSkill } from "../StudioContext";
import { strings } from "../strings";
import { AgentModelPicker } from "./AgentModelPicker";
import { StudioLogo } from "./StudioLogo";
import { UpdateBell } from "./UpdateBell";

interface Props {
  projectName: string | null;
  selected: SelectedSkill | null;
  /** 0698 T-016: optional slot for the multi-project picker pill next to the logo.
   *  When provided, renders instead of the legacy projectName inline label. */
  projectPickerSlot?: ReactNode;
  /** 0698 polish: opens the Create Skill modal. When omitted, button is hidden. */
  onRequestCreateSkill?: () => void;
  /**
   * 0686 T-001 (US-001): called when the user activates the "Skill Studio"
   * logo. App.tsx uses this to clear any selected skill so the detail pane
   * returns to its empty state alongside the hash navigation to "#/".
   */
  onHome?: () => void;
  /**
   * 0741 T-018 (AC-US2-01): optional slot for the FindSkillsNavButton (⌘⇧K
   * palette trigger). When provided, renders immediately to the LEFT of the
   * "+ New Skill" CTA — never to the right, so the primary action stays
   * the rightmost call-to-action in the rail.
   */
  findSkillsSlot?: ReactNode;
}

// T-059: Breadcrumb segments dispatch a `studio:navigate-scope` CustomEvent
// so listeners (sidebar) can act on "filter to this plugin" or "scroll to
// this origin section". Using a DOM event avoids threading new props
// through StudioLayout / App while polish-interactions is mid-edit on
// App.tsx. The sidebar listener is a separate follow-up (tracked as a
// blocking note on T-059) — the click surface itself is wired here.
function dispatchNavigateScope(
  detail: { scope: "origin"; origin: "source" | "installed" } | { scope: "plugin"; plugin: string },
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("studio:navigate-scope", { detail }));
}

// 0801: breadcrumb scope label.
//   - Prefers the rich `source` field on SelectedSkill (project|personal|plugin),
//     mapping to the matching scopeLabels token.
//   - Falls back to `origin` for legacy fixtures and pre-0801 callers that
//     populate SelectedSkill without `source`. Historically `origin: "source"`
//     meant "user-authored" → renders the "Skills" (authoring) label;
//     `origin: "installed"` without an explicit source most often means a
//     personal-tier symlink (e.g. ~/.agents/skills/...) → "Personal".
function scopeLabel(selected: SelectedSkill): string {
  if (selected.source === "project") return strings.scopeLabels.sourceProject;
  if (selected.source === "personal") return strings.scopeLabels.sourcePersonal;
  if (selected.source === "plugin") return strings.scopeLabels.sourcePlugin;
  return selected.origin === "installed"
    ? strings.scopeLabels.sourcePersonal
    : strings.scopeLabels.authoringSkills;
}

function scopeColor(selected: SelectedSkill): string {
  if (selected.source === "project") return "var(--status-installed)";
  if (selected.source === "plugin")  return "var(--color-accent-ink)";
  // personal + legacy authoring/installed both use the existing --status-own
  // token to preserve the pre-0801 visual treatment.
  return "var(--status-own)";
}


/**
 * Top rail — logo · project picker | breadcrumb | skill actions | session status.
 *
 * Right side is split into two groups separated by a hairline divider:
 *   - Skill actions: FindSkills (⌘⇧K) + Create Skill CTA
 *   - Session status: AgentModelPicker + UpdateBell
 *
 * Breadcrumb format: `OWN › plugin › skill-name` or `INSTALLED › plugin › skill-name`.
 * When no skill is selected, only the project name shows after the logo.
 *
 * Typography:
 *   - "Skill Studio" — Inter Tight 600 semibold (var(--font-sans)).
 *   - project name  — Inter Tight 400, --text-secondary.
 *   - breadcrumb    — Inter Tight 400, plugin name in meta style, skill name in primary.
 */
export function TopRail({ projectName, selected, onHome, projectPickerSlot, onRequestCreateSkill, findSkillsSlot }: Props) {
  // 0801: breadcrumb scope label derives from the 3-way `source` field
  // (project|personal|plugin) on SelectedSkill. Pre-0801 the label came from
  // the binary `origin` field, which collapsed personal symlinks (origin=
  // installed, source=personal) and project installs (origin=installed,
  // source=project) both to "Project" — so the header lied about where the
  // skill actually lived. Now the header matches the sidebar group.
  const crumbLabel = selected ? scopeLabel(selected) : null;
  const crumbColor = selected ? scopeColor(selected) : "var(--text-secondary)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        height: "100%",
        width: "100%",
        padding: "0 16px",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Logo block — 0686 T-001: logo is now a StudioLogo home-link. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <StudioLogo onHome={onHome} />
        {projectPickerSlot ? (
          <div style={{
            borderLeft: "1px solid var(--border-default)",
            paddingLeft: 10,
            display: "flex",
            alignItems: "center",
          }}>
            {projectPickerSlot}
          </div>
        ) : (
          projectName && (
            <span
              title={projectName}
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                borderLeft: "1px solid var(--border-default)",
                paddingLeft: 10,
                maxWidth: 220,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {projectName}
            </span>
          )
        )}
      </div>

      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--text-secondary)",
        }}
      >
        {selected && crumbLabel && (
          <>
            <BreadcrumbButton
              segment="origin"
              onClick={() => dispatchNavigateScope({ scope: "origin", origin: selected.origin })}
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 600,
                color: crumbColor,
              }}
            >
              {crumbLabel}
            </BreadcrumbButton>
            <Separator />
            <BreadcrumbButton
              segment="plugin"
              onClick={() => dispatchNavigateScope({ scope: "plugin", plugin: selected.plugin })}
              style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
            >
              {selected.plugin}
            </BreadcrumbButton>
            <Separator />
            <span
              data-breadcrumb-segment="skill"
              aria-current="page"
              style={{
                color: "var(--text-primary)",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {selected.skill}
            </span>
          </>
        )}
      </nav>

      {/* Right side — two functional groups separated by a hairline divider.
          Group A (skill actions): find existing skills + create new skill.
          Group B (session status): which agent/model is active + update notifications. */}
      <div
        data-toprail-right="true"
        style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}
      >
        {/* Group A — skill actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {findSkillsSlot}
          {onRequestCreateSkill && (
            <button
              type="button"
              data-slot="create-skill-button"
              onClick={onRequestCreateSkill}
              aria-label="Create a new skill"
              title="Create a new skill"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 28,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid var(--color-action, #2F5B8E)",
                background: "var(--color-action, #2F5B8E)",
                color: "var(--color-action-ink, #FFFFFF)",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
                letterSpacing: "0.01em",
                boxShadow: "0 1px 2px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.12)",
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Skill
            </button>
          )}
        </div>

        {/* Hairline divider — same token used by the project-picker separator. */}
        <span
          aria-hidden="true"
          style={{
            width: 1,
            height: 18,
            background: "var(--border-default)",
          }}
        />

        {/* Group B — session status */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span data-slot="agent-model-picker" style={{ minWidth: 200 }}>
            <AgentModelPicker />
          </span>
          <span data-slot="update-bell" style={{ display: "inline-flex" }}>
            <UpdateBell />
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// T-059: Breadcrumb button — shared styling for clickable OWN / plugin
// segments. Hover lifts the color to accent-ink; rest is text-secondary.
// Uses a plain <button> for correct keyboard semantics.
// ---------------------------------------------------------------------------
function BreadcrumbButton({
  segment,
  onClick,
  style,
  children,
}: {
  segment: "origin" | "plugin";
  onClick: () => void;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-breadcrumb-segment={segment}
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: "var(--text-secondary)",
        fontFamily: "inherit",
        ...style,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "var(--color-accent-ink)";
      }}
      onMouseLeave={(e) => {
        // Restore the segment-specific color if one was supplied via style,
        // else fall back to --text-secondary.
        const restore = (style?.color as string | undefined) ?? "var(--text-secondary)";
        (e.currentTarget as HTMLButtonElement).style.color = restore;
      }}
    >
      {children}
    </button>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" style={{ color: "var(--border-default)", fontSize: 10 }}>
      ›
    </span>
  );
}
