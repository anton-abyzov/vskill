import { readSettingsSnapshot } from "../preferences/lib/useDesktopBridge";

/** Optional analytics must fail closed when consent cannot be read. */
export async function sendStudioTelemetry(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    const env = import.meta.env;
    if (env.VITE_VSKILL_DISABLE_TELEMETRY === "1" || env.VITE_VSKILL_DISABLE_TELEMETRY === "true") return;
    if (new URLSearchParams(window.location.search).get("disableTelemetry") === "1") return;
    if ((await readSettingsSnapshot()).privacy.telemetryEnabled !== true) return;
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
