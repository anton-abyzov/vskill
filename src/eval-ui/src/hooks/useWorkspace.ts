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

/**
 * 0863: the switch response is a superset of WorkspaceConfigRaw — the server
 * re-roots in place and reports the new root + a fresh skill count.
 */
export interface SwitchActiveResult extends WorkspaceConfigRaw {
  ok?: boolean;
  root?: string;
  skillCount?: number;
}

/**
 * 0863: thrown when a switch fails (e.g. the target folder is missing/unreadable
 * → HTTP 409). Carries the `fallbackCommand` so the UI can show the legacy
 * "relaunch from a terminal" escape hatch as an ERROR fallback (not the default).
 */
export class SwitchProjectError extends Error {
  readonly status: number;
  readonly fallbackCommand?: string;
  constructor(message: string, status: number, fallbackCommand?: string) {
    super(message);
    this.name = "SwitchProjectError";
    this.status = status;
    this.fallbackCommand = fallbackCommand;
  }
}

export async function postActiveProjectApi(id: string | null): Promise<SwitchActiveResult> {
  const res = await fetch("/api/workspace/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      fallbackCommand?: string;
    };
    throw new SwitchProjectError(
      body.error ?? `POST /api/workspace/active failed: ${res.status}`,
      res.status,
      body.fallbackCommand,
    );
  }
  return (await res.json()) as SwitchActiveResult;
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

/**
 * Invalidate skills + agents SWR caches AND notify the StudioContext skill list
 * (which loads via its own `loadSkills`, not an SWR key) so the sidebar refetches
 * against the newly active project root. The `studio:project-changed` event is
 * the project-level analogue of `studio:agent-changed`.
 */
export function invalidateWorkspaceDependents(): void {
  for (const key of SKILLS_CACHE_KEYS) {
    mutate(key);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("studio:project-changed"));
  }
}

export interface UseWorkspaceResult {
  workspace: WorkspaceConfigRaw | undefined;
  activeProject: ProjectConfigRaw | undefined;
  loading: boolean;
  error: Error | undefined;
  /**
   * Switch active project. Re-roots the running server (POST /api/workspace/active),
   * then invalidates skills + agents caches so the sidebar refetches against the
   * new folder. Resolves with the server-reported skill count for the success toast.
   * Rejects with a {@link SwitchProjectError} (carrying `fallbackCommand`) on failure.
   */
  switchProject: (id: string | null) => Promise<{ skillCount?: number }>;
  /** Add a project by absolute path. Resolves with the new project's id so the caller can switch to it. */
  addProject: (input: { path: string; name?: string }) => Promise<{ id?: string }>;
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
    // POST resolves only after the server has applied the new root and counted
    // its skills, so by the time this awaits, the next refetch is guaranteed to
    // hit the new folder. The SWR invalidations below drive the skeleton reload.
    const result = await postActiveProjectApi(id);
    mutate(WORKSPACE_KEY);
    invalidateWorkspaceDependents();
    return { skillCount: result.skillCount };
  }, []);

  const addProjectFn = useCallback(async (input: { path: string; name?: string }) => {
    const next = await postAddProjectApi(input);
    mutate(WORKSPACE_KEY);
    invalidateWorkspaceDependents();
    // Surface the new project's id so callers (e.g. "Open folder…") can switch to it.
    const added = next.projects.find((p) => p.path === input.path);
    return { id: added?.id };
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
