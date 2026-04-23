import type { ReactNode } from "react";

interface Props {
  topRail: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
  statusBar: ReactNode;
  /** Optional resize handle rendered between sidebar and main. */
  resizeHandle?: ReactNode;
  /** Optional banner rendered above the top rail (e.g. SSE disconnect). */
  banner?: ReactNode;
  /** aria-live announcement for selection changes. */
  liveMessage?: string;
  /** Sidebar width in px; defaults to 320. Persisted by ResizeHandle (T-019). */
  sidebarWidth?: number;
  /** When true, skip rendering the sidebar column (keyboard toggle). */
  sidebarHidden?: boolean;
}

/**
 * 3-row CSS grid shell for the studio.
 *
 *   ┌─────────────────────────────────┐  var(--top-rail-height)  [top]
 *   ├─────────┬───────────────────────┤
 *   │ aside   │ main                  │  1fr                     [middle]
 *   │         │                       │
 *   ├─────────┴───────────────────────┤
 *   └─────────────────────────────────┘  var(--status-bar-height) [status]
 *
 * Layout variables are declared inline on the root so no global CSS changes
 * are required; responsive sidebar sizing is handled via a media-query rule
 * in globals.css (`.studio-grid`) which owns widths for the existing shell.
 *
 * Component composition is pushed up: parent passes `topRail`, `sidebar`,
 * `main`, `statusBar` nodes — layout has no knowledge of the content.
 */
export function StudioLayout({
  topRail,
  sidebar,
  main,
  statusBar,
  resizeHandle,
  banner,
  liveMessage,
  sidebarWidth = 320,
  sidebarHidden = false,
}: Props) {
  const rootStyle: React.CSSProperties = {
    // Layout vars local to the shell (avoid touching globals.css).
    ["--top-rail-height" as string]: "48px",
    ["--status-bar-height" as string]: "28px",
    ["--sidebar-width" as string]: `${sidebarWidth}px`,
    display: "grid",
    gridTemplateRows:
      "var(--top-rail-height) 1fr var(--status-bar-height)",
    height: "100vh",
    overflow: "hidden",
    background: "var(--bg-canvas)",
    color: "var(--text-primary)",
  };

  const middleStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: sidebarHidden
      ? "1fr"
      : "var(--sidebar-width) auto 1fr",
    minHeight: 0,
    overflow: "hidden",
  };

  return (
    <div className="studio-shell" style={rootStyle}>
      {banner}
      <header
        style={{
          borderBottom: "1px solid var(--border-default)",
          background: "var(--bg-canvas)",
          display: "flex",
          alignItems: "center",
          minHeight: 0,
        }}
      >
        {topRail}
      </header>
      <div style={middleStyle}>
        {!sidebarHidden && (
          <aside
            aria-label="Skills sidebar"
            style={{
              minHeight: 0,
              overflow: "hidden",
              borderRight: resizeHandle ? "none" : "1px solid var(--border-default)",
              background: "var(--bg-canvas)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {sidebar}
          </aside>
        )}
        {!sidebarHidden && resizeHandle}
        <main
          style={{
            minHeight: 0,
            overflow: "auto",
            background: "var(--bg-canvas)",
          }}
        >
          {main}
        </main>
      </div>
      <footer
        role="contentinfo"
        style={{
          borderTop: "1px solid var(--border-default)",
          background: "var(--bg-canvas)",
          display: "flex",
          alignItems: "center",
          minHeight: 0,
        }}
      >
        {statusBar}
      </footer>
      {/* aria-live region for selection announcements. T-044 formalized the
          SR-only component in `<AriaLive />`; the shell keeps this inline
          region to preserve the existing role="status" contract for tests
          that walk the JSX tree. New consumers should import AriaLive. */}
      <div
        aria-live="polite"
        role="status"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {liveMessage ?? ""}
      </div>
    </div>
  );
}
