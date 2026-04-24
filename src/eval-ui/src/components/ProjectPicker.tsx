// ---------------------------------------------------------------------------
// 0698 T-015: ProjectPicker — top-left pill + popover for multi-project switch.
//
// Design decisions (frontend-design skill):
//   - Elevated surface: solid background + 1px border + subtle shadow. No
//     backdrop-blur tricks — the popover must be READ over whatever is below.
//   - Info architecture: each row has TWO lines — name (primary, sans-serif,
//     ~13px) and truncated path (secondary, monospace, 11px, tertiary tone).
//     Full path shows on hover via `title`.
//   - One primary action per row: clicking anywhere on the row switches the
//     project. "Remove" is an icon-only secondary action, quiet by default
//     and revealed on row hover.
//   - Width constraint: min 280px, max 420px. Long paths truncate with
//     ellipsis instead of stretching the popover.
//   - Footer: visual divider + primary-button treatment for "Add project".
//   - Dismissal: clicking outside the popover closes it.
// ---------------------------------------------------------------------------

import * as React from "react";
import type { ProjectConfigRaw } from "../hooks/useWorkspace";

export interface ProjectPickerProps {
  workspace: { projects: ProjectConfigRaw[]; activeProjectId: string | null } | undefined;
  onSwitch: (id: string) => void | Promise<void>;
  onAdd: (input: { path: string; name?: string }) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
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
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const [switchHint, setSwitchHint] = React.useState<ProjectConfigRaw | null>(null);
  const [copied, setCopied] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const projects = workspace?.projects ?? [];
  const active = projects.find((p) => p.id === workspace?.activeProjectId);

  // Dismiss on outside click
  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setAdding(false);
        setError(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function handleAdd(): Promise<void> {
    setError(null);
    const trimmed = inputPath.trim();
    if (!trimmed) {
      setError("Paste an absolute path (e.g. /Users/you/projects/my-skill)");
      return;
    }
    if (!trimmed.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(trimmed)) {
      setError(
        "Path must be absolute. In Terminal, cd to the folder and run: pwd — then paste the result here.",
      );
      return;
    }
    try {
      await onAdd({ path: trimmed });
      setInputPath("");
      setAdding(false);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (/does not exist/i.test(raw)) {
        setError(`Path not found on disk: ${trimmed}`);
      } else if (/Duplicate/i.test(raw)) {
        setError("That project is already registered.");
      } else {
        setError(raw);
      }
    }
  }

  async function handleBrowse(): Promise<void> {
    setError(null);
    if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
      try {
        const handle = await (
          window as Window & { showDirectoryPicker?: () => Promise<{ name: string }> }
        ).showDirectoryPicker!();
        setInputPath(handle.name);
        setAdding(true);
      } catch {
        /* user cancelled */
      }
    } else {
      setAdding(true);
    }
  }

  function truncatePath(path: string): string {
    // Keep the head + tail for recognizability: /Users/anton/…/vskill
    if (path.length <= 50) return path;
    const segs = path.split("/");
    if (segs.length <= 4) return path;
    return `${segs.slice(0, 3).join("/")}/…/${segs.slice(-2).join("/")}`;
  }

  return (
    <div
      ref={containerRef}
      data-vskill-project-picker
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={active?.path ?? "No project selected"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 10px",
          border: "1px solid transparent",
          borderRadius: 6,
          background: open ? "var(--surface-2, rgba(0,0,0,0.05))" : "transparent",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          color: "var(--text-primary)",
          transition: "background-color 120ms ease",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            backgroundColor: active?.colorDot ?? "var(--text-tertiary, #999)",
          }}
        />
        <span
          style={{
            maxWidth: 180,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {active ? active.name : "No project"}
        </span>
        <span
          aria-hidden
          style={{
            fontSize: 10,
            color: "var(--text-tertiary, #999)",
            marginLeft: 2,
          }}
        >
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Switch project"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: 280,
            maxWidth: 420,
            width: "max-content",
            background: "var(--color-paper, #fff)",
            border: "1px solid var(--border-default, rgba(0,0,0,0.12))",
            borderRadius: 8,
            boxShadow:
              "0 4px 6px -1px rgba(0,0,0,0.08), 0 10px 20px -5px rgba(0,0,0,0.12)",
            overflow: "hidden",
            zIndex: 50,
            fontFamily: "var(--font-sans)",
          }}
        >
          {projects.length === 0 && (
            <div
              style={{
                padding: "16px 16px 12px",
                fontSize: 12,
                color: "var(--text-tertiary)",
                lineHeight: 1.5,
              }}
            >
              No projects registered. Add one to get started.
            </div>
          )}

          {projects.length > 0 && (
            <ul
              role="none"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 4,
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              {projects.map((p) => {
                const stale = isPathStale ? isPathStale(p.path) : false;
                const isActive = p.id === workspace?.activeProjectId;
                const isHovered = hoveredId === p.id;

                return (
                  <li
                    key={p.id}
                    role="menuitem"
                    data-stale={stale ? "true" : "false"}
                    onMouseEnter={() => setHoveredId(p.id)}
                    onMouseLeave={() => setHoveredId((h) => (h === p.id ? null : h))}
                    onClick={() => {
                      if (stale) return;
                      // The server's skill scanner is tied to the launch --root
                      // and can't be re-rooted from the browser — so clicking
                      // a non-active project shows instructions to relaunch
                      // from there. Active project row is a no-op.
                      if (isActive) {
                        setOpen(false);
                        return;
                      }
                      setSwitchHint(p);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 6,
                      cursor: stale ? "not-allowed" : "pointer",
                      background: isHovered && !stale
                        ? "var(--surface-2, rgba(0,0,0,0.04))"
                        : isActive
                          ? "var(--surface-1, rgba(0,0,0,0.02))"
                          : "transparent",
                      opacity: stale ? 0.5 : 1,
                      transition: "background-color 120ms ease",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        flexShrink: 0,
                        backgroundColor: p.colorDot,
                        boxShadow: isActive
                          ? "0 0 0 2px color-mix(in oklch, currentColor 20%, transparent)"
                          : "none",
                      }}
                    />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 13,
                          fontWeight: isActive ? 600 : 500,
                          color: "var(--text-primary)",
                          lineHeight: 1.3,
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.name}
                        </span>
                        {isActive && (
                          <span
                            aria-label="Active"
                            style={{
                              fontSize: 10,
                              color: "var(--color-accent, #2f6f8f)",
                              letterSpacing: "0.05em",
                              textTransform: "uppercase",
                              fontWeight: 600,
                            }}
                          >
                            Active
                          </span>
                        )}
                      </div>
                      <div
                        title={p.path}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          color: "var(--text-tertiary)",
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {truncatePath(p.path)}
                      </div>
                      {stale && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--color-own, #b45309)",
                            marginTop: 2,
                          }}
                        >
                          Path no longer exists
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      aria-label={`Remove ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onRemove(p.id);
                      }}
                      style={{
                        width: 24,
                        height: 24,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "none",
                        background: "transparent",
                        borderRadius: 4,
                        cursor: "pointer",
                        color: "var(--text-tertiary)",
                        opacity: isHovered ? 1 : 0,
                        transition: "opacity 120ms ease, color 120ms ease, background-color 120ms ease",
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "var(--color-error, #b91c1c)";
                        e.currentTarget.style.backgroundColor =
                          "color-mix(in oklch, var(--color-error, #b91c1c) 10%, transparent)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "var(--text-tertiary)";
                        e.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Footer: divider + primary add action */}
          <div
            style={{
              borderTop: "1px solid var(--border-subtle, rgba(0,0,0,0.08))",
              padding: adding ? 8 : 6,
            }}
          >
            {!adding && (
              <button
                type="button"
                onClick={() => void handleBrowse()}
                className="vskill-project-add"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "8px 10px",
                  border: "none",
                  borderRadius: 6,
                  background: "transparent",
                  cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--color-accent, #2f6f8f)",
                  transition: "background-color 120ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    "color-mix(in oklch, var(--color-accent, #2f6f8f) 10%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add project
              </button>
            )}
            {adding && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  type="text"
                  value={inputPath}
                  onChange={(e) => setInputPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleAdd();
                    if (e.key === "Escape") {
                      setAdding(false);
                      setError(null);
                    }
                  }}
                  placeholder="/absolute/path/to/project"
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    border: "1px solid var(--border-default, rgba(0,0,0,0.12))",
                    borderRadius: 4,
                    background: "var(--surface-0, #fff)",
                    color: "var(--text-primary)",
                    outline: "none",
                  }}
                />
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setError(null);
                      setInputPath("");
                    }}
                    style={{
                      padding: "4px 10px",
                      fontSize: 12,
                      border: "1px solid var(--border-default, rgba(0,0,0,0.12))",
                      borderRadius: 4,
                      background: "transparent",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAdd()}
                    style={{
                      padding: "4px 10px",
                      fontSize: 12,
                      border: "none",
                      borderRadius: 4,
                      background: "var(--color-accent, #2f6f8f)",
                      color: "var(--color-paper, #fff)",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                  >
                    Add
                  </button>
                </div>
                {error && (
                  <div style={{ fontSize: 11, color: "var(--color-error, #b91c1c)" }}>
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Switch-project hint modal. The server's skill scanner is bound to
          its launch --root, so clicking a non-active project can't retarget
          it from the browser. Instead we show the exact command the user
          should run in their terminal. */}
      {switchHint && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Switch project instructions"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setSwitchHint(null)}
        >
          <div
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.40)" }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              width: "min(520px, 92vw)",
              background: "var(--color-paper, #fff)",
              border: "1px solid var(--border-default, rgba(0,0,0,0.12))",
              borderRadius: 10,
              boxShadow: "0 10px 15px -3px rgba(0,0,0,0.12), 0 20px 40px -8px rgba(0,0,0,0.18)",
              padding: 18,
              fontFamily: "var(--font-sans)",
              color: "var(--text-primary)",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                fontFamily: "var(--font-serif, ui-serif)",
                marginBottom: 8,
              }}
            >
              Switch to {switchHint.name}
            </h2>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
                margin: 0,
                marginBottom: 12,
              }}
            >
              Skill Studio's skill scanner reads from the folder it was launched in,
              so switching projects from the browser isn't possible. Quit this server
              and relaunch from the target folder:
            </p>
            <div
              style={{
                background: "var(--surface-1, #0f0f10)",
                color: "var(--text-primary)",
                padding: "10px 12px",
                borderRadius: 6,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
              }}
            >
              {`cd "${switchHint.path}" && npx vskill@latest studio`}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `cd "${switchHint.path}" && npx vskill@latest studio`,
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  } catch {
                    /* clipboard API not available */
                  }
                }}
                style={{
                  padding: "7px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "1px solid var(--color-accent, #2f6f8f)",
                  borderRadius: 6,
                  background: "var(--color-accent, #2f6f8f)",
                  color: "#ffffff",
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.12)",
                }}
              >
                {copied ? "Copied!" : "Copy command"}
              </button>
              <button
                type="button"
                onClick={() => setSwitchHint(null)}
                style={{
                  padding: "7px 12px",
                  fontSize: 13,
                  fontWeight: 500,
                  border: "1px solid var(--border-default, rgba(0,0,0,0.12))",
                  borderRadius: 6,
                  background: "transparent",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
