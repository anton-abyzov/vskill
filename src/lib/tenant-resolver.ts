// ---------------------------------------------------------------------------
// tenant-resolver.ts — 0839 ADR-002 priority-ordered resolution.
//
// Order:
//   1. Explicit --tenant flag (highest)
//   2. VSKILL_TENANT env var
//   3. ~/.vskill/config.json `currentTenant`
//   4. Auto-pick when the user has exactly N=1 tenant
//   5. Error — caller decides whether to surface a multi-tenant prompt
//
// `resolveTenant` is intentionally async: step (4) requires a network
// call to /api/v1/account/tenants. We short-circuit before that for the
// common-case (flag/env/config). The fetcher is dependency-injected so
// tests don't hit the network.
//
// The resolver does NOT mutate any state (no env writes, no config
// writes). Callers pass the result to subsequent API calls via
// `apiRequest({ tenantOverride })` or by calling the returned context.
// ---------------------------------------------------------------------------

import {
  getActiveTenant,
  type ActiveTenantOptions,
} from "./active-tenant.js";
import {
  listTenants as defaultListTenants,
  type TenantSummary,
} from "../api/client.js";

export interface ResolveTenantOptions {
  /** Highest priority — usually the CLI `--tenant` flag. */
  flag?: string | null;
  /** Override env reader (tests). Defaults to `process.env.VSKILL_TENANT`. */
  envValue?: string | null;
  /** Override config-dir resolution (tests). */
  activeTenantOptions?: ActiveTenantOptions;
  /** Override tenants fetcher (tests / offline mode). */
  listTenants?: () => Promise<TenantSummary[]>;
  /**
   * When true, the resolver may make a network call to /account/tenants for
   * the N=1 auto-pick fallback. Defaults to true. Setting false skips
   * step (4) — useful for offline-first commands where the caller would
   * rather error than block on the network.
   */
  enableAutoPick?: boolean;
}

export type ResolvedTenant =
  | {
      kind: "flag" | "env" | "config" | "auto-pick";
      slug: string;
    }
  | {
      kind: "none";
      /** Why no tenant was resolved (for caller-side messaging). */
      reason:
        | "anonymous"
        | "no-tenants"
        | "multiple-tenants-no-default"
        | "fetch-failed";
      /** Available tenants when reason === "multiple-tenants-no-default". */
      tenants?: TenantSummary[];
      /** Network error string when reason === "fetch-failed". */
      error?: string;
    };

export async function resolveTenant(
  opts: ResolveTenantOptions = {},
): Promise<ResolvedTenant> {
  // 1. Explicit flag.
  if (opts.flag && opts.flag.length > 0) {
    return { kind: "flag", slug: opts.flag };
  }

  // 2. Env var.
  const env =
    opts.envValue !== undefined ? opts.envValue : process.env.VSKILL_TENANT;
  if (env && env.length > 0) {
    return { kind: "env", slug: env };
  }

  // 3. Config file.
  const fromConfig = getActiveTenant(opts.activeTenantOptions);
  if (fromConfig) {
    return { kind: "config", slug: fromConfig };
  }

  // 4. Auto-pick when N=1 — only if the caller opted in.
  if (opts.enableAutoPick === false) {
    return { kind: "none", reason: "multiple-tenants-no-default" };
  }

  let tenants: TenantSummary[];
  try {
    tenants = await (opts.listTenants ?? defaultListTenants)();
  } catch (err) {
    const e = err as Error & { status?: number };
    // 401 → caller is anonymous — bubble that up so the CLI can hint
    // `vskill auth login` instead of "no tenants".
    if (e.status === 401) {
      return { kind: "none", reason: "anonymous" };
    }
    return {
      kind: "none",
      reason: "fetch-failed",
      error: e.message ?? String(err),
    };
  }

  if (tenants.length === 0) {
    return { kind: "none", reason: "no-tenants" };
  }
  if (tenants.length === 1) {
    return { kind: "auto-pick", slug: tenants[0].slug };
  }
  return {
    kind: "none",
    reason: "multiple-tenants-no-default",
    tenants,
  };
}

/**
 * Helper for callers that just want the slug (or null) without inspecting
 * the resolution kind. The caller is responsible for handling the null
 * case (typically by surfacing a clear error message).
 */
export async function resolveTenantSlug(
  opts: ResolveTenantOptions = {},
): Promise<string | null> {
  const r = await resolveTenant(opts);
  return r.kind === "none" ? null : r.slug;
}
