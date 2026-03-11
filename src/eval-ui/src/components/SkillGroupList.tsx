import { useMemo, useState } from "react";
import { useStudio } from "../StudioContext";
import { SkillCard } from "./SkillCard";

export function SkillGroupList() {
  const { state, selectSkill } = useStudio();
  const { skills, searchQuery, selectedSkill } = state;

  const filteredGrouped = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const filtered = query
      ? skills.filter((s) => s.skill.toLowerCase().includes(query) || s.plugin.toLowerCase().includes(query))
      : skills;

    const grouped: Record<string, typeof filtered> = {};
    for (const s of filtered) {
      (grouped[s.plugin] ||= []).push(s);
    }
    return grouped;
  }, [skills, searchQuery]);

  const entries = Object.entries(filteredGrouped);

  if (state.skillsLoading) {
    return (
      <div className="px-3 py-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
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
      {entries.map(([plugin, pluginSkills]) => (
        <div key={plugin}>
          {/* Group header */}
          <PluginGroupHeader plugin={plugin} count={pluginSkills.length} />

          {/* Cards */}
          {pluginSkills.map((s) => {
            const isSelected = selectedSkill?.plugin === s.plugin && selectedSkill?.skill === s.skill;
            return (
              <SkillCard
                key={`${s.plugin}/${s.skill}`}
                skill={s}
                isSelected={isSelected}
                onSelect={() => selectSkill({ plugin: s.plugin, skill: s.skill })}
              />
            );
          })}
        </div>
      ))}
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
