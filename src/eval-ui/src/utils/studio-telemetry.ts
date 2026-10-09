import { hasTelemetryConsent } from "../preferences/lib/useDesktopBridge";

/** Optional analytics must fail closed when consent cannot be read. */
export async function sendStudioTelemetry(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    if (!(await hasTelemetryConsent())) return;
    // Queries can contain private repository names, customer data or secrets.
    // They are never needed to count selections/copies, even after consent.
    const { q: _query, ...safePayload } = payload;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(safePayload),
      keepalive: true,
    });
  } catch {
    // Consent/storage/network failures never block the user's action.
  }
}
