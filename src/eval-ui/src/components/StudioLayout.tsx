import { useStudio } from "../StudioContext";

interface Props {
  left: React.ReactNode;
  right: React.ReactNode;
}

export function StudioLayout({ left, right }: Props) {
  const { state } = useStudio();

  // Mobile: show one panel at a time
  if (state.isMobile) {
    return (
      <div style={{ height: "100vh", overflow: "hidden", background: "var(--surface-0)" }}>
        {state.mobileView === "list" ? (
          <div style={{ height: "100%", overflowY: "auto", background: "var(--surface-1)" }}>
            {left}
          </div>
        ) : (
          <div style={{ height: "100%", overflowY: "auto" }}>
            {right}
          </div>
        )}
      </div>
    );
  }

  // Desktop: split-pane
  return (
    <div
      className="studio-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "280px 1px 1fr",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      <div style={{ overflowY: "auto", background: "var(--surface-1)" }}>
        {left}
      </div>
      <div style={{ background: "var(--border-subtle)" }} />
      <div style={{ overflowY: "auto", background: "var(--surface-0)" }}>
        {right}
      </div>
    </div>
  );
}
