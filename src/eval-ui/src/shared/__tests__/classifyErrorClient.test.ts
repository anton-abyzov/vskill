import { describe, it, expect } from "vitest";
import { classifyErrorClient } from "../classifyErrorClient";

describe("classifyErrorClient", () => {
  it("classifies rate limit errors", () => {
    expect(classifyErrorClient("rate limit exceeded").category).toBe("rate_limit");
    expect(classifyErrorClient("429 Too Many Requests").category).toBe("rate_limit");
  });

  it("classifies auth errors", () => {
    expect(classifyErrorClient("401 Unauthorized").category).toBe("auth");
    expect(classifyErrorClient("Invalid API key").category).toBe("auth");
  });

  it("classifies timeout errors", () => {
    expect(classifyErrorClient("Request timed out").category).toBe("timeout");
    expect(classifyErrorClient("ETIMEDOUT").category).toBe("timeout");
  });

  it("classifies model not found errors", () => {
    expect(classifyErrorClient('model "opus" not found').category).toBe("model_not_found");
  });

  it("falls back to unknown for unrecognized messages", () => {
    const result = classifyErrorClient("something random happened");
    expect(result.category).toBe("unknown");
    expect(result.description).toBe("something random happened");
  });

  it("returns retryable=false for unknown errors", () => {
    expect(classifyErrorClient("random").retryable).toBe(false);
  });

  it("returns a valid ClassifiedError shape", () => {
    const result = classifyErrorClient("test error");
    expect(result).toHaveProperty("category");
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("description");
    expect(result).toHaveProperty("hint");
    expect(result).toHaveProperty("retryable");
  });
});
