// ---------------------------------------------------------------------------
// 0698 T-015: ProjectPicker — top-left pill + popover for multi-project switch.
//
// Mirrors the AgentScopePicker sticky-trigger + popover pattern. The pill is
// mounted in StudioLayout header. Click opens a popover listing registered
// projects with name, monospace path, and hashed OKLCH color dot.
// ---------------------------------------------------------------------------

import * as React from "react";
import type { ProjectConfigRaw } from "../hooks/useWorkspace";

export interface ProjectPickerProps {
  workspace: { projects: ProjectConfigRaw[]; activeProjectId: string | null } | undefined;
  onSwitch: (id: string) => void | Promise<void>;
  onAdd: (input: { path: string; name?: string }) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  /** Test seam — override existsSync for stale-path muting. */
  isPathStale?: (path: string) => boolean;
}

export function ProjectPicker({
  workspace,
  onSwitch,
  onAdd,
  onRemove,
  isPathStale,
}: ProjectPickerProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [inputPath, setInputPath] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const projects = workspace?.projects ?? [];
  const active = projects.find((p) => p.id === workspace?.activeProjectId);

  async function handleAdd(): Promise<void> {
    setError(null);
    const trimmed = inputPath.trim();
    if (!trimmed) {
      setError("Enter an absolute project path");
      return;
    }
    try {
      await onAdd({ path: trimmed });
      setInputPath("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleBrowse(): Promise<void> {
    setError(null);
    if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
      try {
        // Directory picker is only available as a secure-context API (Chrome/Edge).
        const handle = await (
          window as Window & { showDirectoryPicker?: () => Promise<{ name: string }> }
        ).showDirectoryPicker!();
        setInputPath(handle.name); // browser API returns only dir name — user must refine
      } catch {
        /* user cancelled */
      }
    } else {
      setAdding(true);
    }
  }

  return (
    <div data-vskill-project-picker className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="vskill-project-pill flex items-center gap-2 px-2 py-1 text-sm font-mono"
      >
        <span
          data-testid="project-color-dot"
          aria-hidden
          className="vskill-project-dot inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: active?.colorDot ?? "var(--muted-foreground)" }}
        />
        <span className="vskill-project-name">
          {active ? active.name : "No project selected"}
        </span>
      </button>
      {open && (
        <div role="menu" className="vskill-project-popover absolute top-full left-0 mt-1 min-w-64 border rounded shadow-md bg-background z-10">
          {projects.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No projects — add one to begin.
            </div>
          )}
          {projects.map((p) => {
            const stale = isPathStale ? isPathStale(p.path) : false;
            return (
              <div
                key={p.id}
                role="menuitem"
                data-stale={stale ? "true" : "false"}
                className={[
                  "flex items-center gap-2 px-3 py-2",
                  stale ? "opacity-50 pointer-events-none-selection" : "cursor-pointer hover:bg-muted",
                ].join(" ")}
              >
                <span
                  aria-hidden
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: p.colorDot }}
                />
                <button
                  type="button"
                  disabled={stale}
                  onClick={() => {
                    if (!stale) {
                      void onSwitch(p.id);
                      setOpen(false);
                    }
                  }}
                  className="flex-1 text-left text-sm"
                >
                  <div className="vskill-project-row-name">{p.name}</div>
                  <div className="vskill-project-row-path text-xs font-mono text-muted-foreground">
                    {p.path}
                  </div>
                  {stale && (
                    <div className="text-xs text-amber-600">Stale — path no longer exists.</div>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onRemove(p.id);
                  }}
                  className="px-2 text-xs text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </div>
            );
          })}
          <div className="border-t px-3 py-2 text-xs">
            {!adding && (
              <button
                type="button"
                onClick={() => void handleBrowse()}
                className="vskill-project-add text-xs text-primary hover:underline"
              >
                + Add project
              </button>
            )}
            {adding && (
              <div className="flex gap-1">
                <input
                  type="text"
                  value={inputPath}
                  onChange={(e) => setInputPath(e.target.value)}
                  placeholder="/absolute/path/to/project"
                  className="flex-1 px-2 py-1 text-xs border rounded"
                  autoFocus
                />
                <button type="button" onClick={() => void handleAdd()} className="text-xs">
                  Add
                </button>
              </div>
            )}
            {error && <div className="mt-1 text-xs text-destructive">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
