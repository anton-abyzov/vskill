// ---------------------------------------------------------------------------
// error-classifier.ts -- Classify LLM errors into actionable user messages
// ---------------------------------------------------------------------------

export interface ClassifiedError {
  category: "rate_limit" | "context_window" | "auth" | "timeout" | "provider_unavailable" | "parse_error" | "unknown";
  title: string;
  description: string;
  hint: string;
  retryable: boolean;
  retryAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Pattern matchers (case-insensitive)
// ---------------------------------------------------------------------------

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /throttl/i,
  /quota.?exceeded/i,
  /overloaded/i,
  /capacity/i,
];

const CONTEXT_WINDOW_PATTERNS = [
  /context.?(window|length)/i,
  /token.?(limit|count|exceed)/i,
  /too (long|large)/i,
  /maximum.?context/i,
  /input.?too.?long/i,
  /prompt.?too.?(long|large)/i,
];

const AUTH_PATTERNS = [
  /api.?key/i,
  /auth/i,
  /401/,
  /403/,
  /unauthorized/i,
  /forbidden/i,
  /permission.?denied/i,
  /invalid.?key/i,
];

const TIMEOUT_PATTERNS = [
  /timed?\s?out/i,
  /timeout/i,
  /120s/,
  /ETIMEDOUT/i,
  /abort/i,
  /SIGTERM/i,
];

const PROVIDER_UNAVAILABLE_PATTERNS = [
  /ENOENT/,
  /not found/i,
  /command not found/i,
  /502/,
  /503/,
  /service.?unavailable/i,
  /connection.?refused/i,
  /ECONNREFUSED/i,
  /server.?error/i,
];

const PARSE_ERROR_PATTERNS = [
  /SyntaxError/i,
  /JSON/i,
  /parse/i,
  /not valid JSON/i,
  /Unexpected token/i,
];

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

function matchesAny(msg: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(msg));
}

export function classifyError(err: unknown, provider?: string): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err || "");

  if (!msg.trim()) {
    return {
      category: "unknown",
      title: "Unknown Error",
      description: "An unexpected error occurred with no details.",
      hint: "Try again. If the problem persists, check your provider configuration.",
      retryable: true,
    };
  }

  // Rate limit
  if (matchesAny(msg, RATE_LIMIT_PATTERNS)) {
    return {
      category: "rate_limit",
      title: "Rate Limit Reached",
      description: "The AI provider is temporarily limiting requests.",
      hint: provider === "claude-cli"
        ? "Claude CLI has per-minute limits. Wait 30 seconds and retry."
        : "Wait for the rate limit to reset, then retry.",
      retryable: true,
      retryAfterMs: 30_000,
    };
  }

  // Context window
  if (matchesAny(msg, CONTEXT_WINDOW_PATTERNS)) {
    return {
      category: "context_window",
      title: "Content Too Large",
      description: "The skill content exceeds the model's context window.",
      hint: "Reduce SKILL.md to under 3,000 words, or move detailed content to references/ files.",
      retryable: false,
    };
  }

  // Auth
  if (matchesAny(msg, AUTH_PATTERNS)) {
    const hint = provider === "anthropic"
      ? "Set ANTHROPIC_API_KEY: export ANTHROPIC_API_KEY=sk-ant-..."
      : provider === "claude-cli"
        ? "Run `claude login` to authenticate, or switch to a different provider (Ollama, Anthropic API)."
        : provider === "codex-cli"
          ? "Run `codex login` to authenticate, or switch to a different provider."
          : provider === "gemini-cli"
            ? "Run `gemini login` to authenticate, or switch to a different provider."
            : provider === "ollama"
              ? "Check that Ollama is running: ollama serve"
              : "Verify your provider is configured correctly.";
    return {
      category: "auth",
      title: "Authentication Failed",
      description: "The AI provider rejected the request due to missing or invalid credentials.",
      hint,
      retryable: false,
    };
  }

  // Timeout
  if (matchesAny(msg, TIMEOUT_PATTERNS)) {
    return {
      category: "timeout",
      title: "Request Timed Out",
      description: "The AI provider did not respond within the time limit (120s).",
      hint: "Try a simpler instruction or a smaller skill. If using Ollama, ensure the model is loaded.",
      retryable: true,
    };
  }

  // Provider unavailable
  if (matchesAny(msg, PROVIDER_UNAVAILABLE_PATTERNS)) {
    const installHints: Record<string, string> = {
      "claude-cli": "Install Claude CLI: npm install -g @anthropic-ai/claude-code",
      "codex-cli": "Install Codex CLI: npm install -g @openai/codex",
      "gemini-cli": "Install Gemini CLI: npm install -g @google/gemini-cli",
      "ollama": "Start Ollama: ollama serve",
    };
    return {
      category: "provider_unavailable",
      title: "Provider Unavailable",
      description: `Could not reach the AI provider "${provider || "unknown"}".`,
      hint: (provider && installHints[provider]) || "Check that the provider is installed and running.",
      retryable: false,
    };
  }

  // Parse error
  if (matchesAny(msg, PARSE_ERROR_PATTERNS)) {
    return {
      category: "parse_error",
      title: "Response Parse Error",
      description: "The AI response could not be parsed. The model may have returned an unexpected format.",
      hint: "Try again — AI responses can vary. If this persists, try a different model.",
      retryable: true,
    };
  }

  // Unknown
  return {
    category: "unknown",
    title: "Operation Failed",
    description: msg.length > 200 ? msg.slice(0, 200) + "..." : msg,
    hint: "Try again. If the problem persists, check your provider configuration.",
    retryable: true,
  };
}
