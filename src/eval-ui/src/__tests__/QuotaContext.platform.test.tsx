// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuotaProvider, useQuota } from "../contexts/QuotaContext";
import { useTier } from "../hooks/useTier";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const bridge = vi.hoisted(() => ({
  quotaGet: vi.fn(), quotaCanCreateSkill: vi.fn(), quotaForceSync: vi.fn(),
}));
vi.mock("../preferences/lib/useDesktopBridge", () => ({ useDesktopBridge: () => bridge }));
let root: Root;
let host: HTMLDivElement;
let quota: ReturnType<typeof useQuota>;
let tier: ReturnType<typeof useTier>;
function Probe() { quota = useQuota(); tier = useTier(); return <span>{tier.tier}</span>; }
const payload = { tier: "pro", skillCount: 2, skillLimit: null, gracePeriodDaysRemaining: 7, serverNow: "2026-10-13T05:00:00.000Z", lastSyncedAt: "2026-10-13T05:00:00.000Z" };
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock);
  bridge.quotaGet.mockResolvedValue({ cache: null, isFresh: false, daysRemaining: 0, localSkillCount: 0 });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { root.render(<QuotaProvider><Probe /></QuotaProvider>); }); }

describe("0896 browser and desktop live entitlements", () => {
  it("live Pro overrides a stale signed-out native snapshot without exposing credentials", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    await mount(); expect(tier.isPro).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/billing/quota", { cache: "no-store" });
    expect(bridge.quotaForceSync).not.toHaveBeenCalled();
  });
  it("a fresh sync reads current platform entitlement rather than native auth", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    await mount();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...payload, tier: "free" }), { status: 200 }));
    await act(async () => { await quota.forceSync(true); });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/billing/quota?fresh=1", { cache: "no-store" });
    expect(tier.isPro).toBe(false);
  });
  it("401 clears a previous paid identity rather than restoring its cached tier", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    await mount(); expect(tier.isPro).toBe(true);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await act(async () => { await quota.forceSync(true); });
    expect(tier.isPro).toBe(false);
    expect(bridge.quotaGet).not.toHaveBeenCalled();
  });
});
