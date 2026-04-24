// ---------------------------------------------------------------------------
// 0698 T-015: ProjectCommandPalette — ⌘P fuzzy-filter project switcher.
//
// Renders as an overlay when `open` is true. Caller wires global ⌘P keyboard
// handler (e.g. in StudioLayout) and feeds `projects`. Emits `onSwitch` when
// the user hits Enter on a highlighted project. ⎋ closes.
// ---------------------------------------------------------------------------

import * as React from "react";
import type { ProjectConfigRaw } from "../hooks/useWorkspace";

export interface ProjectCommandPaletteProps {
  open: boolean;
  projects: ProjectConfigRaw[];
  onSwitch: (id: string) => void;
  onClose: () => void;
}

/** Case-insensitive fuzzy match over name + path (space-separated tokens). */
export function fuzzyFilterProjects(
  projects: ProjectConfigRaw[],
  query: string,
): ProjectConfigRaw[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return projects;
  return projects.filter((p) => {
    const hay = `${p.name} ${p.path}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

export function ProjectCommandPalette({
  open,
  projects,
  onSwitch,
  onClose,
}: ProjectCommandPaletteProps): React.ReactElement | null {
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);

  const filtered = React.useMemo(() => fuzzyFilterProjects(projects, query), [projects, query]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlight(0);
    }
  }, [open]);

  React.useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0);
  }, [filtered.length, highlight]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const sel = filtered[highlight];
      if (sel) {
        onSwitch(sel.id);
        onClose();
      }
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-vskill-project-palette
      className="vskill-project-palette fixed inset-0 z-50 flex items-start justify-center pt-24"
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-[520px] max-w-[92vw] bg-background border rounded shadow-lg">
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Switch project…"
          className="w-full px-3 py-2 text-sm border-b outline-none"
        />
        <ul role="listbox" className="max-h-80 overflow-auto">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">No matches.</li>
          )}
          {filtered.map((p, idx) => (
            <li
              key={p.id}
              role="option"
              aria-selected={idx === highlight}
              data-highlighted={idx === highlight}
              className={[
                "flex items-center gap-2 px-3 py-2 text-sm cursor-pointer",
                idx === highlight ? "bg-muted" : "",
              ].join(" ")}
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => {
                onSwitch(p.id);
                onClose();
              }}
            >
              <span
                aria-hidden
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: p.colorDot }}
              />
              <span className="flex-1">
                <span className="vskill-palette-name">{p.name}</span>
                <span className="ml-2 vskill-palette-path text-xs font-mono text-muted-foreground">
                  {p.path}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
