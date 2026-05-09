// 0834 T-026 — useAccount: data-fetching layer for the /account cabinet.
//
// Thin SWR-style wrapper around the platform's /api/v1/account/* endpoints.
// All shared account components ingest data via this hook + its sibling
// mutations; both desktop (Tauri WebView) and web (Next.js) call it
// identically. The fetch URL prefix + auth header come from
// AccountContext, so the same hook code adapts to both surfaces.
//
// The cache layer is the existing `useSWR` helper (eval-ui already
// depends on it everywhere). Mutations call `mutate(...)` to invalidate
// affected entries (e.g. resync invalidates the repos list).

import { useCallback } from "react";
import { useSWR, mutate } from "./useSWR";
import {
  buildAccountUrl,
  useAccountContext,
  type AccountContextValue,
} from "../contexts/AccountContext";
import type {
  AccountExportDTO,
  ConnectedRepoDTO,
  ConnectedReposListDTO,
  NotificationPrefsDTO,
  ProfileDTO,
  ProfilePatchDTO,
  SkillsSummaryDTO,
  TokenCreateRequestDTO,
  TokenCreateResponseDTO,
  TokenDTO,
} from "../types/account";

const DEFAULT_TTL_MS = 60_000; // matches platform KV TTL (60s)

const KEY = {
  profile: () => "account:profile",
  repos: () => "account:repos",
  tokens: () => "account:tokens",
  skills: () => "account:skills",
  notifications: () => "account:notifications",
  exports: () => "account:exports",
} as const;

async function request<T>(
  ctx: AccountContextValue,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const fetchImpl = ctx.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const headers = new Headers(init.headers ?? {});
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (ctx.authMode === "bearer") {
    const auth = await ctx.getAuthHeader();
    if (auth) headers.set("Authorization", auth);
  }

  const credentials: RequestCredentials =
    ctx.authMode === "cookie" ? "include" : "omit";

  const res = await fetchImpl(buildAccountUrl(ctx, path), {
    ...init,
    headers,
    credentials,
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore — error body is best-effort
    }
    const err = new Error(
      `Request to ${path} failed (${res.status}): ${detail.slice(0, 240)}`,
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  // 204 No Content — return undefined; callers that expect no body
  // explicitly type T as `void`.
  if (res.status === 204) {
    return undefined as unknown as T;
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export function useAccountProfile() {
  const ctx = useAccountContext();
  const result = useSWR<ProfileDTO>(
    KEY.profile(),
    () => request<ProfileDTO>(ctx, "/api/v1/account/profile"),
    { ttl: DEFAULT_TTL_MS },
  );
  return result;
}

export function useUpdateProfile() {
  const ctx = useAccountContext();
  return useCallback(
    async (patch: ProfilePatchDTO) => {
      const next = await request<ProfileDTO>(ctx, "/api/v1/account/profile", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      mutate(KEY.profile());
      return next;
    },
    [ctx],
  );
}

// ---------------------------------------------------------------------------
// Connected repos
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/account/repos returns the wrapped {repos, totalCount, ...}
 * shape per ConnectedReposListDTO. The hook returns the full envelope
 * so consumers can read the precomputed totals; a thin adapter at the
 * top of `ReposTab` flattens to the array `ConnectedReposTable` wants.
 */
export function useConnectedRepos() {
  const ctx = useAccountContext();
  return useSWR<ConnectedReposListDTO>(
    KEY.repos(),
    () => request<ConnectedReposListDTO>(ctx, "/api/v1/account/repos"),
    { ttl: DEFAULT_TTL_MS },
  );
}

/** Convenience: extract the array, defaulting to empty when no data. */
export function reposArray(
  list: ConnectedReposListDTO | undefined,
): ReadonlyArray<ConnectedRepoDTO> {
  return list?.repos ?? [];
}

export function useResyncRepo() {
  const ctx = useAccountContext();
  return useCallback(
    async (repoId: string) => {
      await request<void>(ctx, `/api/v1/account/repos/${repoId}/resync`, {
        method: "POST",
      });
      mutate(KEY.repos());
    },
    [ctx],
  );
}

export function useDisconnectRepo() {
  const ctx = useAccountContext();
  return useCallback(
    async (repoId: string) => {
      await request<void>(ctx, `/api/v1/account/repos/${repoId}`, {
        method: "DELETE",
      });
      mutate(KEY.repos());
    },
    [ctx],
  );
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export function useApiTokens() {
  const ctx = useAccountContext();
  return useSWR<ReadonlyArray<TokenDTO>>(
    KEY.tokens(),
    () => request<ReadonlyArray<TokenDTO>>(ctx, "/api/v1/account/tokens"),
    { ttl: DEFAULT_TTL_MS },
  );
}

export function useCreateToken() {
  const ctx = useAccountContext();
  return useCallback(
    async (input: TokenCreateRequestDTO) => {
      const result = await request<TokenCreateResponseDTO>(
        ctx,
        "/api/v1/account/tokens",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      mutate(KEY.tokens());
      return result;
    },
    [ctx],
  );
}

export function useRevokeToken() {
  const ctx = useAccountContext();
  return useCallback(
    async (tokenId: string) => {
      await request<void>(ctx, `/api/v1/account/tokens/${tokenId}`, {
        method: "DELETE",
      });
      mutate(KEY.tokens());
    },
    [ctx],
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function useNotificationPrefs() {
  const ctx = useAccountContext();
  return useSWR<NotificationPrefsDTO>(
    KEY.notifications(),
    () => request<NotificationPrefsDTO>(ctx, "/api/v1/account/notifications"),
    { ttl: DEFAULT_TTL_MS },
  );
}

export function useUpdateNotificationPrefs() {
  const ctx = useAccountContext();
  return useCallback(
    async (next: NotificationPrefsDTO) => {
      const updated = await request<NotificationPrefsDTO>(
        ctx,
        "/api/v1/account/notifications",
        {
          method: "PATCH",
          body: JSON.stringify(next),
        },
      );
      mutate(KEY.notifications());
      return updated;
    },
    [ctx],
  );
}

// ---------------------------------------------------------------------------
// Skills summary
// ---------------------------------------------------------------------------

export function useSkillsSummary() {
  const ctx = useAccountContext();
  return useSWR<SkillsSummaryDTO>(
    KEY.skills(),
    () => request<SkillsSummaryDTO>(ctx, "/api/v1/account/skills/summary"),
    { ttl: DEFAULT_TTL_MS },
  );
}

// ---------------------------------------------------------------------------
// Exports + danger-zone actions
// ---------------------------------------------------------------------------

export function useAccountExports() {
  const ctx = useAccountContext();
  return useSWR<ReadonlyArray<AccountExportDTO>>(
    KEY.exports(),
    () =>
      request<ReadonlyArray<AccountExportDTO>>(ctx, "/api/v1/account/exports"),
    { ttl: DEFAULT_TTL_MS },
  );
}

export function useSignOutAll() {
  const ctx = useAccountContext();
  return useCallback(async () => {
    await request<void>(ctx, "/api/v1/account/sign-out-all", {
      method: "POST",
    });
    // After sign-out-all every cached entry is stale auth-wise.
    mutate(KEY.profile());
    mutate(KEY.repos());
    mutate(KEY.tokens());
    mutate(KEY.notifications());
    mutate(KEY.skills());
    mutate(KEY.exports());
  }, [ctx]);
}

export function useRequestExport() {
  const ctx = useAccountContext();
  return useCallback(async () => {
    const job = await request<AccountExportDTO>(ctx, "/api/v1/account/export", {
      method: "POST",
    });
    mutate(KEY.exports());
    return job;
  }, [ctx]);
}

export function useDeleteAccount() {
  const ctx = useAccountContext();
  return useCallback(async () => {
    await request<void>(ctx, "/api/v1/account/delete", { method: "POST" });
  }, [ctx]);
}

// ---------------------------------------------------------------------------
// Aggregate facade — convenience for hosts that want everything in one shot
// ---------------------------------------------------------------------------

export function useAccount() {
  return {
    profile: useAccountProfile(),
    repos: useConnectedRepos(),
    tokens: useApiTokens(),
    skills: useSkillsSummary(),
    notifications: useNotificationPrefs(),
    exports: useAccountExports(),
    updateProfile: useUpdateProfile(),
    resyncRepo: useResyncRepo(),
    disconnectRepo: useDisconnectRepo(),
    createToken: useCreateToken(),
    revokeToken: useRevokeToken(),
    updateNotificationPrefs: useUpdateNotificationPrefs(),
    signOutAll: useSignOutAll(),
    requestExport: useRequestExport(),
    deleteAccount: useDeleteAccount(),
  };
}

// Re-export the cache primitives so hosts can invalidate from elsewhere
// (e.g. Tauri auth event listener wiping the profile cache on sign-out).
export { mutate, KEY as ACCOUNT_CACHE_KEYS };
