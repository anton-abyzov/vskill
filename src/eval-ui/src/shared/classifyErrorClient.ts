import type { ClassifiedError } from "./classifiedError";

export function classifyErrorClient(message: string): ClassifiedError {
  const msg = message.toLowerCase();

  if (/rate.?limit|429|quota.?exceeded/.test(msg)) {
    return { category: "rate_limit", title: "Rate Limit", description: message, hint: "Wait a moment and try again.", retryable: true };
  }
  if (/401|unauthorized|invalid.?api.?key|authentication/.test(msg)) {
    return { category: "auth", title: "Authentication Failed", description: message, hint: "Check your API key or credentials.", retryable: false };
  }
  if (/timeout|timed?.?out|etimedout/.test(msg)) {
    return { category: "timeout", title: "Request Timed Out", description: message, hint: "The request took too long. Try again.", retryable: true };
  }
  if (/model\b.*not found/.test(msg)) {
    return { category: "model_not_found", title: "Model Not Found", description: message, hint: "The selected model is not available. Try switching to a different model in the dropdown above.", retryable: false };
  }
  if (/context.?(?:window|length)|token.?(?:limit|count|exceed)|too (?:long|large)|maximum.?context|input.?too.?long|prompt.?too.?(?:long|large)/.test(msg)) {
    return { category: "context_window", title: "Content Too Large", description: message, hint: "Reduce SKILL.md size or move detailed content to references/ files.", retryable: false };
  }
  if (/enoent|command not found|502|503|service.?unavailable|connection.?refused|econnrefused|server.?error/.test(msg)) {
    return { category: "provider_unavailable", title: "Provider Unavailable", description: message, hint: "Check that the provider is installed and running.", retryable: false };
  }
  if (/syntaxerror|json\.?parse|parse.?error|failed to parse|not valid json|unexpected token/.test(msg)) {
    return { category: "parse_error", title: "Response Parse Error", description: message, hint: "Try again. If this persists, try a different model.", retryable: true };
  }

  return { category: "unknown", title: "Error", description: message, hint: "", retryable: false };
}
