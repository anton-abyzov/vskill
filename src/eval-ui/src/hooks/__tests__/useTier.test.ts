// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0833 — useTier hook tests.
//
// Covers AC-US1-02 (null skillLimit → isUnlimited:true) and AC-US4-03
// (existing 0831 hook tests now expect the unlimited-default shape).
//
// We stub `useQuota()` so the hook resolves without a real QuotaProvider.
// The mock returns a controllable `snapshot`; each test mutates the
// reference before mounting the probe component.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import type { Root } from "react-dom/client";

// Suppress React act() environment warning in jsdom.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// `useQuota` mock — vi.hoisted so the factory runs before the hook import.
// Tests mutate the captured snapshot via `setSnapshot()`.
// ---------------------------------------------------------------------------

const quotaState = vi.hoisted(() => ({
  current: null as null | {
    cache: null | {
      response: {
        tier: "free" | "pro" | "enterprise";
        skillCount: number;
        skillLimit: number | null;
      };
    };
    daysRemaining: number;
    isFresh: boolean;
    localSkillCount: number;
  },
}));

vi.mock("../../contexts/QuotaContext", () => ({
  useQuota: () => ({
    snapshot: quotaState.current,
    refreshing: false,
    error: null,
    forceSync: async () => {},
    canCreateSkill: async () => ({
      blocked: false,
      reason: "ok",
      snapshot: quotaState.current,
    }),
  }),
}));

import { useTier, type UseTierResult } from "../useTier";

// ---------------------------------------------------------------------------
// Minimal render harness — mirrors useGitRemote.test.ts; avoids a
// @testing-library/react dependency.
// ---------------------------------------------------------------------------

interface Harness {
  state: () => UseTierResult;
  unmount: () => void;
}

async function mount(): Promise<Harness> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");

  let captured: UseTierResult | null = null;
  function Probe(): null {
    captured = useTier();
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Probe));
  });
  return {
    state: () => captured!,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  quotaState.current = null;
});

describe("useTier — 0833 pivot", () => {
  it("AC-US1-02: free tier with skillLimit:null reports isUnlimited:true and no cap badge state", async () => {
    quotaState.current = {
      cache: {
        response: { tier: "free", skillCount: 73, skillLimit: null },
      },
      daysRemaining: 7,
      isFresh: true,
      localSkillCount: 73,
    };

    const h = await mount();
    const s = h.state();
    expect(s.tier).toBe("free");
    expect(s.isFree).toBe(true);
    expect(s.isPro).toBe(false);
    expect(s.skillLimit).toBeNull();
    expect(s.isUnlimited).toBe(true);
    expect(s.skillCount).toBe(73);
    expect(s.loaded).toBe(true);
    h.unmount();
  });

  it("AC-US1-02: pro tier reports isPro:true and isUnlimited:true", async () => {
    quotaState.current = {
      cache: {
        response: { tier: "pro", skillCount: 12, skillLimit: null },
      },
      daysRemaining: 7,
      isFresh: true,
      localSkillCount: 12,
    };
    const h = await mount();
    const s = h.state();
    expect(s.tier).toBe("pro");
    expect(s.isPro).toBe(true);
    expect(s.isFree).toBe(false);
    expect(s.isEnterprise).toBe(false);
    expect(s.isUnlimited).toBe(true);
    h.unmount();
  });

  it("AC-US1-02: enterprise tier reports isEnterprise:true and isUnlimited:true", async () => {
    quotaState.current = {
      cache: {
        response: { tier: "enterprise", skillCount: 9, skillLimit: null },
      },
      daysRemaining: 7,
      isFresh: true,
      localSkillCount: 9,
    };
    const h = await mount();
    const s = h.state();
    expect(s.tier).toBe("enterprise");
    expect(s.isEnterprise).toBe(true);
    expect(s.isPro).toBe(true);
    expect(s.isUnlimited).toBe(true);
    h.unmount();
  });

  it("0833: defaults isUnlimited:true on a no-snapshot first render (was 50-cap default)", async () => {
    quotaState.current = null;
    const h = await mount();
    const s = h.state();
    expect(s.tier).toBe("free");
    expect(s.skillLimit).toBeNull();
    expect(s.isUnlimited).toBe(true);
    expect(s.loaded).toBe(false);
    h.unmount();
  });

  it("0833: defaults isUnlimited:true when snapshot exists but cache hasn't synced", async () => {
    quotaState.current = {
      cache: null,
      daysRemaining: 0,
      isFresh: false,
      localSkillCount: 0,
    };
    const h = await mount();
    const s = h.state();
    expect(s.tier).toBe("free");
    expect(s.skillLimit).toBeNull();
    expect(s.isUnlimited).toBe(true);
    expect(s.loaded).toBe(true);
    h.unmount();
  });

  it("forward-compat: explicit numeric skillLimit propagates and isUnlimited:false", async () => {
    // If a future server response sets `skill_limit: Some(N)` the hook
    // must surface that — we don't strip the field, only the default
    // changed.
    quotaState.current = {
      cache: {
        response: { tier: "free", skillCount: 49, skillLimit: 50 },
      },
      daysRemaining: 7,
      isFresh: true,
      localSkillCount: 49,
    };
    const h = await mount();
    const s = h.state();
    expect(s.skillLimit).toBe(50);
    expect(s.isUnlimited).toBe(false);
    h.unmount();
  });
});
