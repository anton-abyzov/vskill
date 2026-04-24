// ---------------------------------------------------------------------------
// 0698 T-010: PluginTreeGroup — collapsible per-plugin subtree.
//
// Renders a collapsible row per plugin with its skills nested inside. Shared
// between AVAILABLE > Plugins and AUTHORING > Plugins so the visual treatment
// is identical.
//
// Skills display their `pluginNamespace` (e.g. "anthropic-skills:pdf") in
// monospace so the user can copy/paste it into a /command.
// ---------------------------------------------------------------------------

import * as React from "react";
import type { SkillInfo } from "../types";

export interface PluginTreeGroupProps {
  /** Skills belonging to this single plugin. */
  skills: SkillInfo[];
  /** Plugin name. If omitted, derived from first skill's `pluginName`. */
  pluginName?: string;
  /** Start collapsed (initial). Default: false (expanded). */
  initialCollapsed?: boolean;
  /** Persist collapse state via this key (caller-supplied). Optional. */
  persistKey?: string;
  /** Render a single skill row — caller decides row styling. */
  renderSkill: (skill: SkillInfo) => React.ReactNode;
  /** 0700: optional action slot rendered on the right of the plugin header. */
  headerActionSlot?: React.ReactNode;
  /**
   * 0704: transient override — when true, render as expanded regardless of
   * user preference (initialCollapsed / persisted localStorage). Does NOT
   * mutate the internal `collapsed` state, so toggling forceOpen off
   * restores the user's previous choice.
   */
  forceOpen?: boolean;
}

function readInitialCollapsed(key: string | undefined, fallback: boolean): boolean {
  if (!key || typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "true";
  } catch {
    return fallback;
  }
}

export function PluginTreeGroup({
  skills,
  pluginName,
  initialCollapsed = false,
  persistKey,
  renderSkill,
  headerActionSlot,
  forceOpen = false,
}: PluginTreeGroupProps): React.ReactElement {
  const name = pluginName ?? skills[0]?.pluginName ?? "unknown-plugin";
  const [collapsed, setCollapsed] = React.useState(() =>
    readInitialCollapsed(persistKey, initialCollapsed),
  );
  // 0704: transient override. Internal `collapsed` is untouched so the
  // user's preference persists when forceOpen turns off.
  const effectiveCollapsed = forceOpen ? false : collapsed;

  const onToggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (persistKey && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(persistKey, String(next));
        } catch {
          /* non-fatal */
        }
      }
      return next;
    });
  }, [persistKey]);

  const chevron = effectiveCollapsed ? "▸" : "▾";

  return (
    <div data-vskill-plugin-tree={name} role="group" aria-label={`${name} (${skills.length})`}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          paddingRight: 6,
        }}
      >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!effectiveCollapsed}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flex: 1,
          padding: "4px 4px 4px 18px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text-primary)",
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        <span
          aria-hidden
          className="vskill-chevron tabular-nums"
          style={{
            width: 16,
            display: "inline-block",
            textAlign: "center",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--color-ink, var(--text-primary))",
          }}
        >
          {chevron}
        </span>
        <span className="vskill-plugin-name" style={{ fontFamily: "var(--font-mono)" }}>
          {name}
        </span>
        <span
          className="vskill-plugin-count tabular-nums"
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          ({skills.length})
        </span>
      </button>
      {headerActionSlot && (
        <div style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
          {headerActionSlot}
        </div>
      )}
      </div>
      {!effectiveCollapsed && (
        <div
          className="vskill-plugin-tree-children"
          style={{
            paddingLeft: 36, // chevron(12) + gap(6) + px-left(18) = 36px flush under plugin name
            borderLeft: "1px solid var(--border-subtle, rgba(128,128,128,0.2))",
            marginLeft: 24, // aligns the guide rail with the chevron column
          }}
        >
          {skills.map((s) => (
            <div
              key={`${s.pluginNamespace ?? s.skill}`}
              data-vskill-plugin-skill={s.pluginNamespace ?? s.skill}
            >
              {renderSkill(s)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
