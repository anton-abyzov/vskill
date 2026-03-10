import type { PanelId } from "../pages/workspace/workspaceTypes";

interface Props {
  activePanel: PanelId;
  onPanelChange: (panel: PanelId) => void;
  isDirty: boolean;
  isRunning: boolean;
  hasRegressions: boolean;
  isActivationRunning: boolean;
}

interface TabDef {
  id: PanelId;
  label: string;
  shortcut: string;
}

interface TabGroup {
  label: string;
  tabs: TabDef[];
}

const TAB_GROUPS: TabGroup[] = [
  {
    label: "Build",
    tabs: [
      { id: "editor", label: "Editor", shortcut: "1" },
      { id: "tests", label: "Tests", shortcut: "2" },
    ],
  },
  {
    label: "Evaluate",
    tabs: [
      { id: "run", label: "Run", shortcut: "3" },
      { id: "activation", label: "Activation", shortcut: "4" },
    ],
  },
  {
    label: "Insights",
    tabs: [
      { id: "history", label: "History", shortcut: "5" },
      { id: "deps", label: "Deps", shortcut: "6" },
    ],
  },
];

function TabIcon({ id }: { id: PanelId }) {
  const props = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

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

export function TabBar({ activePanel, onPanelChange, isDirty, isRunning, hasRegressions, isActivationRunning }: Props) {
  return (
    <div
      className="flex items-center gap-0.5 px-3 overflow-x-auto"
      style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)", flexShrink: 0 }}
    >
      {TAB_GROUPS.map((group, gi) => (
        <div key={group.label} className="flex items-center">
          {gi > 0 && (
            <div style={{ width: 1, height: 20, background: "var(--border-subtle)", margin: "0 6px", flexShrink: 0 }} />
          )}
          {group.tabs.map((tab) => {
            const active = activePanel === tab.id;
            const showDot = (tab.id === "editor" && isDirty) ||
              (tab.id === "run" && isRunning) ||
              (tab.id === "activation" && isActivationRunning) ||
              (tab.id === "history" && hasRegressions);

            const dotColor = tab.id === "run" ? "var(--accent)"
              : tab.id === "activation" ? "var(--accent)"
              : tab.id === "history" ? "var(--red)"
              : "var(--yellow)";

            return (
              <button
                key={tab.id}
                onClick={() => onPanelChange(tab.id)}
                title={`${tab.label} (Ctrl+${tab.shortcut})`}
                className="relative flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium transition-colors duration-150"
                style={{
                  background: "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-tertiary)",
                  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                  cursor: "pointer",
                  border: "none",
                  borderBottomWidth: 2,
                  borderBottomStyle: "solid",
                  borderBottomColor: active ? "var(--accent)" : "transparent",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = "var(--text-secondary)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = "var(--text-tertiary)";
                }}
              >
                <TabIcon id={tab.id} />
                {tab.label}
                {showDot && (
                  <span
                    className="absolute top-1.5 right-1 rounded-full"
                    style={{ width: 5, height: 5, background: dotColor }}
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
