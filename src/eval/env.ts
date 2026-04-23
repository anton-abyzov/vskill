// ---------------------------------------------------------------------------
// env.ts — Canonical environment-variable resolution helpers.
//
// Introduced for increment 0682 (Studio Agent + Model Picker) to:
//   1. Normalise Ollama base URL across `OLLAMA_HOST` (primary, matches
//      Ollama's own docs) and the deprecated `OLLAMA_BASE_URL` (backcompat).
//   2. Centralise env reads so there is exactly one call site per variable;
//      this keeps docs/ARCHITECTURE.md §5 trustworthy and makes voice-lint
//      / compliance greps reliable.
//   3. Guarantee a single deprecation warning per process via `warnOnce()`
//      so users with both vars set see one advisory line, not a storm.
//
// Precedence for `resolveOllamaBaseUrl`:
//   (1) env.OLLAMA_HOST
//   (2) env.OLLAMA_BASE_URL  (deprecated, emits warn-once on conflict)
//   (3) "http://localhost:11434"
//
// Bare host:port values (no scheme) get `http://` prepended. Values with
// any scheme (`http://`, `https://`, etc.) pass through untouched.
// ---------------------------------------------------------------------------

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

// Module-scoped dedup set — one emission per unique message per process.
const warnedMessages = new Set<string>();

export type WarnOnceLogger = (message: string) => void;

/**
 * Emit `message` via `logger` (default: console.warn) exactly once per
 * process. Subsequent calls with the same string are no-ops.
 *
 * Test-only helper `_resetWarnOnce()` below clears the dedup set so unit
 * tests can observe the one-shot behaviour in isolation.
 */
export function warnOnce(message: string, logger?: WarnOnceLogger): void {
  if (warnedMessages.has(message)) return;
  warnedMessages.add(message);
  const write = logger ?? ((m: string) => console.warn(m));
  write(message);
}

/** Test-only — clears the warn-once dedup set between tests. */
export function _resetWarnOnce(): void {
  warnedMessages.clear();
}

/**
 * Prepend `http://` to bare `host:port` values. Pass-through for anything
 * that already has a scheme. Empty / whitespace values fall through to
 * the caller's default.
 */
function ensureScheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

/**
 * Resolve the Ollama base URL using the documented precedence rules.
 *
 * @param env - usually `process.env`; injected so tests can supply fixtures.
 * @param logger - optional logger for the deprecation warn-once.
 */
export function resolveOllamaBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  logger?: WarnOnceLogger,
): string {
  const host = env.OLLAMA_HOST?.trim();
  const baseUrl = env.OLLAMA_BASE_URL?.trim();

  // Both set with different values → emit deprecation warning exactly once.
  if (host && baseUrl && host !== baseUrl) {
    warnOnce(
      `Both OLLAMA_HOST and OLLAMA_BASE_URL are set. Using OLLAMA_HOST (${host}). OLLAMA_BASE_URL is deprecated.`,
      logger,
    );
  }

  if (host) return ensureScheme(host);
  if (baseUrl) return ensureScheme(baseUrl);
  return DEFAULT_OLLAMA_BASE_URL;
}
