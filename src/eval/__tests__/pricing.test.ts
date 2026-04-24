import { describe, it, expect } from "vitest";
import {
  calculateCost,
  estimateCost,
  getBillingMode,
  getProviderPricing,
  type BillingMode,
} from "../pricing.js";

describe("pricing engine", () => {
  describe("calculateCost", () => {
    it("calculates cost for anthropic claude-sonnet-4-6", () => {
      // Sonnet: $3/M input, $15/M output
      const cost = calculateCost("anthropic", "claude-sonnet-4-6", 1000, 500);
      // (1000/1M * 3) + (500/1M * 15) = 0.003 + 0.0075 = 0.0105
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it("calculates cost for anthropic claude-opus-4-6", () => {
      // Opus 4.6: $5/M input, $25/M output
      const cost = calculateCost("anthropic", "claude-opus-4-6", 10000, 5000);
      // (10000/1M * 5) + (5000/1M * 25) = 0.05 + 0.125 = 0.175
      expect(cost).toBeCloseTo(0.175, 6);
    });

    it("calculates cost for anthropic claude-haiku", () => {
      // 0711: Haiku 4.5 actual public pricing — $1.00/M input, $5/M output
      // (https://claude.com/pricing — verified 2026-04-24). Old test value
      // ($0.80/$4) predated the 4.5 release and was never refreshed.
      const cost = calculateCost("anthropic", "claude-haiku-4-5-20251001", 2000, 1000);
      // (2000/1M * 1) + (1000/1M * 5) = 0.002 + 0.005 = 0.007
      expect(cost).toBeCloseTo(0.007, 6);
    });

    it("returns null when inputTokens is null", () => {
      expect(calculateCost("anthropic", "claude-sonnet-4-6", null, 500)).toBeNull();
    });

    it("returns null when outputTokens is null", () => {
      expect(calculateCost("anthropic", "claude-sonnet-4-6", 1000, null)).toBeNull();
    });

    it("returns null for unknown model", () => {
      expect(calculateCost("anthropic", "unknown-model-xyz", 1000, 500)).toBeNull();
    });

    it("returns 0 for ollama (free)", () => {
      expect(calculateCost("ollama", "llama3.1:8b", 5000, 3000)).toBe(0);
    });

    it("calculates cost for openai o4-mini", () => {
      // o4-mini: $1.10/M input, $4.40/M output
      const cost = calculateCost("openai", "o4-mini", 1000, 500);
      // (1000/1M * 1.10) + (500/1M * 4.40) = 0.0011 + 0.0022 = 0.0033
      expect(cost).toBeCloseTo(0.0033, 6);
    });

    it("calculates cost for google gemini-2.5-pro", () => {
      // gemini-2.5-pro: $1.25/M input, $10/M output
      const cost = calculateCost("google", "gemini-2.5-pro", 1000, 500);
      // (1000/1M * 1.25) + (500/1M * 10) = 0.00125 + 0.005 = 0.00625
      expect(cost).toBeCloseTo(0.00625, 6);
    });
  });

  describe("fuzzy model matching", () => {
    it("resolves 'sonnet' alias to claude-sonnet-4-6 for anthropic", () => {
      const pricing = getProviderPricing("anthropic", "sonnet");
      expect(pricing).not.toBeNull();
      expect(pricing!.inputPerMillion).toBe(3);
    });

    it("resolves 'opus' alias to claude-opus-4-7 for anthropic", () => {
      const pricing = getProviderPricing("anthropic", "opus");
      expect(pricing).not.toBeNull();
      expect(pricing!.inputPerMillion).toBe(5);
    });

    it("resolves 'haiku' alias to claude-haiku for anthropic", () => {
      const pricing = getProviderPricing("anthropic", "haiku");
      expect(pricing).not.toBeNull();
      // 0711: refreshed from $0.80 to $1.00 to match Haiku 4.5 published price.
      expect(pricing!.inputPerMillion).toBe(1);
    });

    it("resolves claude-cli aliases via anthropic pricing", () => {
      // claude-cli uses same models as anthropic
      const pricing = getProviderPricing("claude-cli", "sonnet");
      expect(pricing).not.toBeNull();
      expect(pricing!.inputPerMillion).toBe(3);
    });

    it("returns null for unknown provider", () => {
      expect(getProviderPricing("unknown-provider", "some-model")).toBeNull();
    });

    it("returns null for unknown model within known provider", () => {
      expect(getProviderPricing("anthropic", "completely-unknown")).toBeNull();
    });
  });

  describe("getBillingMode", () => {
    it("returns 'per-token' for anthropic", () => {
      expect(getBillingMode("anthropic")).toBe("per-token");
    });

    it("returns 'per-token' for openrouter", () => {
      expect(getBillingMode("openrouter")).toBe("per-token");
    });

    it("returns 'subscription' for claude-cli", () => {
      expect(getBillingMode("claude-cli")).toBe("subscription");
    });

    it("returns 'subscription' for codex-cli", () => {
      expect(getBillingMode("codex-cli")).toBe("subscription");
    });

    it("returns 'free' for ollama", () => {
      expect(getBillingMode("ollama")).toBe("free");
    });

    it("returns 'free' for gemini-cli", () => {
      expect(getBillingMode("gemini-cli")).toBe("free");
    });

    it("returns 'per-token' for unknown provider (safe default)", () => {
      expect(getBillingMode("some-new-provider")).toBe("per-token");
    });
  });

  describe("estimateCost", () => {
    it("estimates cost for anthropic sonnet with estimated tokens", () => {
      const est = estimateCost("anthropic", "claude-sonnet-4-6", 5000, 2000);
      expect(est).not.toBeNull();
      expect(est!).toBeGreaterThan(0);
    });

    it("returns null for provider without pricing (unknown)", () => {
      expect(estimateCost("unknown", "model", 5000, 2000)).toBeNull();
    });

    it("returns 0 for ollama", () => {
      expect(estimateCost("ollama", "any-model", 5000, 2000)).toBe(0);
    });
  });
});
