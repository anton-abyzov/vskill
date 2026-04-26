import { describe, it, expect } from "vitest";
import { buildClaudeCliFailureResponse } from "../plugin-cli-response";

describe("buildClaudeCliFailureResponse", () => {
  it("returns HTTP 200 (not 500) when the CLI ran but exited non-zero, so the UI can surface the error", () => {
    const result = {
      stdout: "",
      stderr: "✘ Failed to uninstall plugin \"skill-creator\": Plugin \"skill-creator\" not found in installed plugins\n",
      code: 1,
    };
    const got = buildClaudeCliFailureResponse(result);
    expect(got.status).toBe(200);
    expect(got.body.ok).toBe(false);
    expect(got.body.code).toBe("claude-cli-failed");
    expect(got.body.error).toContain("Plugin \"skill-creator\" not found");
    expect(got.body.stderr).toBe(result.stderr);
    expect(got.body.stdout).toBe(result.stdout);
  });

  it("uses stdout as the error message when stderr is empty", () => {
    const result = { stdout: "fatal: bad config\n", stderr: "", code: 2 };
    const got = buildClaudeCliFailureResponse(result);
    expect(got.body.error).toBe("fatal: bad config");
  });

  it("falls back to a generic message when both streams are empty", () => {
    const result = { stdout: "", stderr: "", code: 1 };
    const got = buildClaudeCliFailureResponse(result);
    expect(got.body.error).toBe("claude plugin command failed");
  });

  it("trims trailing whitespace from the surfaced error message", () => {
    const result = { stdout: "", stderr: "   bad   \n\n", code: 1 };
    const got = buildClaudeCliFailureResponse(result);
    expect(got.body.error).toBe("bad");
  });
});
