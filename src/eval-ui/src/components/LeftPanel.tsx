import { useState, useEffect } from "react";
import { useStudio } from "../StudioContext";
import { SkillSearch } from "./SkillSearch";
import { SkillGroupList } from "./SkillGroupList";
import { ModelSelector } from "./ModelSelector";
import { api } from "../api";

export function LeftPanel() {
  const { state, setMode } = useStudio();
  const [projectName, setProjectName] = useState<string | null>(null);
  const [creatorStatus, setCreatorStatus] = useState<{ installed: boolean; installCommand: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getConfig().then((c) => setProjectName(c.projectName)).catch(() => {});
    api.getSkillCreatorStatus().then(setCreatorStatus).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Brand header + model selector */}
      <div className="px-4 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "var(--accent-muted)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold truncate" style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
              Skill Studio
            </div>
            <div className="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
              {projectName || "vskill"}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <ModelSelector />
        </div>
      </div>

      {/* Search */}
      <SkillSearch />

      {/* New Skill button */}
      <div className="px-3 pb-2 flex-shrink-0">
        <button
          onClick={() => setMode("create")}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition-all duration-150"
          style={{
            background: state.mode === "create" ? "var(--accent)" : "var(--surface-3)",
            color: state.mode === "create" ? "#fff" : "var(--text-secondary)",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            if (state.mode !== "create") {
              e.currentTarget.style.background = "var(--surface-4)";
              e.currentTarget.style.color = "var(--text-primary)";
            }
          }}
          onMouseLeave={(e) => {
            if (state.mode !== "create") {
              e.currentTarget.style.background = "var(--surface-3)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Skill
        </button>
      </div>

      {/* Skill-Creator status */}
      {creatorStatus && (
        <div className="px-3 pb-2 flex-shrink-0">
          {creatorStatus.installed ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--green)" }} />
              Skill Creator installed
            </div>
          ) : (
            <div
              className="px-3 py-2 rounded-lg text-[11px]"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
            >
              <div className="flex items-center gap-2 mb-1.5" style={{ color: "var(--yellow)" }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--yellow)" }} />
                <span className="font-medium">Skill Creator not installed</span>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(creatorStatus.installCommand).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }).catch(() => {});
                }}
                className="w-full text-left px-2 py-1 rounded text-[10px] font-mono cursor-pointer transition-colors duration-150"
                style={{
                  background: "var(--surface-0)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-subtle)",
                }}
                title="Click to copy"
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
              >
                {copied ? "Copied!" : creatorStatus.installCommand}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Skill list */}
      <div className="flex-1 overflow-y-auto" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <SkillGroupList />
      </div>
    </div>
  );
}
