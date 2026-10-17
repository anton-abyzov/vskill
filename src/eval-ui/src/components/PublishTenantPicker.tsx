import type { PublishTenantSelection } from "../hooks/usePublishTenant";
import { openExternalUrlViaDesktop } from "../preferences/lib/useDesktopBridge";

export const CONNECT_GITHUB_APP_URL = "https://verified-skill.com/settings/integrations";
export const MISSING_PUBLISH_TENANT = "Select a publishing account. If none is available, connect the GitHub App to your account or organization first.";

export function PublishTenantPicker({ selection }: { selection?: PublishTenantSelection }) {
  return (
    <div data-testid="publish-tenant-picker" style={{ marginBottom: 16, fontSize: 12, lineHeight: 1.6 }}>
      <label htmlFor="publish-tenant" style={{ display: "block", fontWeight: 600 }}>Publishing account</label>
      {selection?.loading ? <p role="status">Loading publishing accounts…</p> : selection?.tenants.length ? (
        <select id="publish-tenant" aria-label="Publishing account" value={selection.tenantId ?? ""}
          onChange={(e) => { void selection.select(e.target.value); }}
          style={{ width: "100%", padding: "8px 10px", color: "#E2E8F0", background: "#101319", border: "1px solid #465060", borderRadius: 6, colorScheme: "dark" }}>
          <option value="" disabled>Select an account…</option>
          {selection.tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name}</option>)}
        </select>
      ) : <p>{MISSING_PUBLISH_TENANT}</p>}
      {selection?.error && <p role="alert">{selection.error}</p>}
      <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
        <button type="button" className="btn btn-ghost text-[11px]" style={{ color: "#93C5FD" }} onClick={() => { void openExternalUrlViaDesktop(CONNECT_GITHUB_APP_URL); }}>Connect GitHub App ↗</button>
        {selection && <button type="button" className="btn btn-ghost text-[11px]" style={{ color: "#CBD5E1" }} disabled={selection.loading} onClick={() => { void selection.refresh(); }}>Refresh accounts</button>}
      </div>
    </div>
  );
}
