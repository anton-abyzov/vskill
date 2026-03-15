import { describe, it, expect } from "vitest";
import { classifyError } from "../error-classifier.js";

describe("classifyError", () => {
  describe("model_not_found (must take priority over provider_unavailable)", () => {
    it("classifies Ollama 'model not found' as model_not_found", () => {
      const err = new Error('Ollama model "mistral:7b" not found. Pull it first:\n  ollama pull mistral:7b');
      const result = classifyError(err, "ollama");
      expect(result.category).toBe("model_not_found");
      expect(result.title).toBe("Model Not Found");
      expect(result.hint).toContain("ollama pull");
      expect(result.retryable).toBe(false);
    });

    it("classifies generic 'model not found' errors", () => {
      const err = new Error("model xyz not found");
      const result = classifyError(err, "ollama");
      expect(result.category).toBe("model_not_found");
    });

    it("does not classify 'command not found' as model_not_found", () => {
      const err = new Error("claude: command not found");
      const result = classifyError(err, "claude-cli");
      expect(result.category).toBe("provider_unavailable");
    });
  });

  describe("provider_unavailable still works for non-model errors", () => {
    it("classifies ECONNREFUSED as provider_unavailable", () => {
      const result = classifyError(new Error("connect ECONNREFUSED 127.0.0.1:11434"), "ollama");
      expect(result.category).toBe("provider_unavailable");
    });

    it("classifies ENOENT as provider_unavailable", () => {
      const result = classifyError(new Error("spawn claude ENOENT"), "claude-cli");
      expect(result.category).toBe("provider_unavailable");
    });
  });
});
