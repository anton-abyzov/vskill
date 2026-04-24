// ---------------------------------------------------------------------------
// 0698 T-014: useWorkspace — fetch + mutate the multi-project registry.
//
// Consumes /api/workspace endpoints via the in-repo useSWR hook. When the
// active project changes, invalidates the "skills" cache key so the sidebar
// refetches against the new project root automatically.
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { useSWR, mutate } from "./useSWR";

export interface ProjectConfigRaw {
  id: string;
  name: string;
  path: string;
  colorDot: string;
  addedAt: string;
  lastActiveAt?: string;
}

export interface WorkspaceConfigRaw {
  version: 1;
  activeProjectId: string | null;
  projects: ProjectConfigRaw[];
}

const WORKSPACE_KEY = "workspace";
const SKILLS_CACHE_KEYS = ["skills", "agents"] as const;

// ---------------------------------------------------------------------------
// Pure fetch functions — exported so tests can exercise them without React.
// ---------------------------------------------------------------------------

export async function fetchWorkspaceApi(): Promise<WorkspaceConfigRaw> {
  const res = await fetch("/api/workspace");
  if (!res.ok) throw new Error(`GET /api/workspace failed: ${res.status}`);
  return (await res.json()) as WorkspaceConfigRaw;
}

export async function postActiveProjectApi(id: string | null): Promise<WorkspaceConfigRaw> {
  const res = await fetch("/api/workspace/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `POST /api/workspace/active failed: ${res.status}`);
  }
  return (await res.json()) as WorkspaceConfigRaw;
}

export async function postAddProjectApi(input: {
  path: string;
  name?: string;
}): Promise<WorkspaceConfigRaw> {
  const res = await fetch("/api/workspace/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `POST /api/workspace/projects failed: ${res.status}`);
  }
  return (await res.json()) as WorkspaceConfigRaw;
}

export async function deleteProjectApi(id: string): Promise<WorkspaceConfigRaw> {
  const res = await fetch(`/api/workspace/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `DELETE /api/workspace/projects/${id} failed: ${res.status}`);
  }
  return (await res.json()) as WorkspaceConfigRaw;
}

/** Invalidate skills + agents SWR caches so the sidebar refetches against the new project. */
export function invalidateWorkspaceDependents(): void {
  for (const key of SKILLS_CACHE_KEYS) {
    mutate(key);
  }
}

export interface UseWorkspaceResult {
  workspace: WorkspaceConfigRaw | undefined;
  activeProject: ProjectConfigRaw | undefined;
  loading: boolean;
  error: Error | undefined;
  /** Switch active project. Invalidates skills + agents caches so sidebar refetches. */
  switchProject: (id: string | null) => Promise<void>;
  /** Add a project by absolute path. */
  addProject: (input: { path: string; name?: string }) => Promise<void>;
  /** Remove a project by id. */
  removeProject: (id: string) => Promise<void>;
  /** Force re-fetch. */
  revalidate: () => void;
}

export function useWorkspace(): UseWorkspaceResult {
  const { data, loading, error, revalidate } = useSWR<WorkspaceConfigRaw>(
    WORKSPACE_KEY,
    fetchWorkspaceApi,
  );

  const workspace = data;
  const activeProject = workspace?.projects.find((p) => p.id === workspace.activeProjectId);

  const switchProject = useCallback(async (id: string | null) => {
    await postActiveProjectApi(id);
    mutate(WORKSPACE_KEY);
    invalidateWorkspaceDependents();
  }, []);

  const addProjectFn = useCallback(async (input: { path: string; name?: string }) => {
    await postAddProjectApi(input);
    mutate(WORKSPACE_KEY);
    invalidateWorkspaceDependents();
  }, []);

  const removeProjectFn = useCallback(async (id: string) => {
    await deleteProjectApi(id);
    mutate(WORKSPACE_KEY);
    invalidateWorkspaceDependents();
  }, []);

  return {
    workspace,
    activeProject,
    loading,
    error,
    switchProject,
    addProject: addProjectFn,
    removeProject: removeProjectFn,
    revalidate,
  };
}
