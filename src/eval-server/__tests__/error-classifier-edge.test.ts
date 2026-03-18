import { describe, it, expect } from "vitest";
import { classifyError } from "../error-classifier.js";

describe("error-classifier edge cases", () => {
  // -----------------------------------------------------------------------
  // model_not_found with different providers
  // -----------------------------------------------------------------------
  describe("model_not_found provider hints", () => {
    it("gives ollama pull hint for provider=ollama", () => {
      const err = new Error('model "llama3" not found');
      const result = classifyError(err, "ollama");
      expect(result.category).toBe("model_not_found");
      expect(result.hint).toContain("ollama pull");
      expect(result.hint).toContain("llama3");
    });

    it("gives generic hint for provider=claude-cli", () => {
      const err = new Error('model "opus-5" not found');
      const result = classifyError(err, "claude-cli");
      expect(result.category).toBe("model_not_found");
      expect(result.hint).not.toContain("ollama pull");
      expect(result.hint).toContain("opus-5");
    });

    it("gives generic hint when provider is undefined", () => {
      const err = new Error('model "test-model" not found');
      const result = classifyError(err);
      expect(result.category).toBe("model_not_found");
      expect(result.hint).toContain("test-model");
    });
  });

  // -----------------------------------------------------------------------
  // parse_error patterns
  // -----------------------------------------------------------------------
  describe("parse_error patterns", () => {
    it("classifies 'Converting circular structure to JSON' as parse_error", () => {
      const err = new Error("Converting circular structure to JSON");
      const result = classifyError(err);
      expect(result.category).toBe("parse_error");
    });

    it("classifies 'SyntaxError: Unexpected token' as parse_error", () => {
      const err = new Error("SyntaxError: Unexpected token < in JSON at position 0");
      const result = classifyError(err);
      expect(result.category).toBe("parse_error");
    });

    it("classifies 'not valid JSON' as parse_error", () => {
      const err = new Error("Response is not valid JSON");
      const result = classifyError(err);
      expect(result.category).toBe("parse_error");
    });
  });

  // -----------------------------------------------------------------------
  // rate_limit provider-specific hints
  // -----------------------------------------------------------------------
  describe("rate_limit provider hints", () => {
    it("gives Claude CLI specific hint for provider=claude-cli", () => {
      const err = new Error("rate limit exceeded");
      const result = classifyError(err, "claude-cli");
      expect(result.category).toBe("rate_limit");
      expect(result.hint).toContain("Claude CLI");
      expect(result.retryAfterMs).toBe(30_000);
    });

    it("gives generic hint for other providers", () => {
      const err = new Error("rate limit exceeded");
      const result = classifyError(err, "anthropic");
      expect(result.hint).not.toContain("Claude CLI");
    });
  });

  // -----------------------------------------------------------------------
  // auth provider-specific hints
  // -----------------------------------------------------------------------
  describe("auth provider hints", () => {
    const providers = [
      { name: "anthropic", expectedHint: "ANTHROPIC_API_KEY" },
      { name: "claude-cli", expectedHint: "claude login" },
      { name: "codex-cli", expectedHint: "codex login" },
      { name: "gemini-cli", expectedHint: "gemini login" },
      { name: "ollama", expectedHint: "ollama serve" },
    ];

    for (const { name, expectedHint } of providers) {
      it(`gives correct hint for provider=${name}`, () => {
        const result = classifyError(new Error("401 Unauthorized"), name);
        expect(result.category).toBe("auth");
        expect(result.hint).toContain(expectedHint);
      });
    }

    it("gives generic hint for unknown provider", () => {
      const result = classifyError(new Error("401 Unauthorized"), "some-new-provider");
      expect(result.hint).toContain("configured correctly");
    });
  });

  // -----------------------------------------------------------------------
  // Priority: model_not_found > provider_unavailable
  // -----------------------------------------------------------------------
  describe("classification priority", () => {
    it("model not found beats provider unavailable (both match 'not found')", () => {
      // "model xyz not found" matches both model_not_found regex and
      // PROVIDER_UNAVAILABLE_PATTERNS ("not found"). model_not_found should win.
      const err = new Error("model xyz not found");
      const result = classifyError(err);
      expect(result.category).toBe("model_not_found");
    });

    it("'command not found' routes to provider_unavailable, not model_not_found", () => {
      const err = new Error("claude: command not found");
      const result = classifyError(err, "claude-cli");
      expect(result.category).toBe("provider_unavailable");
    });
  });

  // -----------------------------------------------------------------------
  // Empty / falsy inputs
  // -----------------------------------------------------------------------
  describe("empty and falsy inputs", () => {
    it("classifies null/undefined input as unknown", () => {
      const result = classifyError(null);
      expect(result.category).toBe("unknown");
    });

    it("classifies empty string as unknown", () => {
      const result = classifyError("");
      expect(result.category).toBe("unknown");
    });

    it("classifies non-Error objects via String()", () => {
      const result = classifyError({ message: "rate limit" });
      // String({message: "rate limit"}) = "[object Object]", won't match
      expect(result.category).toBe("unknown");
    });
  });

  // -----------------------------------------------------------------------
  // Overloaded/capacity patterns (rate_limit)
  // -----------------------------------------------------------------------
  describe("overloaded/capacity rate limit patterns", () => {
    it("classifies 'overloaded' as rate_limit", () => {
      const result = classifyError(new Error("The server is overloaded, please try again"));
      expect(result.category).toBe("rate_limit");
    });

    it("classifies 'capacity' as rate_limit", () => {
      const result = classifyError(new Error("Insufficient capacity available"));
      expect(result.category).toBe("rate_limit");
    });
  });
});
