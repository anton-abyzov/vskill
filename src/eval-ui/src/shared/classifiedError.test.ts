import { describe, it, expect } from "vitest";
import type { ClassifiedError } from "./classifiedError";

describe("ClassifiedError type", () => {
  const ALL_CATEGORIES: ClassifiedError["category"][] = [
    "rate_limit",
    "context_window",
    "auth",
    "timeout",
    "model_not_found",
    "provider_unavailable",
    "parse_error",
    "unknown",
  ];

  it("model_not_found is assignable to category union", () => {
    const category: ClassifiedError["category"] = "model_not_found";
    expect(category).toBe("model_not_found");
  });

  it("includes all expected categories", () => {
    // Each category must be assignable at compile time; at runtime verify the list is complete
    for (const cat of ALL_CATEGORIES) {
      const err: ClassifiedError = {
        category: cat,
        title: "Test",
        description: "desc",
        hint: "hint",
        retryable: false,
      };
      expect(err.category).toBe(cat);
    }
  });

  it("retryAfterMs is optional", () => {
    const err: ClassifiedError = {
      category: "rate_limit",
      title: "Rate limit",
      description: "Too many requests",
      hint: "Wait",
      retryable: true,
    };
    expect(err.retryAfterMs).toBeUndefined();

    const errWithRetry: ClassifiedError = {
      category: "rate_limit",
      title: "Rate limit",
      description: "Too many requests",
      hint: "Wait",
      retryable: true,
      retryAfterMs: 5000,
    };
    expect(errWithRetry.retryAfterMs).toBe(5000);
  });
});
