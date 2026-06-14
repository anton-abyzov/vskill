// 0874 Workstream D — PRICING_URL env override.
//
// PRICING_URL must default to the production pricing page but honor a
// Vite build/runtime override (VITE_PRICING_URL) so the demo can point
// upgrade CTAs at a local Stripe checkout. Single source of truth: every
// CTA (PaywallModal, chooser CTA, AccountShell) imports this constant.
//
// PRICING_URL is evaluated at module-load time, so each case stubs the
// env BEFORE a fresh dynamic import (vi.resetModules + import()).

import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("PRICING_URL — env override (0874)", () => {
  it("falls back to the production pricing page when VITE_PRICING_URL is unset", async () => {
    vi.stubEnv("VITE_PRICING_URL", "");
    vi.resetModules();
    const { PRICING_URL } = await import("../useTier");
    expect(PRICING_URL).toBe("https://verified-skill.com/pricing");
  });

  it("uses VITE_PRICING_URL when set", async () => {
    vi.stubEnv("VITE_PRICING_URL", "http://localhost:3000/pricing");
    vi.resetModules();
    const { PRICING_URL } = await import("../useTier");
    expect(PRICING_URL).toBe("http://localhost:3000/pricing");
  });
});
