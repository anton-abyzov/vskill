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
}: PluginTreeGroupProps): React.ReactElement {
  const name = pluginName ?? skills[0]?.pluginName ?? "unknown-plugin";
  const [collapsed, setCollapsed] = React.useState(() =>
    readInitialCollapsed(persistKey, initialCollapsed),
  );

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

  const chevron = collapsed ? "▸" : "▾";

  return (
    <div data-vskill-plugin-tree={name} role="group" aria-label={`${name} (${skills.length})`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex items-center gap-1 w-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden className="vskill-chevron tabular-nums w-3 text-center">{chevron}</span>
        <span className="vskill-plugin-name font-mono">{name}</span>
        <span className="vskill-plugin-count tabular-nums ml-auto">({skills.length})</span>
      </button>
      {!collapsed && (
        <div className="vskill-plugin-tree-children pl-4">
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
