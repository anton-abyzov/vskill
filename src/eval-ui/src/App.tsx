import { useState, useEffect } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { SkillListPage } from "./pages/SkillListPage";
import { SkillDetailPage } from "./pages/SkillDetailPage";
import { BenchmarkPage } from "./pages/BenchmarkPage";
import { ComparisonPage } from "./pages/ComparisonPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ActivationTestPage } from "./pages/ActivationTestPage";
import { ModelSelector } from "./components/ModelSelector";
import { api } from "./api";

/* ------------------------------------------------------------------ */
/* SVG Icons (inline, zero deps)                                      */
/* ------------------------------------------------------------------ */
function IconSkills({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "#fff" : "currentColor"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function IconActivation({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "#fff" : "currentColor"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

const NAV_ITEMS = [
  { path: "/", label: "Skills", Icon: IconSkills },
  { path: "/activation", label: "Activation Test", Icon: IconActivation },
];

export function App() {
  const location = useLocation();
  const [projectName, setProjectName] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((c) => setProjectName(c.projectName)).catch(() => {});
  }, []);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <nav
        className="w-[220px] flex flex-col flex-shrink-0"
        style={{ background: "var(--surface-1)", borderRight: "1px solid var(--border-subtle)" }}
      >
        {/* Logo */}
        <div className="px-5 py-5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--accent-muted)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div>
              <div className="text-[14px] font-semibold" style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
                Skill Builder
              </div>
              <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                {projectName || "vskill"}
              </div>
            </div>
          </div>
        </div>

        {/* Nav links */}
        <div className="flex-1 px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest px-2 mb-2" style={{ color: "var(--text-tertiary)" }}>
            Navigation
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className="flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-[13px] font-medium mb-0.5 transition-all duration-150"
                style={{
                  background: isActive ? "var(--accent)" : "transparent",
                  color: isActive ? "#fff" : "var(--text-secondary)",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "var(--surface-3)";
                    e.currentTarget.style.color = "var(--text-primary)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }
                }}
              >
                <item.Icon active={isActive} />
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Model selector */}
        <div className="px-3 py-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-widest px-2 mb-2" style={{ color: "var(--text-tertiary)" }}>
            Model
          </div>
          <ModelSelector />
        </div>
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-auto" style={{ background: "var(--surface-0)" }}>
        <div key={location.pathname} className="animate-fade-in">
          <Routes>
            <Route path="/" element={<SkillListPage />} />
            <Route path="/skills/:plugin/:skill" element={<SkillDetailPage />} />
            <Route path="/skills/:plugin/:skill/benchmark" element={<BenchmarkPage />} />
            <Route path="/skills/:plugin/:skill/compare" element={<ComparisonPage />} />
            <Route path="/skills/:plugin/:skill/history" element={<HistoryPage />} />
            <Route path="/activation" element={<ActivationTestPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
