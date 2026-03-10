import type { PanelId } from "./workspaceTypes";

interface Props {
  activePanel: PanelId;
  onPanelChange: (panel: PanelId) => void;
  isDirty: boolean;
  isRunning: boolean;
  hasRegressions: boolean;
  isActivationRunning: boolean;
}

interface PanelGroup {
  label: string;
  panels: { id: PanelId; label: string; shortcut: string }[];
}

const PANEL_GROUPS: PanelGroup[] = [
  {
    label: "Build",
    panels: [
      { id: "editor", label: "Editor", shortcut: "1" },
      { id: "tests", label: "Tests", shortcut: "2" },
    ],
  },
  {
    label: "Evaluate",
    panels: [
      { id: "run", label: "Run", shortcut: "3" },
      { id: "activation", label: "Activation", shortcut: "4" },
    ],
  },
  {
    label: "Insights",
    panels: [
      { id: "history", label: "History", shortcut: "5" },
      { id: "deps", label: "Deps", shortcut: "6" },
    ],
  },
];

function PanelIcon({ id, active }: { id: PanelId; active: boolean }) {
  const stroke = active ? "#fff" : "currentColor";
  const props = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (id) {
    case "editor":
      return (
        <svg {...props}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case "tests":
      return (
        <svg {...props}>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      );
    case "run":
      return (
        <svg {...props}>
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    case "activation":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case "history":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "deps":
      return (
        <svg {...props}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
  }
}

export function LeftRail({ activePanel, onPanelChange, isDirty, isRunning, hasRegressions, isActivationRunning }: Props) {
  return (
    <div
      className="flex flex-col py-2 px-1"
      style={{
        background: "var(--surface-1)",
        borderRight: "1px solid var(--border-subtle)",
        width: 48,
      }}
    >
      {PANEL_GROUPS.map((group, gi) => (
        <div key={group.label}>
          {gi > 0 && (
            <div style={{ height: 1, background: "var(--border-subtle)", margin: "4px 6px" }} />
          )}
          <div
            style={{
              fontSize: 8,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-tertiary)",
              textAlign: "center",
              padding: "5px 0 3px",
            }}
          >
            {group.label}
          </div>
          <div className="flex flex-col gap-1">
            {group.panels.map((p) => {
              const active = activePanel === p.id;
              const showDot = (p.id === "editor" && isDirty) ||
                (p.id === "run" && isRunning) ||
                (p.id === "activation" && isActivationRunning) ||
                (p.id === "history" && hasRegressions);

              return (
                <button
                  key={p.id}
                  onClick={() => onPanelChange(p.id)}
                  title={`${p.label} (Ctrl+${p.shortcut})`}
                  className="relative flex items-center justify-center rounded-lg transition-all duration-150"
                  style={{
                    width: 40,
                    height: 40,
                    margin: "0 auto",
                    background: active ? "var(--accent)" : "transparent",
                    color: active ? "#fff" : "var(--text-tertiary)",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "var(--surface-3)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--text-tertiary)";
                    }
                  }}
                >
                  <PanelIcon id={p.id} active={active} />
                  {showDot && (
                    <span
                      className="absolute top-1 right-1 rounded-full"
                      style={{
                        width: 6,
                        height: 6,
                        background: p.id === "run" ? "var(--accent)"
                          : p.id === "activation" ? "var(--accent)"
                          : p.id === "history" ? "var(--red)"
                          : "var(--yellow)",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
