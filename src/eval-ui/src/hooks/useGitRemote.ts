// ---------------------------------------------------------------------------
// 0759 — useGitRemote: one-shot probe of GET /api/git/remote on mount.
//
// Returns `{ hasRemote, remoteUrl, branch, loading }`. Failures (network or
// git error) are coerced to `hasRemote: false` so the Publish button stays
// hidden — this is intentional fail-silent behaviour for the MVP. The full
// 0742 build will surface no-remote state via an "attach repo" affordance.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { api } from "../api";

export interface GitRemoteState {
  hasRemote: boolean;
  remoteUrl: string | null;
  branch: string | null;
  loading: boolean;
  /** Non-null when the remote probe failed (network error, git error, etc.).
   *  The Publish button stays hidden on error (fail-silent MVP behaviour). */
  error: Error | null;
}

const INITIAL: GitRemoteState = {
  hasRemote: false,
  remoteUrl: null,
  branch: null,
  loading: true,
  error: null,
};

export function useGitRemote(): GitRemoteState {
  const [state, setState] = useState<GitRemoteState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    api
      .gitRemote()
      .then((res) => {
        if (cancelled) return;
        setState({
          hasRemote: Boolean(res.hasRemote),
          remoteUrl: res.remoteUrl ?? null,
          branch: res.branch ?? null,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          hasRemote: false,
          remoteUrl: null,
          branch: null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
