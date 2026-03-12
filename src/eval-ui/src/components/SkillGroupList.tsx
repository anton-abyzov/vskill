import { useMemo, useState } from "react";
import { useStudio } from "../StudioContext";
import { SkillCard } from "./SkillCard";
import type { SkillInfo } from "../types";

type GroupedSkills = Record<string, SkillInfo[]>;

function groupByPlugin(skills: SkillInfo[]): GroupedSkills {
  const grouped: GroupedSkills = {};
  for (const s of skills) {
    (grouped[s.plugin] ||= []).push(s);
  }
  return grouped;
}

export function SkillGroupList() {
  const { state, selectSkill } = useStudio();
  const { skills, searchQuery, selectedSkill } = state;
  const [installedExpanded, setInstalledExpanded] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try { return sessionStorage.getItem("vskill-origin-banner-dismissed") === "1"; } catch { return false; }
  });

  const { sourceGroups, installedGroups } = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const filtered = query
      ? skills.filter((s) => s.skill.toLowerCase().includes(query) || s.plugin.toLowerCase().includes(query))
      : skills;

    const source = filtered.filter((s) => s.origin === "source");
    const installed = filtered.filter((s) => s.origin === "installed");

    return {
      sourceGroups: Object.entries(groupByPlugin(source)),
      installedGroups: Object.entries(groupByPlugin(installed)),
    };
  }, [skills, searchQuery]);

  if (state.skillsLoading) {
    return (
      <div className="px-3 py-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (sourceGroups.length === 0 && installedGroups.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          No skills match your search
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1">
      {/* Source skills — always expanded */}
      {sourceGroups.length > 0 && (
        <>
          <SectionHeader title="Your Skills" count={sourceGroups.reduce((n, [, s]) => n + s.length, 0)} />
          {sourceGroups.map(([plugin, pluginSkills]) => (
            <div key={plugin}>
              <PluginGroupHeader plugin={plugin} count={pluginSkills.length} />
              {pluginSkills.map((s) => {
                const isSelected = selectedSkill?.plugin === s.plugin && selectedSkill?.skill === s.skill;
                return (
                  <SkillCard
                    key={`${s.plugin}/${s.skill}`}
                    skill={s}
                    isSelected={isSelected}
                    onSelect={() => selectSkill({ plugin: s.plugin, skill: s.skill, origin: s.origin })}
                  />
                );
              })}
            </div>
          ))}
        </>
      )}

      {/* Installed skills — collapsed by default */}
      {installedGroups.length > 0 && (
        <>
          <button
            onClick={() => setInstalledExpanded((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
            style={{
              background: "var(--surface-1)",
              border: "none",
              borderTop: "1px solid var(--border-subtle)",
              borderBottom: installedExpanded ? "1px solid var(--border-subtle)" : "none",
              cursor: "pointer",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: installedExpanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 150ms ease",
              }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
              Installed
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              ({installedGroups.reduce((n, [, s]) => n + s.length, 0)})
            </span>
            <div className="flex-1" />
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </button>
          {installedExpanded && (
            <>
              {!bannerDismissed && (
                <div className="flex items-start gap-2 px-3 py-2" style={{ background: "var(--surface-1)", borderBottom: "1px solid var(--border-subtle)" }}>
                  <p className="flex-1 text-[10px] leading-relaxed" style={{ color: "var(--text-tertiary)", margin: 0 }}>
                    Skills inside agent folders (.claude/, .cursor/, etc.) are installed copies for consuming. Edit skills in your project root instead.
                  </p>
                  <button
                    onClick={() => {
                      setBannerDismissed(true);
                      try { sessionStorage.setItem("vskill-origin-banner-dismissed", "1"); } catch {}
                    }}
                    className="flex-shrink-0 mt-0.5"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-tertiary)" }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
              {installedGroups.map(([plugin, pluginSkills]) => (
                <div key={plugin}>
                  <PluginGroupHeader plugin={plugin} count={pluginSkills.length} />
                  {pluginSkills.map((s) => {
                    const isSelected = selectedSkill?.plugin === s.plugin && selectedSkill?.skill === s.skill;
                    return (
                      <SkillCard
                        key={`${s.plugin}/${s.skill}`}
                        skill={s}
                        isSelected={isSelected}
                        onSelect={() => selectSkill({ plugin: s.plugin, skill: s.skill, origin: s.origin })}
                      />
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2" style={{ background: "var(--surface-1)", borderBottom: "1px solid var(--border-subtle)" }}>
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
        {title}
      </span>
      <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        ({count})
      </span>
    </div>
  );
}

function PluginGroupHeader({ plugin, count }: { plugin: string; count: number }) {
  const [imgError, setImgError] = useState(false);
  const iconUrl = `/images/icons/${plugin}.webp`;

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {!imgError ? (
        <img
          src={iconUrl}
          width={16}
          height={16}
          alt=""
          onError={() => setImgError(true)}
          style={{ objectFit: "contain" }}
        />
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      )}
      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
        {plugin}
      </span>
      <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        ({count})
      </span>
      <div className="flex-1 h-px" style={{ background: "var(--border-subtle)" }} />
    </div>
  );
}
