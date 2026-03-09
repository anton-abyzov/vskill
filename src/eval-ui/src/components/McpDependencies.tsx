import { useState, useEffect } from "react";
import { api } from "../api";
import type { McpDependency, SkillDependencyInfo } from "../types";

interface Props {
  plugin: string;
  skill: string;
}

export function McpDependencies({ plugin, skill }: Props) {
  const [mcpDeps, setMcpDeps] = useState<McpDependency[]>([]);
  const [skillDeps, setSkillDeps] = useState<SkillDependencyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api.getDependencies(plugin, skill)
      .then((r) => {
        setMcpDeps(r.mcpDependencies);
        setSkillDeps(r.skillDependencies);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [plugin, skill]);

  async function copyConfig(server: string, snippet: string) {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(server);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard not available */ }
  }

  if (loading) return null;
  if (mcpDeps.length === 0 && skillDeps.length === 0) {
    return (
      <div
        className="mb-5 px-4 py-3 rounded-lg text-[12px]"
        style={{ background: "var(--surface-2)", color: "var(--text-tertiary)", border: "1px solid var(--border-subtle)" }}
      >
        No dependencies detected
      </div>
    );
  }

  return (
    <div
      className="mb-5 rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-5 py-3.5"
        style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(234,179,8,0.15)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </div>
        <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Dependencies
        </span>
        <span className="pill text-[10px]" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>
          {mcpDeps.length + skillDeps.length}
        </span>
      </div>

      <div className="px-5 py-4">
        {/* MCP Dependencies */}
        {mcpDeps.length > 0 && (
          <div className="space-y-3 mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
              MCP Servers
            </div>
            {mcpDeps.map((dep) => (
              <div
                key={dep.server}
                className="p-3 rounded-lg"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{dep.server}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>
                      {dep.transport}
                    </span>
                  </div>
                  <button
                    onClick={() => copyConfig(dep.server, dep.configSnippet)}
                    className="btn btn-ghost text-[11px] py-1 px-2"
                    style={{ color: copied === dep.server ? "var(--green)" : "var(--accent)" }}
                  >
                    {copied === dep.server ? (
                      <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> Copied!</>
                    ) : (
                      <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg> Copy Config</>
                    )}
                  </button>
                </div>
                <div className="text-[11px] mb-2 font-mono" style={{ color: "var(--text-tertiary)" }}>
                  {dep.url}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {dep.matchedTools.map((tool) => (
                    <span
                      key={tool}
                      className="px-2 py-0.5 rounded text-[10px] font-mono"
                      style={{ background: "var(--surface-3)", color: "var(--text-secondary)" }}
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Skill-to-Skill Dependencies */}
        {skillDeps.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>
              Skill Dependencies
            </div>
            <div className="space-y-1.5">
              {skillDeps.map((dep) => (
                <div
                  key={dep.name}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                  <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>
                    {dep.name}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>
                    {dep.source === "frontmatter" ? "frontmatter" : "referenced"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
