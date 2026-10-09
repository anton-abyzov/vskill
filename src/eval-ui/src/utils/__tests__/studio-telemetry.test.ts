// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { sendStudioTelemetry } from "../studio-telemetry";
import { useDesktopBridge, type DesktopBridge } from "../../preferences/lib/useDesktopBridge";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const key = "vskill:preferences:browser-shadow";
const endpoint = "/api/v1/studio/telemetry/search-select";
const native = window as unknown as { __TAURI_INTERNALS__?: { invoke: ReturnType<typeof vi.fn> } };
const consent = (enabled: boolean) => localStorage.setItem(key, JSON.stringify({ privacy: { telemetryEnabled: enabled } }));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  vi.stubEnv("VITE_VSKILL_DISABLE_TELEMETRY", "0");
  delete native.__TAURI_INTERNALS__;
});
afterEach(() => {
  delete native.__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("optional Studio telemetry", () => {
  it("sends nothing by default or with malformed persisted preferences", async () => {
    await sendStudioTelemetry(endpoint, { skillName: "owner/repo/skill" });
    localStorage.setItem(key, "{");
    await sendStudioTelemetry(endpoint, { skillName: "owner/repo/skill" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("honors opt-in, strips search text and rereads opt-out before the next send", async () => {
    consent(true);
    await sendStudioTelemetry(endpoint, { skillName: "owner/repo/skill", q: "private customer secret", ts: 10 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ skillName: "owner/repo/skill", ts: 10 });
    consent(false);
    await sendStudioTelemetry(endpoint, { event: "connected" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("honors the disable URL switch even with consent", async () => {
    consent(true);
    window.history.replaceState(null, "", "/?disableTelemetry=1");
    await sendStudioTelemetry(endpoint, { event: "connected" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("honors the build disable switch even with consent", async () => {
    consent(true);
    vi.stubEnv("VITE_VSKILL_DISABLE_TELEMETRY", "1");
    await sendStudioTelemetry(endpoint, { event: "connected" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses native consent over stale browser preferences and fails closed on IPC failure", async () => {
    consent(true);
    const invoke = vi.fn().mockResolvedValue({ privacy: { telemetry_enabled: false } });
    native.__TAURI_INTERNALS__ = { invoke };
    await sendStudioTelemetry(endpoint, { event: "connected" });
    invoke.mockRejectedValueOnce(new Error("IPC unavailable"));
    await sendStudioTelemetry(endpoint, { event: "connected" });
    expect(fetch).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({ privacy: { telemetry_enabled: true } });
    await sendStudioTelemetry(endpoint, { event: "connected" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_settings", undefined);
  });
  it("does not interrupt actions when the optional network request fails", async () => {
    consent(true);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await expect(sendStudioTelemetry(endpoint, { event: "connected" })).resolves.toBeUndefined();
  });
  it("gates the native count-report command on current consent", async () => {
    let enabled = false;
    const invoke = vi.fn(async (cmd: string) => cmd === "get_settings" ? { privacy: { telemetry_enabled: enabled } } : undefined);
    native.__TAURI_INTERNALS__ = { invoke };
    let bridge!: DesktopBridge;
    function Harness() { bridge = useDesktopBridge(); return null; }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Harness)));
    try {
      await bridge.quotaReportCount(3);
      expect(invoke.mock.calls.some(([cmd]) => cmd === "quota_report_count")).toBe(false);
      enabled = true;
      await bridge.quotaReportCount(3);
      expect(invoke).toHaveBeenCalledWith("quota_report_count", { skillCount: 3 });
      invoke.mockClear();
      window.history.replaceState(null, "", "/?disableTelemetry=1");
      await bridge.quotaReportCount(3);
      expect(invoke).not.toHaveBeenCalled();
      window.history.replaceState(null, "", "/");
      vi.stubEnv("VITE_VSKILL_DISABLE_TELEMETRY", "1");
      await bridge.quotaReportCount(3);
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
