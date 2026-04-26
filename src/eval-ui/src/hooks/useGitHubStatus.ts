// ---------------------------------------------------------------------------
// 0772 US-005 / US-006 — useGitHubStatus.
//
// Shared SWR-cached read of GET /api/project/github-status. Used by both:
//   - PublishStatusRow on the Skill Overview tab
//   - The sidebar AVAILABLE > Project section header indicator
//
// One fetch hydrates both surfaces (cache key "project-github-status"). 30 s
// TTL is fine — this state changes only when the user runs `git remote add`.
// ---------------------------------------------------------------------------

import { useSWR } from "./useSWR";
import { api } from "../api";

export interface ProjectGitHubStatus {
  hasGit: boolean;
  githubOrigin: string | null;
  status: "no-git" | "non-github" | "github";
}

export function useGitHubStatus(): {
  status: ProjectGitHubStatus | undefined;
  loading: boolean;
  error: Error | undefined;
  revalidate: () => void;
} {
  const { data, loading, error, revalidate } = useSWR<ProjectGitHubStatus>(
    "project-github-status",
    () => api.getProjectGitHubStatus(),
  );
  return { status: data, loading, error, revalidate };
}
