import { useState, useEffect, useRef } from "react";
import { useStudio } from "../StudioContext";

export function SkillSearch() {
  const { state, setSearch } = useStudio();
  const [inputValue, setInputValue] = useState(state.searchQuery);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSearch(inputValue);
    }, 200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [inputValue, setSearch]);

  // Sync external resets (e.g., clear search from empty state)
  useEffect(() => {
    if (state.searchQuery === "" && inputValue !== "") {
      setInputValue("");
    }
  }, [state.searchQuery]);

  const pluginCount = new Set(state.skills.map((s) => s.plugin)).size;

  return (
    <div className="px-3 py-2">
      <div className="relative">
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Search skills..."
          className="w-full py-2 pl-8 pr-3 rounded-lg text-[13px] transition-colors duration-150"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-subtle)",
            outline: "none",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
        />
        {inputValue && (
          <button
            onClick={() => { setInputValue(""); setSearch(""); }}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)",
              padding: 2,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      {!state.skillsLoading && (
        <div className="text-[11px] mt-1.5 px-1" style={{ color: "var(--text-tertiary)" }}>
          {state.skills.length} skill{state.skills.length !== 1 ? "s" : ""} across {pluginCount} plugin{pluginCount !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
