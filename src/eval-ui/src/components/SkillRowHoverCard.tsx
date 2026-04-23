import { useState, useRef, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import type { SkillInfo } from "../types";

// ---------------------------------------------------------------------------
// T-032: SkillRowHoverCard
//
// Wraps a SkillRow and surfaces progressive-disclosure metadata in a popover
// after a 500ms hover delay. Dismisses immediately on pointer-leave, or
// when Escape is pressed anywhere on the document.
//
// Design constraints (per design brief):
//   - Popover card: var(--bg-surface), 1px var(--border-default), NO shadow.
//   - Single fade-in animation — 180ms var(--ease-standard). No other motion.
//   - Missing fields render as "—" in var(--text-secondary), never empty string.
//   - Tags list capped at 4; overflow shown as "+N".
//   - Progressive disclosure — show only what's useful at a glance:
//       description (3-line clamp), version, relative lastModified, eval count.
//
// Positioning is CSS-only. The card renders absolutely positioned below the
// row; no portal/popover API dependency (keeps the bundle under budget).
// ---------------------------------------------------------------------------

interface Props {
  skill: SkillInfo;
  children: ReactNode;
  hoverDelayMs?: number;
}

export function SkillRowHoverCard({ skill, children, hoverDelayMs = 500 }: Props) {
  const [open, setOpen] = useState<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerEnter = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => setOpen(true), hoverDelayMs);
  }, [clearTimer, hoverDelayMs]);

  const onPointerLeave = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  // Dismiss on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Clean up dangling timers on unmount.
  useEffect(() => () => clearTimer(), [clearTimer]);

  return (
    <div
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{ position: "relative", display: "block" }}
    >
      {children}
      {open ? renderPopover(skill) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Popover body (inline render helper — keeps the returned element tree flat
// for unit tests that walk the element children.)
// ---------------------------------------------------------------------------

function renderPopover(skill: SkillInfo) {
  const tags = skill.tags ?? [];
  const shownTags = tags.slice(0, 4);
  const overflow = Math.max(0, tags.length - shownTags.length);

  return (
    <div
      data-testid="skill-row-hovercard"
      role="tooltip"
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 12,
        zIndex: 20,
        minWidth: 240,
        maxWidth: 320,
        padding: "10px 12px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: 6,
        boxShadow: "none",
        animation: "fade-in 180ms var(--ease-standard, ease) both",
        fontFamily: "var(--font-sans)",
        color: "var(--text-primary)",
      }}
    >
      {/* Description (3-line clamp) */}
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.4,
          color: skill.description ? "var(--text-primary)" : "var(--text-secondary)",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          marginBottom: 8,
        }}
      >
        {skill.description ?? "—"}
      </div>

      {/* Meta row: version + lastModified + eval count */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          color: "var(--text-secondary)",
          marginBottom: tags.length > 0 ? 6 : 0,
        }}
      >
        <span title="Version">{skill.version ?? "—"}</span>
        <span title="Last modified">{formatRelative(skill.lastModified)}</span>
        <span title="Eval count">
          {skill.evalCount != null ? `${skill.evalCount} eval${skill.evalCount === 1 ? "" : "s"}` : "—"}
        </span>
      </div>

      {/* Tags (up to 4, then overflow +N) */}
      {tags.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {shownTags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 10,
                padding: "1px 6px",
                border: "1px solid var(--border-default)",
                borderRadius: 999,
                color: "var(--text-secondary)",
                background: "transparent",
              }}
            >
              {t}
            </span>
          ))}
          {overflow > 0 ? (
            <span
              style={{
                fontSize: 10,
                color: "var(--text-secondary)",
                alignSelf: "center",
              }}
            >
              +{overflow}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}
