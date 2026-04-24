import type { ReactNode } from "react";
import type { SelectedSkill } from "../StudioContext";
import { AgentModelPicker } from "./AgentModelPicker";
import { StudioLogo } from "./StudioLogo";
import { UpdateBell } from "./UpdateBell";

interface Props {
  projectName: string | null;
  selected: SelectedSkill | null;
  onOpenPalette: () => void;
  /** 0698 T-016: optional slot for the multi-project picker pill next to the logo.
   *  When provided, renders instead of the legacy projectName inline label. */
  projectPickerSlot?: ReactNode;
  /**
   * 0686 T-001 (US-001): called when the user activates the "Skill Studio"
   * logo. App.tsx uses this to clear any selected skill so the detail pane
   * returns to its empty state alongside the hash navigation to "#/".
   */
  onHome?: () => void;
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

/**
 * Top rail — logo + "Skill Studio" label + breadcrumb + ⌘K trigger.
 *
 * Breadcrumb format: `OWN › plugin › skill-name` or `INSTALLED › plugin › skill-name`.
 * When no skill is selected, only the project name shows after the logo.
 *
 * Typography:
 *   - "Skill Studio" — Inter Tight 600 semibold (var(--font-sans)).
 *   - project name  — Inter Tight 400, --text-secondary.
 *   - breadcrumb    — Inter Tight 400, plugin name in meta style, skill name in primary.
 */
export function TopRail({ projectName, selected, onOpenPalette, onHome, projectPickerSlot }: Props) {
  const originLabel = selected
    ? selected.origin === "installed"
      ? "Installed"
      : "Own"
    : null;

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
        {selected && originLabel && (
          <>
            <BreadcrumbButton
              segment="origin"
              onClick={() => dispatchNavigateScope({ scope: "origin", origin: selected.origin })}
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 600,
                color: selected.origin === "installed" ? "var(--status-installed)" : "var(--status-own)",
              }}
            >
              {originLabel}
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

      {/* Quick actions */}
      <div
        data-toprail-right="true"
        style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}
      >
        {/* 0682: AgentModelPicker replaces the legacy flat ModelSelector.
            Two-pane agent + model chooser with searchable OpenRouter catalog,
            unified Settings modal, and Claude Code auto-default. */}
        <span data-slot="agent-model-picker" style={{ minWidth: 200 }}>
          <AgentModelPicker />
        </span>
        {/* 0683 T-008: UpdateBell sits between ModelSelector and the ⌘K button. */}
        <span data-slot="update-bell" style={{ display: "inline-flex" }}>
          <UpdateBell />
        </span>
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Open command palette"
          title="Command palette (⌘K)"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 10px",
            borderRadius: 4,
            border: "1px solid var(--border-default)",
            background: "transparent",
            color: "var(--text-secondary)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            cursor: "pointer",
          }}
        >
          <span>⌘K</span>
        </button>
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
