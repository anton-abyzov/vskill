// 0839 T-012 — Studio tenant switcher.
//
// Replaces the single-org block inside <ConnectGitHubCard /> when the
// signed-in user belongs to one or more tenants. Three render modes:
//
//   • N = 0  → renders `children` (the existing "Connect GitHub" CTA from
//              ConnectGitHubCard) so the onboarding flow is preserved
//              verbatim (AC-US4-04).
//   • N = 1  → renders a static label `Tenant: <name>` with no dropdown
//              (nothing to pick, AC-US4-05).
//   • N ≥ 2  → renders a `<select>` dropdown. Selecting a row POSTs to the
//              eval-server `/__internal/active-tenant` endpoint, which
//              writes `currentTenant` to `~/.vskill/config.json` — the same
//              file the CLI consults, keeping CLI + Studio in lockstep
//              (AC-US4-01, AC-US4-03).
//
// Fetch lifecycle (AC-US4-02):
//   • On mount, calls `api.getAccountTenants()` + `api.getActiveTenant()`
//     in parallel. The result is cached for the lifetime of the component
//     instance — refresh occurs on focus (window 'focus' event) so a fresh
//     org membership shows up without a manual reload.
//   • Failures of `getAccountTenants` are surfaced as the "no tenants"
//     state (children rendered). Anonymous users get 401 from the platform
//     proxy and end up here naturally — the children block shows the
//     "Connect GitHub" CTA, matching the 0834 onboarding flow.
//
// Coordination notes:
//   • The CLI agent (T-011) owns the eval-server `/__internal/active-tenant`
//     handler. This component assumes its existence and contract:
//       GET  → { currentTenant: string | null }
//       POST { currentTenant: string|null } → { currentTenant: string|null }
//   • The CLI agent (T-005) wires the `X-Vskill-Tenant` header into
//     `client.ts`. This component triggers a re-render via the
//     `onTenantChange` callback after a successful POST so subsequent
//     requests issued by parent components inherit the new active tenant.
//
// Testability: the props `initialTenants` / `initialActiveSlug` /
// `fetchImpl` are escape hatches for unit tests. In production, the
// caller passes none of them and the component fetches itself.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, type TenantSummary } from "../../api";

export interface TenantPickerProps {
  /**
   * Children rendered when the user has zero tenants. Typically the
   * existing "Connect GitHub" CTA from `<ConnectGitHubCard />` — kept as
   * a slot rather than baked-in so the empty-state design can evolve
   * without touching this file.
   */
  children?: ReactNode;
  /**
   * Called after a successful POST to `/__internal/active-tenant`. The
   * parent uses this to invalidate caches that depend on the active
   * tenant (e.g. the skills list keyed by `X-Vskill-Tenant`).
   */
  onTenantChange?: (slug: string) => void;
  /**
   * Pre-seeded tenants list. When provided, the component does NOT call
   * `api.getAccountTenants()` on mount — useful for SSR + tests.
   */
  initialTenants?: TenantSummary[];
  /**
   * Pre-seeded active tenant slug. Same caveat as `initialTenants`.
   */
  initialActiveSlug?: string | null;
  /**
   * Optional override for the API surface. Tests inject a mock to assert
   * which endpoints are called. Defaults to the real `api` helpers.
   */
  apiImpl?: Pick<typeof api, "getAccountTenants" | "getActiveTenant" | "setActiveTenant">;
}

interface FetchState {
  loading: boolean;
  error: string | null;
  tenants: TenantSummary[];
  activeSlug: string | null;
}

const INITIAL_STATE: FetchState = {
  loading: true,
  error: null,
  tenants: [],
  activeSlug: null,
};

/**
 * 0839 F-005 — minimum interval between focus-triggered refetches.
 * 1000 ms balances "show fresh org membership when the user returns to
 * the tab" against "don't hammer /api/v1/account/tenants on a focus
 * storm". Lower than ADR-003's 5-minute platform TTL (no risk of
 * out-of-date UI vs. server) but high enough to absorb double-focus
 * events some window managers emit for a single activation.
 */
const FOCUS_REFETCH_DEBOUNCE_MS = 1000;

export function TenantPicker({
  children,
  onTenantChange,
  initialTenants,
  initialActiveSlug,
  apiImpl,
}: TenantPickerProps) {
  const apiHandle = apiImpl ?? api;
  const seeded = initialTenants !== undefined;

  const [state, setState] = useState<FetchState>(() =>
    seeded
      ? {
          loading: false,
          error: null,
          tenants: initialTenants ?? [],
          activeSlug: initialActiveSlug ?? null,
        }
      : INITIAL_STATE,
  );
  const [switching, setSwitching] = useState<string | null>(null);
  // 0839 F-005 — debounce window-focus storms. Tab-switch repeatedly (or
  // a window manager that emits multiple focus events for a single
  // activation) used to fire two parallel fetches per event; the platform
  // endpoint has Cache-Control: private,no-store so no edge cache absorbs
  // it. We track the last fetch start time and skip refetches within
  // FOCUS_REFETCH_DEBOUNCE_MS. The membership data is documented in
  // ADR-003 as "changes rarely" (5min TTL on the platform side), so a
  // 1-second floor is conservative.
  const lastFetchAtRef = useRef<number>(0);

  // Fetch tenant list + active slug on mount (and on window focus, so
  // a fresh installation done in another tab/window shows up without a
  // manual reload). When `initialTenants` is provided, we skip the
  // initial fetch — tests + SSR rely on this escape hatch.
  const refresh = useCallback(async () => {
    lastFetchAtRef.current = Date.now();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [list, active] = await Promise.all([
        apiHandle.getAccountTenants(),
        apiHandle.getActiveTenant().catch(() => ({ currentTenant: null as string | null })),
      ]);
      setState({
        loading: false,
        error: null,
        tenants: list.tenants,
        activeSlug: active.currentTenant,
      });
    } catch (err) {
      // 401 / network failure — fall through to the empty-state branch
      // (children render). We still record the message for diagnostics.
      setState({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        tenants: [],
        activeSlug: null,
      });
    }
  }, [apiHandle]);

  useEffect(() => {
    if (seeded) return;
    void refresh();
  }, [seeded, refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onFocus() {
      // 0839 F-005 — drop redundant refetches inside the debounce window.
      // We compare against the *start* of the most recent refresh, not
      // its completion: that's intentionally aggressive — an in-flight
      // fetch already covers what a fresh focus would request.
      if (Date.now() - lastFetchAtRef.current < FOCUS_REFETCH_DEBOUNCE_MS) {
        return;
      }
      void refresh();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const handleSelect = useCallback(
    async (slug: string) => {
      if (slug === state.activeSlug) return;
      setSwitching(slug);
      try {
        const result = await apiHandle.setActiveTenant(slug);
        setState((s) => ({ ...s, activeSlug: result.currentTenant }));
        if (result.currentTenant) onTenantChange?.(result.currentTenant);
      } catch {
        // Selection failed — revert nothing (active stays where it was).
        // The user can retry; the eval-server is loopback, so failures
        // are exotic.
      } finally {
        setSwitching(null);
      }
    },
    [apiHandle, onTenantChange, state.activeSlug],
  );

  // Loading shimmer — keep it tiny so the layout doesn't shift when the
  // real picker resolves a tick later.
  if (state.loading) {
    return (
      <div data-tenant-picker="loading" style={loadingStyle} aria-busy="true">
        Loading tenants…
      </div>
    );
  }

  // N = 0 → render children (typically <ConnectGitHubCard /> empty state)
  if (state.tenants.length === 0) {
    return <>{children}</>;
  }

  // N = 1 → static label, no dropdown
  if (state.tenants.length === 1) {
    const tenant = state.tenants[0]!;
    return (
      <div data-tenant-picker="single" data-tenant-slug={tenant.slug} style={chipStyle}>
        <span style={chipLabelStyle}>Tenant:</span>{" "}
        <strong style={chipNameStyle}>{tenant.name}</strong>
      </div>
    );
  }

  // N ≥ 2 → dropdown
  return (
    <div data-tenant-picker="dropdown" style={chipStyle}>
      <label style={chipLabelStyle} htmlFor="tenant-picker-select">
        Tenant:
      </label>{" "}
      <select
        id="tenant-picker-select"
        value={state.activeSlug ?? ""}
        onChange={(e) => void handleSelect(e.target.value)}
        disabled={switching !== null}
        aria-label="Active tenant"
        style={selectStyle}
        data-tenant-picker-select
      >
        {state.activeSlug === null && (
          <option value="" disabled>
            Select a tenant…
          </option>
        )}
        {state.tenants.map((t) => (
          <option key={t.slug} value={t.slug} data-tenant-slug={t.slug}>
            {t.name}
          </option>
        ))}
      </select>
      {switching && (
        <span data-tenant-picker-status="switching" style={switchingStyle}>
          Switching…
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — kept inline for parity with the surrounding /private cards
// (ConnectGitHubCard.tsx, PrivateOrgSection.tsx). Theme tokens from
// the surrounding sidebar carry through naturally.
// ---------------------------------------------------------------------------

const loadingStyle: CSSProperties = {
  margin: "10px 14px",
  padding: "10px 14px",
  fontSize: "0.75rem",
  color: "#92400E",
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontStyle: "italic",
};

const chipStyle: CSSProperties = {
  margin: "10px 14px",
  padding: "10px 14px",
  border: "1px solid #FCD34D",
  borderRadius: "8px",
  backgroundColor: "rgba(252, 211, 77, 0.18)",
  color: "#78350F",
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: "0.8125rem",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
};

const chipLabelStyle: CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#92400E",
};

const chipNameStyle: CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "#78350F",
};

const selectStyle: CSSProperties = {
  flex: 1,
  minWidth: 120,
  padding: "4px 6px",
  fontSize: "0.8125rem",
  borderRadius: "5px",
  border: "1px solid #B45309",
  backgroundColor: "#FFFBEB",
  color: "#78350F",
  fontFamily: "inherit",
};

const switchingStyle: CSSProperties = {
  fontSize: "0.6875rem",
  color: "#92400E",
  fontStyle: "italic",
};

export default TenantPicker;
