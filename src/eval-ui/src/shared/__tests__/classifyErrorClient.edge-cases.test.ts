import { describe, it, expect } from "vitest";
import { classifyErrorClient } from "../classifyErrorClient";

describe("classifyErrorClient — edge cases", () => {
  // ── Empty and whitespace strings ──────────────────────────────────

  it('classifies empty string "" as unknown', () => {
    const result = classifyErrorClient("");
    expect(result.category).toBe("unknown");
    expect(result.description).toBe("");
  });

  it("classifies whitespace-only string as unknown", () => {
    const result = classifyErrorClient("   ");
    expect(result.category).toBe("unknown");
  });

  // ── Very long strings ─────────────────────────────────────────────

  it("handles very long error messages (10000 chars) without crashing", () => {
    const longMsg = "x".repeat(10_000);
    const result = classifyErrorClient(longMsg);
    expect(result.category).toBe("unknown");
    expect(result.description).toBe(longMsg);
  });

  it("detects rate_limit buried inside a very long string", () => {
    const padding = "x".repeat(5000);
    const result = classifyErrorClient(`${padding} rate limit exceeded ${padding}`);
    expect(result.category).toBe("rate_limit");
  });

  // ── Special regex characters in input ─────────────────────────────

  it('classifies "rate.limit" (literal dot) as rate_limit due to regex dot', () => {
    // The regex uses rate.?limit where . is regex any-char
    // "rate.limit" has a literal dot which matches .? (any char, optional)
    const result = classifyErrorClient("rate.limit");
    expect(result.category).toBe("rate_limit");
  });

  it('classifies "rate-limit" (hyphen) as rate_limit', () => {
    const result = classifyErrorClient("rate-limit");
    expect(result.category).toBe("rate_limit");
  });

  it('classifies "rate limit" (space) as rate_limit', () => {
    const result = classifyErrorClient("rate limit");
    expect(result.category).toBe("rate_limit");
  });

  it('classifies "ratelimit" (no separator) as rate_limit', () => {
    const result = classifyErrorClient("ratelimit");
    expect(result.category).toBe("rate_limit");
  });

  it('classifies "quota exceeded" as rate_limit', () => {
    const result = classifyErrorClient("quota exceeded");
    expect(result.category).toBe("rate_limit");
  });

  it('classifies "quota_exceeded" as rate_limit', () => {
    // The regex is quota.?exceeded — underscore matches .? (any single char)
    const result = classifyErrorClient("quota_exceeded");
    expect(result.category).toBe("rate_limit");
  });

  // ── Case sensitivity ──────────────────────────────────────────────

  it('classifies "RATE LIMIT" (uppercase) as rate_limit', () => {
    expect(classifyErrorClient("RATE LIMIT").category).toBe("rate_limit");
  });

  it('classifies "Rate Limit" (title case) as rate_limit', () => {
    expect(classifyErrorClient("Rate Limit").category).toBe("rate_limit");
  });

  it('classifies "UNAUTHORIZED" as auth', () => {
    expect(classifyErrorClient("UNAUTHORIZED").category).toBe("auth");
  });

  it('classifies "TIMEOUT" as timeout', () => {
    expect(classifyErrorClient("TIMEOUT").category).toBe("timeout");
  });

  // ── Numbers that look like status codes ───────────────────────────

  it('classifies "HTTP 429" as rate_limit', () => {
    expect(classifyErrorClient("HTTP 429").category).toBe("rate_limit");
  });

  it('classifies "Error 401" as auth', () => {
    expect(classifyErrorClient("Error 401").category).toBe("auth");
  });

  it('classifies "status: 429" as rate_limit', () => {
    expect(classifyErrorClient("status: 429").category).toBe("rate_limit");
  });

  it('classifies "status: 401 unauthorized" as auth', () => {
    // 401 and unauthorized both match the auth regex; rate_limit check runs first
    // but doesn't match since there's no 429/rate limit/quota pattern
    const result = classifyErrorClient("status: 401 unauthorized");
    expect(result.category).toBe("auth");
  });

  // ── Priority ordering: rate_limit beats auth beats timeout ────────

  it("classifies message with both rate_limit and auth patterns as rate_limit (first match wins)", () => {
    const result = classifyErrorClient("429 rate limit 401 unauthorized");
    expect(result.category).toBe("rate_limit");
  });

  it("classifies message with both auth and timeout patterns as auth (checked before timeout)", () => {
    const result = classifyErrorClient("401 unauthorized timeout");
    expect(result.category).toBe("auth");
  });

  it("classifies message with timeout and model_not_found as timeout (checked before model)", () => {
    const result = classifyErrorClient('timeout while loading model "gpt-5" not found');
    expect(result.category).toBe("timeout");
  });

  // ── Unicode strings ───────────────────────────────────────────────

  it("handles unicode error messages", () => {
    const result = classifyErrorClient("Error: something failed");
    expect(result.category).toBe("unknown");
  });

  it("handles emoji in error messages", () => {
    const result = classifyErrorClient("Rate limit reached");
    expect(result.category).toBe("rate_limit");
  });

  it("handles Chinese characters in error messages", () => {
    const result = classifyErrorClient("something went wrong");
    expect(result.category).toBe("unknown");
  });

  // ── HTML/XSS injection attempts ───────────────────────────────────

  it("does not crash on HTML injection in message (description preserves raw string)", () => {
    const xss = '<script>alert("xss")</script>';
    const result = classifyErrorClient(xss);
    expect(result.category).toBe("unknown");
    // Verify the raw message is preserved in description (no sanitization needed at classification layer)
    expect(result.description).toBe(xss);
  });

  it("does not crash on HTML with rate_limit keyword embedded", () => {
    const result = classifyErrorClient('<div class="rate limit">error</div>');
    expect(result.category).toBe("rate_limit");
  });

  // ── Model not found edge cases ────────────────────────────────────

  it('classifies "model xyz not found" as model_not_found', () => {
    expect(classifyErrorClient("model xyz not found").category).toBe("model_not_found");
  });

  it('does NOT classify "model" alone as model_not_found', () => {
    expect(classifyErrorClient("model").category).toBe("unknown");
  });

  it('does NOT classify "not found" alone as model_not_found', () => {
    expect(classifyErrorClient("not found").category).toBe("unknown");
  });

  it('does NOT classify "model found" (missing "not") as model_not_found', () => {
    expect(classifyErrorClient("model found").category).toBe("unknown");
  });

  it('classifies "the model was not found in the registry" as model_not_found', () => {
    expect(classifyErrorClient("the model was not found in the registry").category).toBe("model_not_found");
  });

  // ── Timeout variants ──────────────────────────────────────────────

  it('classifies "timed out" as timeout', () => {
    expect(classifyErrorClient("timed out").category).toBe("timeout");
  });

  it('classifies "timedout" (no space) as timeout', () => {
    expect(classifyErrorClient("timedout").category).toBe("timeout");
  });

  it('classifies "timed-out" (hyphenated) as timeout', () => {
    expect(classifyErrorClient("timed-out").category).toBe("timeout");
  });

  it('classifies "ETIMEDOUT" as timeout', () => {
    expect(classifyErrorClient("ETIMEDOUT").category).toBe("timeout");
  });

  // ── Auth variants ─────────────────────────────────────────────────

  it('classifies "invalid api key" as auth', () => {
    expect(classifyErrorClient("invalid api key").category).toBe("auth");
  });

  it('classifies "invalid_api_key" (underscored) as auth', () => {
    // The regex is invalid.?api.?key — underscores match .? between words
    expect(classifyErrorClient("invalid_api_key").category).toBe("auth");
  });

  it('classifies "invalid-api-key" (hyphenated) as auth', () => {
    expect(classifyErrorClient("invalid-api-key").category).toBe("auth");
  });

  it('classifies "authentication required" as auth', () => {
    expect(classifyErrorClient("authentication required").category).toBe("auth");
  });

  // ── Return value contracts ────────────────────────────────────────

  it("always preserves the original message in description", () => {
    const messages = [
      "rate limit exceeded",
      "401 unauthorized",
      "timeout",
      'model "x" not found',
      "random error",
    ];
    for (const msg of messages) {
      expect(classifyErrorClient(msg).description).toBe(msg);
    }
  });

  it("rate_limit errors are retryable", () => {
    expect(classifyErrorClient("rate limit").retryable).toBe(true);
  });

  it("timeout errors are retryable", () => {
    expect(classifyErrorClient("timeout").retryable).toBe(true);
  });

  it("auth errors are NOT retryable", () => {
    expect(classifyErrorClient("401 unauthorized").retryable).toBe(false);
  });

  it("model_not_found errors are NOT retryable", () => {
    expect(classifyErrorClient('model "x" not found').retryable).toBe(false);
  });

  // ── context_window category ─────────────────────────────────────────

  it('classifies "context window exceeded" as context_window', () => {
    expect(classifyErrorClient("context window exceeded maximum length").category).toBe("context_window");
  });

  it('classifies "context length exceeded" as context_window', () => {
    expect(classifyErrorClient("context length exceeded").category).toBe("context_window");
  });

  it('classifies "token limit exceeded" as context_window', () => {
    expect(classifyErrorClient("token limit exceeded").category).toBe("context_window");
  });

  it('classifies "token count exceeded" as context_window', () => {
    expect(classifyErrorClient("token count exceeded").category).toBe("context_window");
  });

  it('classifies "input too long" as context_window', () => {
    expect(classifyErrorClient("input too long").category).toBe("context_window");
  });

  it('classifies "prompt too long" as context_window', () => {
    expect(classifyErrorClient("prompt too long").category).toBe("context_window");
  });

  it('classifies "prompt too large" as context_window', () => {
    expect(classifyErrorClient("prompt too large").category).toBe("context_window");
  });

  it('classifies "too long" as context_window', () => {
    expect(classifyErrorClient("content is too long").category).toBe("context_window");
  });

  it('classifies "too large" as context_window', () => {
    expect(classifyErrorClient("request body too large").category).toBe("context_window");
  });

  it('classifies "maximum context" as context_window', () => {
    expect(classifyErrorClient("maximum context size exceeded").category).toBe("context_window");
  });

  it("context_window errors are NOT retryable", () => {
    expect(classifyErrorClient("context window exceeded").retryable).toBe(false);
  });

  // ── provider_unavailable category ─────────────────────────────────

  it('classifies "service unavailable" as provider_unavailable', () => {
    expect(classifyErrorClient("service unavailable").category).toBe("provider_unavailable");
  });

  it('classifies "502 Bad Gateway" as provider_unavailable', () => {
    expect(classifyErrorClient("502 Bad Gateway").category).toBe("provider_unavailable");
  });

  it('classifies "503 Service Unavailable" as provider_unavailable', () => {
    expect(classifyErrorClient("503 Service Unavailable").category).toBe("provider_unavailable");
  });

  it('classifies "ECONNREFUSED" as provider_unavailable', () => {
    expect(classifyErrorClient("ECONNREFUSED").category).toBe("provider_unavailable");
  });

  it('classifies "connection refused" as provider_unavailable', () => {
    expect(classifyErrorClient("connection refused").category).toBe("provider_unavailable");
  });

  it('classifies "ENOENT" as provider_unavailable', () => {
    expect(classifyErrorClient("ENOENT: no such file or directory").category).toBe("provider_unavailable");
  });

  it('classifies "command not found" as provider_unavailable', () => {
    expect(classifyErrorClient("command not found").category).toBe("provider_unavailable");
  });

  it('classifies "server error" as provider_unavailable', () => {
    expect(classifyErrorClient("internal server error").category).toBe("provider_unavailable");
  });

  it("does NOT classify 'provider is currently unavailable' (missing exact pattern) as provider_unavailable", () => {
    // The regex doesn't match "provider ... unavailable" without "service" prefix
    // "unavailable" alone isn't in the pattern; it needs "service" before it
    const result = classifyErrorClient("provider is currently unavailable");
    expect(result.category).toBe("unknown");
  });

  // ── parse_error category ──────────────────────────────────────────

  it('classifies "SyntaxError" as parse_error', () => {
    expect(classifyErrorClient("SyntaxError: Unexpected token").category).toBe("parse_error");
  });

  it('classifies "not valid json" as parse_error', () => {
    expect(classifyErrorClient("response is not valid json").category).toBe("parse_error");
  });

  it('classifies "unexpected token" as parse_error', () => {
    expect(classifyErrorClient("unexpected token at position 0").category).toBe("parse_error");
  });

  it("parse_error is retryable", () => {
    expect(classifyErrorClient("SyntaxError in response").retryable).toBe(true);
  });

  // ── parse_error false positives (BUG: "json" and "parse" match too broadly) ──

  it('does NOT classify "Failed to load json config" as parse_error (false positive on "json")', () => {
    // "json" as a bare substring matches config file errors — should be unknown
    const result = classifyErrorClient("Failed to load json config file");
    expect(result.category).toBe("unknown");
  });

  it('does NOT classify "Could not parse the response body" as parse_error (false positive on "parse")', () => {
    // "parse" as a bare substring matches generic parsing errors — should be unknown
    const result = classifyErrorClient("Could not parse the response body");
    expect(result.category).toBe("unknown");
  });

  it('does NOT classify "save data.json failed" as parse_error (false positive on ".json")', () => {
    const result = classifyErrorClient("save data.json failed");
    expect(result.category).toBe("unknown");
  });

  it('does NOT classify "json-schema validation error" as parse_error', () => {
    const result = classifyErrorClient("json-schema validation error");
    expect(result.category).toBe("unknown");
  });

  // True parse_error positives should still work after fix
  it('still classifies "SyntaxError: Unexpected token <" as parse_error', () => {
    expect(classifyErrorClient("SyntaxError: Unexpected token <").category).toBe("parse_error");
  });

  it('still classifies "response is not valid json" as parse_error', () => {
    expect(classifyErrorClient("response is not valid json").category).toBe("parse_error");
  });

  it('still classifies "JSON.parse error" as parse_error', () => {
    expect(classifyErrorClient("JSON.parse error at position 0").category).toBe("parse_error");
  });

  // ── Edge: numeric string "429" embedded in other numbers ──────────

  it('classifies "error code 4290" as rate_limit (429 substring matches)', () => {
    // This is a potential false positive — 4290 contains 429
    const result = classifyErrorClient("error code 4290");
    expect(result.category).toBe("rate_limit");
  });

  it('classifies "port 4291" as rate_limit (429 substring matches — false positive)', () => {
    // This documents a known limitation: 429 matches as substring
    const result = classifyErrorClient("port 4291");
    expect(result.category).toBe("rate_limit");
  });
});
