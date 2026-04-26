import type { ClaudeCliResult } from "./plugin-cli.js";

export interface ClaudeCliFailureBody {
  ok: false;
  code: "claude-cli-failed";
  error: string;
  stdout: string;
  stderr: string;
}

export interface ClaudeCliFailureResponse {
  status: number;
  body: ClaudeCliFailureBody;
}

/**
 * The CLI ran successfully (no spawn/IO error) but the command itself
 * returned a non-zero exit code — e.g. "Plugin not found in installed
 * plugins". That's a normal user-visible outcome, not a server failure,
 * so we surface it as HTTP 200 with `ok: false` and let the UI render
 * the error text. HTTP 500 is reserved for the catch path (spawn errors,
 * unexpected exceptions).
 */
export function buildClaudeCliFailureResponse(
  result: ClaudeCliResult,
): ClaudeCliFailureResponse {
  const error =
    result.stderr.trim() || result.stdout.trim() || "claude plugin command failed";
  return {
    status: 200,
    body: {
      ok: false,
      code: "claude-cli-failed",
      error,
      stdout: result.stdout,
      stderr: result.stderr,
    },
  };
}
