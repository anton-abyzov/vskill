import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SkillInfo } from "../types";
import { strings } from "../strings";

/**
 * ContextMenu for skill rows (T-041).
 *
 * Contract:
 *   - Opens at the cursor / long-press location via `openAt({x, y})`.
 *   - Items are filtered by origin + updateAvailable. OWN skills get Edit /
 *     Duplicate; INSTALLED get Update / Uninstall (and only if
 *     updateAvailable). Common items (Open, Copy Path, Reveal in Editor,
 *     Run Benchmark) appear everywhere.
 *   - role="menu" wrapper, each item role="menuitem". Arrow keys navigate,
 *     Enter/Space invokes, Escape closes and restores focus.
 *   - Positioned at the cursor; flips horizontally when near the right edge,
 *     and vertically when near the bottom edge.
 *   - Click-outside closes.
 */

export type ContextMenuAction =
  | "open"
  | "copy-path"
  | "reveal"
  | "edit"
  | "duplicate"
  | "run-benchmark"
  | "update"
  | "uninstall"
  | "delete";

export interface ContextMenuItem {
  action: ContextMenuAction;
  label: string;
  /** When true, item is visually disabled and cannot be invoked. */
  disabled?: boolean;
  /** Tooltip text — rendered on the menuitem's `title` attribute. */
  title?: string;
}

export interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  skill: SkillInfo | null;
}

interface Props {
  state: ContextMenuState;
  onClose: () => void;
  onAction: (action: ContextMenuAction, skill: SkillInfo) => void;
  /** Optional override to test menu-item selection — defaults to the derived set. */
  itemsOverride?: ContextMenuItem[];
}

/** Pure helper — compute the visible item list for a skill. */
export function itemsForSkill(skill: SkillInfo): ContextMenuItem[] {
  const a = strings.actions;
  const base: ContextMenuItem[] = [
    { action: "open", label: a.open },
    { action: "copy-path", label: a.copyPath },
    { action: "reveal", label: a.revealInEditor },
    { action: "run-benchmark", label: a.runBenchmark },
  ];
  if (skill.origin === "source") {
    return [
      ...base,
      { action: "edit", label: a.edit },
      { action: "duplicate", label: a.duplicate },
      { action: "delete", label: a.delete },
    ];
  }
  // installed (plugin/global)
  const out = [...base];
  if (skill.updateAvailable) out.push({ action: "update", label: a.update });
  out.push({ action: "uninstall", label: a.uninstall });
  // 0722: still surface Delete so the user understands why it's unavailable.
  out.push({
    action: "delete",
    label: a.delete,
    disabled: true,
    title: a.deletePluginTooltip,
  });
  return out;
}

export function ContextMenu({ state, onClose, onAction, itemsOverride }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [cursor, setCursor] = useState(0);

  const items = useMemo<ContextMenuItem[]>(() => {
    if (!state.skill) return [];
    return itemsOverride ?? itemsForSkill(state.skill);
  }, [state.skill, itemsOverride]);

  // Flip positioning near viewport edges. Measured after mount.
  const position = useMemo(() => {
    if (typeof window === "undefined") return { left: state.x, top: state.y };
    const pad = 8;
    const mw = 220; // approximate menu width
    const mh = 44 + items.length * 28;
    let left = state.x;
    let top = state.y;
    if (left + mw + pad > window.innerWidth) left = Math.max(pad, state.x - mw);
    if (top + mh + pad > window.innerHeight) top = Math.max(pad, state.y - mh);
    return { left, top };
  }, [state.x, state.y, items.length]);

  useEffect(() => {
    if (!state.open) return;
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    setCursor(0);
    requestAnimationFrame(() => {
      menuRef.current?.focus();
    });
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, [state.open]);

  const invokeCurrent = useCallback(() => {
    if (!state.skill) return;
    const it = items[cursor];
    if (!it || it.disabled) return;
    onAction(it.action, state.skill);
    onClose();
  }, [items, cursor, state.skill, onAction, onClose]);

  useEffect(() => {
    if (!state.open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, Math.max(items.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        invokeCurrent();
        return;
      }
    }
    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!(e.target instanceof Node)) return;
      if (menuRef.current.contains(e.target)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [state.open, onClose, items.length, invokeCurrent]);

  if (!state.open || !state.skill) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      data-testid="context-menu"
      style={{
        position: "fixed",
        left: position.left,
        top: position.top,
        zIndex: 70,
        minWidth: 200,
        padding: 4,
        background: "var(--bg-canvas)",
        border: "1px solid var(--border-default)",
        borderRadius: 6,
        boxShadow: "0 12px 32px rgba(0,0,0,0.16)",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        color: "var(--text-primary)",
        outline: "none",
      }}
    >
      {items.map((item, i) => (
        <div
          key={item.action}
          role="menuitem"
          aria-disabled={item.disabled || undefined}
          title={item.title || undefined}
          data-action={item.action}
          data-selected={i === cursor || undefined}
          onMouseEnter={() => setCursor(i)}
          onClick={() => {
            if (item.disabled) return;
            onAction(item.action, state.skill!);
            onClose();
          }}
          style={{
            padding: "5px 10px",
            borderRadius: 4,
            cursor: item.disabled ? "default" : "pointer",
            opacity: item.disabled ? 0.5 : 1,
            background:
              i === cursor
                ? "color-mix(in srgb, var(--accent-surface) 10%, transparent)"
                : "transparent",
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
