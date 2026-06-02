// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0843 T-003 — RED: SkillCountBadge label + tooltip per tier.
//
// AC-US2-01 / AC-US2-02 / AC-US2-03 / AC-US2-05:
//   - free tier with N count → "N / 50" label, tooltip mentions cap.
//   - pro / enterprise → "N skills", tooltip mentions unlimited tier.
//   - signed-out → free defaults (count 0).
//
// We mock `useAccountSummary` (signedIn) and `useTier` (tier + skillCount +
// skillLimit) so the component renders without booting the QuotaContext.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const accountSummary = vi.hoisted(() => ({
  signedIn: true as boolean,
  login: "octocat" as string | null,
  avatarUrl: null as string | null,
  tier: "free" as "free" | "pro" | "enterprise",
}));

const tierState = vi.hoisted(() => ({
  tier: "free" as "free" | "pro" | "enterprise",
  isPro: false,
  isFree: true,
  isEnterprise: false,
  skillCount: 0,
  skillLimit: 50 as number | null,
  isUnlimited: false,
  gracePeriodDaysRemaining: 30,
  isFresh: true,
  loaded: true,
  localSkillCount: 0,
}));

vi.mock("../hooks/useAccountSummary", () => ({
  useAccountSummary: () => accountSummary,
}));

vi.mock("../hooks/useTier", () => ({
  useTier: () => tierState,
}));

import { SkillCountBadge } from "../components/SkillCountBadge";

function setTier(t: "free" | "pro" | "enterprise", count: number, limit: number | null) {
  tierState.tier = t;
  tierState.isPro = t !== "free";
  tierState.isFree = t === "free";
  tierState.isEnterprise = t === "enterprise";
  tierState.skillCount = count;
  tierState.skillLimit = limit;
  tierState.isUnlimited = limit === null;
  accountSummary.tier = t;
}

describe("0843 US-002 — SkillCountBadge", () => {
  beforeEach(() => {
    setTier("free", 0, 50);
    accountSummary.signedIn = true;
  });

  it.each([0, 25, 50])("renders 'N / 50' label for free tier with count %i", (count) => {
    setTier("free", count, 50);
    const html = renderToStaticMarkup(<SkillCountBadge />);
    expect(html).toContain(`${count} / 50`);
    // Tooltip / title carries the cap explanation.
    expect(html).toMatch(/title="[^"]*50[^"]*"/);
  });

  it("renders 'N skills' (no cap) for pro tier", () => {
    setTier("pro", 87, null);
    const html = renderToStaticMarkup(<SkillCountBadge />);
    expect(html).toContain("87 skills");
    expect(html).not.toContain("/ 50");
    expect(html).toMatch(/title="[^"]*unlimited[^"]*"/i);
  });

  it("renders 'N skills' (no cap) for enterprise tier", () => {
    setTier("enterprise", 421, null);
    const html = renderToStaticMarkup(<SkillCountBadge />);
    expect(html).toContain("421 skills");
    expect(html).not.toContain("/ 50");
    expect(html).toMatch(/title="[^"]*unlimited[^"]*"/i);
  });

  it("renders nothing visible-text-wise when signed out (count 0 / 50 fallback)", () => {
    accountSummary.signedIn = false;
    setTier("free", 0, 50);
    const html = renderToStaticMarkup(<SkillCountBadge />);
    // Still renders the badge so layout is stable; the label is the
    // fallback shape for free tier.
    expect(html).toContain('data-testid="skill-count-badge"');
    expect(html).toContain("0 / 50");
  });

  it("badge carries data-state attribute matching tier for theming hooks", () => {
    setTier("pro", 12, null);
    const html = renderToStaticMarkup(<SkillCountBadge />);
    expect(html).toMatch(/data-state="pro"/);
  });
});
