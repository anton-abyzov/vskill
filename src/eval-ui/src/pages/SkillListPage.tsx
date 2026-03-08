import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { SkillInfo } from "../types";

const STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  pass:    { bg: "var(--green-muted)", text: "var(--green)",  dot: "var(--green)",  label: "Passing" },
  fail:    { bg: "var(--red-muted)",   text: "var(--red)",    dot: "var(--red)",    label: "Failing" },
  pending: { bg: "var(--yellow-muted)", text: "var(--yellow)", dot: "var(--yellow)", label: "Pending" },
  missing: { bg: "var(--surface-3)",   text: "var(--text-tertiary)", dot: "var(--text-tertiary)", label: "No evals" },
};

function SkeletonCard() {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="skeleton h-5 w-36 mb-2" />
          <div className="skeleton h-3.5 w-48" />
        </div>
        <div className="skeleton h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}

export function SkillListPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSkills().then(setSkills).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  // Group by plugin
  const grouped = skills.reduce<Record<string, SkillInfo[]>>((acc, s) => {
    (acc[s.plugin] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="px-10 py-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Skills
        </h2>
        <p className="text-[13px] mt-1" style={{ color: "var(--text-tertiary)" }}>
          {loading ? "Scanning plugins..." : `${skills.length} skill${skills.length !== 1 ? "s" : ""} across ${Object.keys(grouped).length} plugin${Object.keys(grouped).length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg text-[13px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(248,113,113,0.2)" }}>
          {error}
        </div>
      )}

      {/* Skeleton loading */}
      {loading && (
        <div className="space-y-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      )}

      {/* Skill groups */}
      {!loading && (
        <div className="space-y-8 stagger-children">
          {Object.entries(grouped).map(([plugin, pluginSkills]) => (
            <div key={plugin}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                <h3 className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                  {plugin}
                </h3>
                <div className="flex-1 h-px" style={{ background: "var(--border-subtle)" }} />
              </div>

              <div className="grid gap-2">
                {pluginSkills.map((s) => {
                  const status = STATUS_CONFIG[s.benchmarkStatus] || STATUS_CONFIG.missing;
                  return (
                    <Link
                      key={`${s.plugin}/${s.skill}`}
                      to={`/skills/${s.plugin}/${s.skill}`}
                      className="glass-card glass-card-interactive p-5 flex items-center justify-between group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                            {s.skill}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                            {s.evalCount} eval{s.evalCount !== 1 ? "s" : ""}
                          </span>
                          <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                            {s.assertionCount} assertion{s.assertionCount !== 1 ? "s" : ""}
                          </span>
                          {s.lastBenchmark && (
                            <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                              {new Date(s.lastBenchmark).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          className="pill"
                          style={{ background: status.bg, color: status.text }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.dot }} />
                          {status.label}
                        </span>
                        <svg
                          width="16" height="16" viewBox="0 0 24 24" fill="none"
                          stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          className="opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                          style={{ transform: "translateX(0)", transition: "transform 0.15s ease" }}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && skills.length === 0 && !error && (
        <div className="text-center py-16 animate-fade-in-scale">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "var(--surface-2)" }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
          </div>
          <p className="text-[14px] font-medium" style={{ color: "var(--text-secondary)" }}>No skills found</p>
          <p className="text-[12px] mt-1" style={{ color: "var(--text-tertiary)" }}>
            Check your <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: "var(--surface-2)" }}>--root</code> directory
          </p>
        </div>
      )}
    </div>
  );
}
