import { useCallback, useEffect, useState } from "react";
import { api, type TenantSummary } from "../api";
import { HOSTED_PRIVATE_PUBLISHING_AVAILABLE } from "../hosted-publishing";

export const TENANT_CHANGED_EVENT = "studio:tenant-changed";
export interface PublishTenantSelection {
  tenantId?: string;
  tenants: TenantSummary[];
  loading: boolean;
  error: string | null;
  select: (tenantId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/** Resolve the same persisted tenant selection used by the sidebar and CLI.
 * Never invent a tenant from the repo owner or pick among multiple accounts. */
export function usePublishTenant(): PublishTenantSelection {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [tenantId, setTenantId] = useState<string>();
  const [loading, setLoading] = useState(HOSTED_PRIVATE_PUBLISHING_AVAILABLE);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!HOSTED_PRIVATE_PUBLISHING_AVAILABLE) return;
    setLoading(true);
    try {
      const [list, active] = await Promise.all([
        api.getAccountTenants(),
        api.getActiveTenant().catch(() => ({ currentTenant: null })),
      ]);
      const available = list.tenants.filter((t) => t.tenantId && t.installationId);
      const selected = available.find((t) => t.slug === active.currentTenant)
        ?? (available.length === 1 ? available[0] : undefined);
      setTenants(available);
      setTenantId(selected?.tenantId);
      setError(null);
    } catch {
      setTenants([]);
      setTenantId(undefined);
      setError("Could not load publishing accounts. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  const select = useCallback(async (id: string) => {
    const selected = tenants.find((t) => t.tenantId === id);
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.setActiveTenant(selected.slug);
      if (result.currentTenant !== selected.slug) throw new Error("Tenant selection was not saved");
      setTenantId(selected.tenantId);
      window.dispatchEvent(new Event(TENANT_CHANGED_EVENT));
    } catch {
      setError("Could not select this publishing account. Retry before publishing.");
    } finally {
      setLoading(false);
    }
  }, [tenants]);

  useEffect(() => {
    if (!HOSTED_PRIVATE_PUBLISHING_AVAILABLE) return;
    void refresh();
    const onRefresh = () => { void refresh(); };
    window.addEventListener("focus", onRefresh);
    window.addEventListener(TENANT_CHANGED_EVENT, onRefresh);
    return () => {
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener(TENANT_CHANGED_EVENT, onRefresh);
    };
  }, [refresh]);

  return { tenantId, tenants, loading, error, select, refresh };
}
