import { useState, useEffect } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { api } from "../../api";
import { McpDependencies } from "../../components/McpDependencies";
import type { DependenciesResponse } from "../../types";

export function DepsPanel() {
  const { state } = useWorkspace();
  const { plugin, skill } = state;
  const [deps, setDeps] = useState<DependenciesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDependencies(plugin, skill)
      .then(setDeps)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [plugin, skill]);

  if (loading) {
    return (
      <div className="p-5">
        <div className="skeleton h-5 w-32 mb-4" />
        <div className="skeleton h-32 rounded-xl" />
      </div>
    );
  }

  if (!deps) {
    return (
      <div className="flex items-center justify-center h-full text-[13px]" style={{ color: "var(--text-tertiary)" }}>
        No dependency information available
      </div>
    );
  }

  return (
    <div className="p-5 max-w-3xl">
      <McpDependencies plugin={plugin} skill={skill} />
    </div>
  );
}
